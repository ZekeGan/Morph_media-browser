// Runs one explorer:request from the renderer against an Explorer instance. main.ts validates
// the IPC sender and request shape first (ipc-requests.ts); this module routes each action.
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import {
  documentFile,
  type ExplorerRequest,
  type ExplorerResponse,
  type FolderFacts,
  gameActionTemplates,
  type GameAvailability,
  gameExtras,
  newDetails,
} from '../shared/explorer'
import { httpUrl } from '../shared/fields'
import { KEY_REJECTED, keySite } from '../shared/keys'
import { isFolderKind } from '../shared/kind'
import { projectImageCells } from '../shared/layouts'
import { isGameFolder } from '../shared/media'
import { fmt } from '../shared/message'
import { DATA_DIR, type FolderRecord, localeProfileId, validateDetails } from '../shared/model'
import { completionNotice } from '../shared/notifications'
import { metadataSources } from '../shared/sources'
import { parseSubtitles } from '../shared/subtitles'
import { externalPlayerArgs } from '../shared/videoPlayer'

import { archiveIndex } from './archive'
import { openArchive } from './archive-foreign'
import * as embeddedFns from './embedded-subtitles'
import { type Explorer, SUBTITLE_EXTENSIONS } from './explorer'
import * as streamFns from './explorer-stream'
import { readFolder, safePath, saveFolder } from './files'
import { detectGame } from './game-detection'
import {
  bundledSuggestions,
  engineSave,
  localeProfiles,
  steamAppId,
  store,
  storeUrl,
} from './game-extras'
import { probeFile } from './media-files'
import { metadata } from './metadata'
import { SourceError } from './metadata-common'
import { readNovel } from './novel'

export async function dispatchRequest(
  ex: Explorer,
  req: ExplorerRequest
): Promise<ExplorerResponse> {
  if (req.action === 'visit') return ex.after(await ex.library.visit(req.rowId))
  if (!req || typeof req.action !== 'string') throw new Error('無效的操作')
  switch (req.action) {
    case 'warmThumbnails':
      ex.warmThumbnails(req.rowIds)
      return {}
    case 'archive': {
      const file = await ex.file(req.rowId, req.fileId)
      if (
        ![
          'application/zip',
          'application/vnd.comicbook-rar',
          'application/x-7z-compressed',
        ].includes(file.mime)
      ) {
        throw new Error('不是漫畫壓縮檔（ZIP／CBZ、RAR／CBR、7z／CB7）')
      }
      const index = await openArchive(file.file)
      const token = randomUUID()
      ex.remember(token, { file: file.file, index })
      return {
        content: {
          entries: index.images.map((entry, i) => ({
            id: token + '-' + i,
            name: entry.name,
            kind: 'image',
            mime: entry.mime,
            size: entry.size,
            modified: index.modified,
            url: `media://archive/${req.rowId}/${req.fileId}/${token}/${i}`,
          })),
          notices: [],
        },
      }
    }
    case 'overview':
      return { overview: await ex.overview(req) }
    case 'fileProbe':
    case 'openFile':
    case 'revealFile': {
      // Only files the row published (resolved through the scoped file table) are ever touched.
      const entry = await ex.file(req.rowId, req.fileId)
      if (req.action === 'openFile') {
        if (!/^(video|audio)\//.test(entry.mime)) {
          throw new Error('只能用系統預設程式開啟影音檔案')
        }
        await ex.desktop.open(entry.file)
        return {}
      }
      if (req.action === 'revealFile') {
        if (!ex.desktop.reveal) throw new Error('目前環境無法顯示檔案位置')
        ex.desktop.reveal(entry.file)
        return {}
      }
      return { probe: { kind: await probeFile(entry.file) } }
    }
    case 'openExternalPlayer': {
      // R-431: the file comes from the row's file table; the program only from the app settings (main side).
      const entry = await ex.file(req.rowId, req.fileId)
      if (!/^(video|audio)\//.test(entry.mime)) throw new Error('只能用外部播放器開啟影音檔案')
      const player = ex.desktop.videoPlayer?.()
      if (!player) {
        await ex.desktop.open(entry.file)
        return {}
      }
      if (
        !(await fs.stat(player).then(
          (s) => s.isFile(),
          () => false
        ))
      ) {
        throw new Error('找不到外部播放器；請到應用程式設定重新指定')
      }
      // The position is only passed on when it is a sane number (an invalid one starts from the beginning).
      await ex.desktop.launch(player, externalPlayerArgs(player, entry.file, req.time))
      return {}
    }
    case 'subtitleTrack': {
      // R-432: the name and language are kept as text with size caps; the record check rejects anything else.
      const name = req.name?.trim().slice(0, 200)
      const language = req.language?.trim().slice(0, 35)
      return ex.after(
        await ex.details(req.rowId, req.revision, (d) => {
          if (name || language) {
            d.subtitleTrack = { ...(name ? { name } : {}), ...(language ? { language } : {}) }
          } else delete d.subtitleTrack
        })
      )
    }
    case 'openExternal':
      if (!httpUrl(req.url) || !ex.desktop.external) throw new Error('網址無法開啟')
      await ex.desktop.external(req.url)
      return {}
    case 'search':
      ex.index.sync(ex.library.snapshot())
      return {
        search: ex.index.search(req.query, req.projectId, req.offset, req.limit, req.queryAst),
      }
    case 'rebuildIndex':
      ex.index.sync(ex.library.snapshot(), true)
      return { notice: { level: 'success', message: '索引已依資料夾資訊重建' } }
    case 'content':
      return { content: await ex.content(req.rowId, req.limit, req.cursor, req.sort) }
    case 'attributes':
      await ex.attributes(req.rowId, req.revision, req.values, req.private)
      return ex.after(await ex.library.refreshRecord(req.rowId))
    case 'removeSource': {
      // R-339: only a known website's own fields (its id prefix), and only values not changed by hand.
      if (!metadataSources.some((source) => source.id === req.provider)) {
        throw new Error('來源不存在')
      }
      const { row, record } = await ex.record(req.rowId, req.revision)
      const prefix = req.provider + '-'
      const kept = record.attributes.filter(
        (a) => !a.attributeId.startsWith(prefix) || a.source === 'manual'
      )
      if (kept.length === record.attributes.length) return ex.after(ex.library.snapshot())
      record.attributes = kept
      await saveFolder(row.path, record, req.revision)
      return ex.after(await ex.library.refreshRecord(req.rowId))
    }
    case 'batch': {
      if (
        !Array.isArray(req.rows) ||
        !req.rows.length ||
        req.rows.length > 1000 ||
        !['replace', 'add', 'remove'].includes(req.mode) ||
        new Set(req.rows.map((r) => r.rowId)).size !== req.rows.length
      ) {
        throw new Error('批次範圍不合法')
      }
      const failed: string[] = []
      let saved = 0
      for (const item of req.rows) {
        try {
          const { row, record } = await ex.record(item.rowId, item.revision)
          const p = ex.library
            .snapshot()
            .projects.find((p) => p.projectId === row.projectId)!.project!
          const field = p.fieldBindings.find((f) => f.attributeId === req.attributeId)
          if (!field) throw new Error('專案未配置欄位')
          let value = req.value
          if (field.type === 'tags' && req.mode !== 'replace') {
            if (!Array.isArray(req.value)) throw new Error('標籤應為清單')
            const old =
              record.attributes.find((a) => a.attributeId === field.attributeId)?.value ?? []
            if (!Array.isArray(old)) throw new Error('格式衝突')
            value =
              req.mode === 'add'
                ? [...new Set([...old, ...req.value])]
                : old.filter((v) => !(req.value as unknown[]).includes(v))
          } else if (req.mode !== 'replace') throw new Error('只有標籤支援新增／移除')
          await ex.attributes(
            item.rowId,
            item.revision,
            [
              {
                attributeId: field.attributeId,
                key: field.alias,
                type: field.type,
                value,
                source: 'manual',
              },
            ],
            false
          )
          saved++
        } catch (e) {
          failed.push(`${item.rowId}: ${String(e)}`)
        }
      }
      for (const item of req.rows) await ex.library.refreshRecord(item.rowId).catch(() => {})
      const snapshot = ex.library.snapshot()
      ex.index.sync(snapshot)
      return {
        snapshot,
        notice: completionNotice(
          saved,
          failed.length,
          fmt(
            '批次保存 {0} 筆{1}',
            saved,
            failed.length ? fmt('\n失敗（已成功項目保留）：\n') + failed.join('\n') : ''
          )
        ),
      }
    }
    case 'reading':
      return ex.after(
        await ex.details(req.rowId, req.revision, (d) => {
          d.reading = req.prefs
        })
      )
    case 'folderKind': {
      if (req.kind !== null && !isFolderKind(req.kind)) throw new Error('資料夾類型不合法')
      // R-380: a folder made a game by hand is a game main folder too, so this one choice brings up the game page
      // (it shows only for a main folder). It writes what "mark as game main folder" writes and keeps what
      // detection found. Another type afterwards leaves the mark: "this is not a game folder" removes it. The
      // batch request below only sets the type, so a wide selection cannot turn a whole shelf into main folders.
      const detected =
        req.kind === 'game' ? (await ex.library.checkedRow(req.rowId)).boundary : undefined
      let marked = false
      const snapshot = await ex.details(req.rowId, req.revision, (d) => {
        if (req.kind === null) delete d.kind
        else d.kind = req.kind
        if (req.kind === 'game' && d.boundary?.state !== 'root') {
          d.boundary = {
            state: 'root',
            engines: d.boundary?.engines ?? detected?.engines ?? [],
            evidence: d.boundary?.evidence ?? detected?.evidence ?? ['使用者指定'],
          }
          marked = true
        }
        // R-457: a tool chosen as a game becomes a game (still the same protected ROOT).
        if (req.kind === 'game' && d.boundary?.role === 'tool') delete d.boundary.role
      })
      return {
        // A new main folder changes what the scan shows of it and inside it, as after the boundary request.
        ...ex.after(marked ? await ex.library.scan() : snapshot),
        notice: { level: 'success' as const, message: '已更新資料夾類型' },
      }
    }
    case 'folderKinds': {
      if (req.kind !== null && !isFolderKind(req.kind)) throw new Error('資料夾類型不合法')
      if (
        !Array.isArray(req.rows) ||
        !req.rows.length ||
        req.rows.length > 1000 ||
        new Set(req.rows.map((r) => r.rowId)).size !== req.rows.length
      ) {
        throw new Error('批次範圍不合法')
      }
      // Each folder keeps its own record: one that cannot be written is reported and the rest still change.
      const failed: string[] = []
      let saved = 0
      for (const item of req.rows) {
        try {
          await ex.details(item.rowId, item.revision, (d) => {
            if (req.kind === null) delete d.kind
            else d.kind = req.kind
          })
          saved++
        } catch (e) {
          failed.push(`${item.rowId}: ${String(e)}`)
        }
      }
      const snapshot = ex.library.snapshot()
      ex.index.sync(snapshot)
      return {
        snapshot,
        notice: completionNotice(
          saved,
          failed.length,
          fmt(
            '已指定 {0} 個資料夾的類型{1}',
            saved,
            failed.length ? fmt('\n失敗（已成功項目保留）：\n') + failed.join('\n') : ''
          )
        ),
      }
    }
    case 'playback': {
      const f = await ex.file(req.rowId, req.fileId)
      if (!f.mime.startsWith('video/')) throw new Error('不是影片')
      return ex.after(
        await ex.details(req.rowId, req.revision, (d) => {
          d.playback ??= {}
          const p = d.playback[req.fileId] ?? { time: 0 }
          p.time = req.time
          if (req.subtitle !== undefined) p.subtitle = req.subtitle
          if (req.settings) {
            p.settings ??= {}
            if (!req.subtitle) throw new Error('字幕來源未指定')
            p.settings[req.subtitle] = req.settings
          }
          d.playback[req.fileId] = p
        })
      )
    }
    case 'boundary': {
      if (
        !['root', 'candidate', 'not-game'].includes(req.state) ||
        (req.tool !== undefined && typeof req.tool !== 'boolean')
      ) {
        throw new Error('遊戲保護設定不正確')
      }
      const detected = (await ex.library.checkedRow(req.rowId)).boundary
      await ex.details(req.rowId, req.revision, (d) => {
        d.boundary = {
          state: req.state,
          engines: d.boundary?.engines ?? detected?.engines ?? [],
          evidence: d.boundary?.evidence ?? detected?.evidence ?? ['使用者指定'],
          // R-457: only a ROOT can be a tool; confirming it as a game or not-game drops the role.
          ...(req.state === 'root' && req.tool ? { role: 'tool' as const } : {}),
        }
      })
      break
    }
    case 'banner':
      return ex.after(
        await ex.details(req.rowId, req.revision, (d, r) => {
          if (!r.assets.some((a) => a.assetId === req.assetId)) {
            throw new Error('圖片不屬於此資料夾')
          }
          d.bannerAssetId = req.assetId
        })
      )
    case 'actionVisible': {
      const row = await ex.library.checkedRow(req.rowId)
      const project = ex.library
        .snapshot()
        .projects.find((p) => p.projectId === row.projectId)?.project
      if (typeof req.visible !== 'boolean') throw new Error('任務版型不存在')
      // R-315: the game page's own buttons are opt-in, kept as the list of extras shown.
      const extra = gameExtras.find((name) => 'extra-' + name === req.templateId)
      if (extra) {
        return ex.after(
          await ex.details(req.rowId, req.revision, (d) => {
            const shown = new Set(d.shownExtras)
            if (req.visible) shown.add(extra)
            else shown.delete(extra)
            if (shown.size) d.shownExtras = gameExtras.filter((name) => shown.has(name))
            else delete d.shownExtras
          })
        )
      }
      if (!project || !gameActionTemplates(project).some((t) => t.id === req.templateId)) {
        throw new Error('任務版型不存在')
      }
      return ex.after(
        await ex.details(req.rowId, req.revision, (d) => {
          const hidden = new Set(d.hiddenActions)
          if (req.visible) hidden.delete(req.templateId)
          else hidden.add(req.templateId)
          if (hidden.size) d.hiddenActions = [...hidden]
          else delete d.hiddenActions
        })
      )
    }
    case 'bindTarget': {
      const { row, record } = await ex.record(req.rowId, req.revision)
      const project = ex.library
        .snapshot()
        .projects.find((p) => p.projectId === row.projectId)?.project
      const template = project && gameActionTemplates(project).find((t) => t.id === req.templateId)
      if (!template) throw new Error('任務版型不存在')
      if (
        !Array.isArray(req.args) ||
        req.args.length > 100 ||
        !req.args.every(
          (arg) => typeof arg === 'string' && arg.length <= 10000 && !arg.includes('\0')
        ) ||
        (['url', 'folder', 'shortcut', 'file'].includes(template.kind) && req.args.length) ||
        (req.localeEmulator !== undefined && typeof req.localeEmulator !== 'boolean')
      ) {
        throw new Error('參數不合法')
      }
      let target: NonNullable<NonNullable<FolderRecord['details']>['targets']>[string]
      if (template.kind === 'url') {
        if (!httpUrl(req.url)) throw new Error('網址無法開啟')
        target = { kind: 'url', path: req.url!, relative: false, args: [] }
      } else if (template.kind === 'shortcut') {
        // Picked from the folder's own list, never through a file dialog that may resolve the shortcut to its target.
        const name = req.shortcut
        if (
          typeof name !== 'string' ||
          !/^[^\\/]+\.(lnk|url)$/i.test(name) ||
          name.includes('\0')
        ) {
          throw new Error('請選擇資料夾內的捷徑（.lnk／.url）')
        }
        await ex.targetPath(row.path, path.join(row.path, name), 'file')
        target = { kind: 'shortcut', path: name, relative: true, args: [] }
      } else {
        const chosen = await ex.desktop.choose(
          template.kind === 'file-app' ? 'exe' : template.kind === 'exe' ? 'game' : template.kind,
          row.path
        )
        if (!chosen) return { cancelled: true }
        const selected = await ex.targetPath(
          row.path,
          chosen,
          template.kind === 'folder'
            ? 'folder'
            : template.kind === 'file'
              ? 'file'
              : template.kind === 'exe'
                ? 'game'
                : 'exe'
        )
        // A bundled document is opened from inside the game folder only (R-306).
        if (template.kind === 'file' && (!selected.relative || !documentFile(selected.path))) {
          throw new Error('請選擇遊戲資料夾內的說明文件（PDF、HTML、TXT、MD、RTF）')
        }
        if (template.kind === 'file-app') {
          const file = await ex.desktop.choose('file', row.path)
          if (!file) return { cancelled: true }
          target = {
            kind: template.kind,
            ...(await ex.targetPath(row.path, file, 'file')),
            args: req.args,
            application: selected,
          }
        } else {
          target = {
            kind: template.kind,
            ...selected,
            args: template.kind === 'file' ? [] : req.args,
            ...(template.kind === 'exe' && req.localeEmulator ? { localeEmulator: true } : {}),
          }
        }
      }
      record.details ??= newDetails()
      record.details.targets ??= {}
      record.details.targets[template.id] = target
      validateDetails(record.details)
      await saveFolder(row.path, record, req.revision)
      break
    }
    case 'runTarget': {
      const row = await ex.library.checkedRow(req.rowId)
      const record = await readFolder(row.path)
      const p = ex.library.snapshot().projects.find((p) => p.projectId === row.projectId)!.project!
      const template = gameActionTemplates(p).find((t) => t.id === req.templateId)
      const target = record.details?.targets?.[req.templateId]
      if (!template || !target || template.kind !== target.kind) {
        throw new Error('任務還沒設定；請重新指定')
      }
      if (target.kind === 'url') {
        if (!httpUrl(target.path) || !ex.desktop.external) throw new Error('網址無法開啟')
        await ex.desktop.external(target.path)
      } else if (target.kind === 'shortcut') {
        if (!/\.(lnk|url)$/i.test(target.path)) throw new Error('捷徑類型不符')
        await ex.desktop.open(await ex.resolvedTarget(row.path, target, 'file'))
      } else {
        const file = await ex.resolvedTarget(
          row.path,
          target,
          target.kind === 'folder' ? 'folder' : target.kind === 'exe' ? 'game' : 'file'
        )
        if (target.kind === 'file' && !documentFile(file)) throw new Error('目標類型不符')
        if (target.kind === 'folder' || target.kind === 'file') await ex.desktop.open(file)
        // The extension is read from the real file, the same one the type check looked at.
        else if (target.kind === 'exe' && /\.swf$/i.test(await fs.realpath(file))) {
          // R-320: an .swf game opens in the Flash player chosen in the app settings (never run by M:orph).
          const player = ex.desktop.flashPlayer?.()
          if (!player) throw new Error('尚未設定 Flash 播放器；請到應用程式設定指定')
          const folderId = record.folderId
          await ex.desktop.launch(player, [file, ...target.args], (started, ended) =>
            ex.desktop.played?.(folderId, started, ended)
          )
        } else if (target.kind === 'exe' && target.localeEmulator) {
          // R-309: LEProc.exe starts the game in the chosen locale and exits at once, so this session is not
          // timed. R-319: a profile GUID runs with that profile, otherwise LE's default (Japanese).
          const runner = ex.desktop.localeEmulator?.()
          if (!runner) {
            throw new Error('尚未設定 Locale Emulator（LEProc.exe）；請到應用程式設定指定')
          }
          const profile = localeProfileId(target.localeEmulator)
            ? ['-runas', target.localeEmulator]
            : ['-run']
          await ex.desktop.launch(runner, [...profile, file, ...target.args])
        } else if (target.kind === 'exe') {
          const folderId = record.folderId
          await ex.desktop.launch(file, target.args, (started, ended) =>
            ex.desktop.played?.(folderId, started, ended)
          )
        } else {
          if (!target.application) throw new Error('還沒選應用程式')
          const application = await ex.resolvedTarget(row.path, target.application, 'exe')
          await ex.desktop.launch(application, [...target.args, file])
        }
      }
      return { notice: { level: 'success', message: '已開啟指定目標' } }
    }
    case 'gameExtras': {
      const row = await ex.library.checkedRow(req.rowId)
      const record = await readFolder(row.path).catch(() => undefined)
      const engines =
        row.boundary?.engines ?? (await detectGame(row.path).catch(() => undefined))?.engines ?? []
      const id = await steamAppId(row.path, record)
      const user = record?.details?.saveFolder
      const guess = user ? undefined : await engineSave(row.path, engines)
      const bound = new Set(
        Object.values(record?.details?.targets ?? {})
          .filter((t) => t.relative)
          .map((t) => t.path.toLowerCase())
      )
      return {
        extras: {
          ...(id ? { steamAppId: id } : {}),
          steamReady: !!ex.desktop.protocolReady?.('steam'),
          ...(store(record)
            ? { storeUrl: store(record)!.url, storeSite: store(record)!.site }
            : {}),
          save: user
            ? 'user'
            : guess?.state === 'found'
              ? 'engine'
              : guess?.state === 'pending'
                ? 'pending'
                : 'none',
          ...(guess && guess.state !== 'unknown' ? { saveEngine: engines.join('／') } : {}),
          suggestions: (await bundledSuggestions(row.path)).filter(
            (item) => !bound.has(item.name.toLowerCase())
          ),
          localeEmulator: !!ex.desktop.localeEmulator?.(),
          localeProfiles: await localeProfiles(ex.desktop.localeEmulator?.()),
          flashPlayer: !!ex.desktop.flashPlayer?.(),
        },
      }
    }
    // R-409: whether the extra buttons of several games can be used, for the cards on screen. Read-only and light:
    // no tools, profiles or engine detection beyond what the scan found; a folder that cannot be read is left out.
    case 'gameAvailability': {
      const steamReady = !!ex.desktop.protocolReady?.('steam')
      const out: Record<string, GameAvailability> = {}
      for (const rowId of [...new Set(req.rowIds)]) {
        const row = await ex.library.checkedRow(rowId).catch(() => undefined)
        if (!row || !isGameFolder(row)) continue
        const record = await readFolder(row.path).catch(() => undefined)
        const id = await steamAppId(row.path, record)
        const saved = record?.details?.saveFolder
          ? undefined
          : await engineSave(row.path, row.boundary?.engines ?? []).catch(() => undefined)
        out[rowId] = {
          steam: !id
            ? { ok: false, reason: '沒有 Steam App ID' }
            : steamReady
              ? { ok: true }
              : { ok: false, reason: '這台電腦沒有安裝 Steam' },
          store: store(record)
            ? { ok: true, site: store(record)!.site }
            : { ok: false, reason: '沒有商店網址' },
          save:
            record?.details?.saveFolder || saved?.state === 'found'
              ? { ok: true }
              : saved?.state === 'pending'
                ? { ok: false, reason: '還沒有存檔' }
                : { ok: false, reason: '找不到存檔資料夾' },
        }
      }
      return { availability: out }
    }
    case 'runExtra': {
      const row = await ex.library.checkedRow(req.rowId)
      const record = await readFolder(row.path)
      if (req.extra === 'steam') {
        const id = await steamAppId(row.path, record)
        if (!id) throw new Error('找不到這個遊戲的 Steam App ID')
        if (!ex.desktop.protocolReady?.('steam') || !ex.desktop.external) {
          throw new Error('這台電腦沒有安裝 Steam，無法用 Steam 啟動')
        }
        await ex.desktop.external('steam://run/' + id)
        return {}
      }
      if (req.extra === 'store') {
        const url = storeUrl(record)
        if (!url || !ex.desktop.external) throw new Error('這個資料夾沒有商店網址')
        await ex.desktop.external(url)
        return {}
      }
      const user = record.details?.saveFolder
      const guess = user
        ? undefined
        : await engineSave(
            row.path,
            row.boundary?.engines ??
              (await detectGame(row.path).catch(() => undefined))?.engines ??
              []
          )
      if (guess?.state === 'pending') {
        throw new Error('還沒有存檔；遊戲存檔之後才會出現這個資料夾')
      }
      const folder = user
        ? await ex.resolvedTarget(row.path, user, 'folder')
        : guess?.state === 'found'
          ? guess.folder
          : undefined
      if (!folder) throw new Error('找不到存檔資料夾；可以在遊戲操作裡自己指定')
      await ex.desktop.open(folder)
      return {}
    }
    case 'chooseSaveFolder': {
      if (req.clear) {
        return ex.after(
          await ex.details(req.rowId, req.revision, (d) => {
            delete d.saveFolder
          })
        )
      }
      const row = await ex.library.checkedRow(req.rowId, true)
      const chosen = await ex.desktop.choose('folder', row.path)
      if (!chosen) return { cancelled: true }
      const picked = await ex.targetPath(row.path, chosen, 'folder')
      return ex.after(
        await ex.details(req.rowId, req.revision, (d) => {
          d.saveFolder = picked
        })
      )
    }
    case 'addSuggestion': {
      const { row, record } = await ex.record(req.rowId, req.revision)
      const suggestion = (await bundledSuggestions(row.path)).find((item) => item.name === req.name)
      if (!suggestion) throw new Error('這個檔案不在建議清單裡')
      const kind = suggestion.role === 'config' ? 'exe' : 'file'
      const target = await ex.targetPath(
        row.path,
        path.join(row.path, suggestion.name),
        kind === 'exe' ? 'exe' : 'file'
      )
      if (!target.relative) throw new Error('目標路徑不合法')
      const link = ex.library.snapshot().projects.find((p) => p.projectId === row.projectId)
      const project = link?.project
      if (!project) throw new Error('專案尚未連結')
      // Reuse a button of the same kind and name that this game has not used yet; otherwise add one.
      const base = suggestion.role === 'config' ? '設定程式' : '說明書'
      const templates = gameActionTemplates(project)
      let template = templates.find(
        (t) =>
          t.kind === kind &&
          (t.label === base || t.label.startsWith(base + ' ')) &&
          !record.details?.targets?.[t.id]
      )
      if (!template) {
        if (templates.length >= 30) throw new Error('遊戲操作按鈕已達上限（30 個）')
        const used = new Set(templates.map((t) => t.label))
        let label = base
        for (let n = 2; used.has(label); n++) label = base + ' ' + n
        template = { id: randomUUID(), label, kind, color: '#868e96' }
        await ex.library.saveProject({ ...project, actionTemplates: [...templates, template] })
      }
      record.details ??= newDetails()
      record.details.targets ??= {}
      record.details.targets[template.id] = { kind, ...target, args: [] }
      validateDetails(record.details)
      await saveFolder(row.path, record, req.revision)
      return ex.after(await ex.library.refreshRecord(req.rowId))
    }
    case 'keyStatus':
      return { keys: (await ex.desktop.keyStore?.status()) ?? {} }
    case 'setKey': {
      if (!ex.desktop.keyStore) throw new Error('無法保存金鑰')
      await ex.desktop.keyStore.set(req.site, req.values)
      return { keys: await ex.desktop.keyStore.status() }
    }
    case 'clearKey': {
      await ex.desktop.keyStore?.clear(req.site)
      return { keys: (await ex.desktop.keyStore?.status()) ?? {} }
    }
    case 'testKey': {
      // The key works when the site answers with or without the sample work; only a refusal fails the test.
      const definition = keySite(req.site)
      const store = ex.desktop.keyStore
      if (!definition || !store) throw new Error('沒有這個網站')
      let result: 'ok' | 'failed' = 'ok'
      try {
        await metadata(definition.sample, fetch, undefined, { keyFor: (site) => store.get(site) })
      } catch (error) {
        if (
          (error instanceof SourceError && error.kind === 'restricted') ||
          (error instanceof Error && error.message === KEY_REJECTED)
        ) {
          result = 'failed'
        }
        // Not reaching the site says nothing about the key (R-461: nor does a busy or slow site).
        else if (error instanceof SourceError && ['offline', 'busy', 'slow'].includes(error.kind)) {
          throw error
        }
      }
      await store.mark(req.site, result)
      return { keys: await store.status() }
    }
    case 'folderFacts': {
      const folderFacts: Record<string, FolderFacts> = Object.create(null)
      for (const rowId of new Set(req.rowIds)) {
        try {
          // The same guard as the folder's content: no unreadable, stopped or game-protected folder.
          const row = await ex.library.readableRow(rowId)
          folderFacts[rowId] = await ex.facts.read(row.path)
        } catch {
          // Left out; the card keeps its dash.
        }
      }
      return { folderFacts }
    }
    case 'audioTags':
      return { audioTags: await streamFns.audioTags(ex, req.rowId, req.fileIds) }
    case 'novel': {
      const file = await ex.file(req.rowId, req.fileId)
      if (!/\.(txt|epub|md)$/i.test(file.file)) throw new Error('不是文字書（TXT／EPUB／MD）')
      // EPUB pictures reuse the read-only archive stream, registered like a comic archive.
      const token = randomUUID()
      const novel = await readNovel(
        file.file,
        (number) => `media://archive/${req.rowId}/${req.fileId}/${token}/${number}`
      )
      if (novel.format === 'epub' && (!req.summary || novel.cover)) {
        ex.remember(token, { file: file.file, index: await archiveIndex(file.file) })
      }
      // R-338: the file page only needs the title, author, cover and chapter names.
      if (req.summary) {
        return {
          novel: {
            ...novel,
            chapters: novel.chapters.map((chapter) => ({ title: chapter.title })),
            images: undefined,
          },
        }
      }
      return { novel }
    }
    case 'novelProgress': {
      const file = await ex.file(req.rowId, req.fileId)
      const row = await ex.library.checkedRow(req.rowId, true)
      const current = await readFolder(row.path)
      return ex.after(
        await ex.details(req.rowId, current.revision, (d) => {
          // Only the known fields are kept; anything else the window sent is dropped.
          const p = req.progress
          d.novels = {
            ...d.novels,
            [path.basename(file.file)]: {
              chapter: p.chapter,
              position: p.position,
              percent: p.percent,
              updated: p.updated,
              ...(Array.isArray(p.bookmarks)
                ? {
                    bookmarks: p.bookmarks.map((b) => ({
                      chapter: b?.chapter,
                      position: b?.position,
                      label: b?.label,
                    })),
                  }
                : {}),
            },
          }
        })
      )
    }
    case 'volumeProgress': {
      const file = await ex.file(req.rowId, req.fileId)
      const row = await ex.library.checkedRow(req.rowId, true)
      const current = await readFolder(row.path)
      if (!/\.(cbz|cbr|cb7|zip)$/i.test(file.file)) throw new Error('不是漫畫壓縮檔')
      if (!Number.isInteger(req.page) || !Number.isInteger(req.total) || req.total < 1) {
        throw new Error('閱讀頁碼不合法')
      }
      const page = Math.min(Math.max(req.page, 0), req.total - 1)
      return ex.after(
        await ex.details(req.rowId, current.revision, (d) => {
          d.volumes = {
            ...d.volumes,
            [path.basename(file.file)]: {
              page,
              total: req.total,
              updated: new Date().toISOString(),
            },
          }
          // The settings are the folder's, shared by every archive in it; the page is this archive's own.
          if (req.prefs) {
            const { page: _page, mode: _mode, ...settings } = req.prefs
            d.reading = {
              ...settings,
              ...(d.reading?.page !== undefined ? { page: d.reading.page } : {}),
              ...(d.reading?.mode !== undefined ? { mode: d.reading.mode } : {}),
            }
          }
        })
      )
    }
    case 'targetLocale':
      return ex.after(
        await ex.details(req.rowId, req.revision, (d) => {
          const target = d.targets?.[req.templateId]
          if (target?.kind !== 'exe') throw new Error('只有 EXE 操作可以用日文語系啟動')
          if (req.value === true) target.localeEmulator = true
          else if (localeProfileId(req.value)) target.localeEmulator = req.value
          else delete target.localeEmulator
        })
      )
    case 'chooseLocaleEmulator': {
      if (!ex.desktop.setLocaleEmulator) throw new Error('無法設定 Locale Emulator')
      if (req.clear) {
        await ex.desktop.setLocaleEmulator(undefined)
        return {}
      }
      const chosen = await ex.desktop.choose('exe')
      if (!chosen) return { cancelled: true }
      if (!/^leproc\.exe$/i.test(path.basename(chosen))) {
        throw new Error('請選擇 Locale Emulator 的 LEProc.exe')
      }
      const file = await fs.realpath(chosen)
      if (!/^leproc\.exe$/i.test(path.basename(file)) || !(await fs.stat(file)).isFile()) {
        throw new Error('請選擇 Locale Emulator 的 LEProc.exe')
      }
      await ex.desktop.setLocaleEmulator(file)
      return { localeEmulator: file }
    }
    case 'chooseFlashPlayer': {
      // R-320: picked in a main-process dialog; any .exe (Flash Player projector, Ruffle desktop).
      if (!ex.desktop.setFlashPlayer) throw new Error('無法設定 Flash 播放器')
      if (req.clear) {
        await ex.desktop.setFlashPlayer(undefined)
        return {}
      }
      const chosen = await ex.desktop.choose('exe')
      if (!chosen) return { cancelled: true }
      const file = await fs.realpath(chosen)
      if (!/\.exe$/i.test(file) || !(await fs.stat(file)).isFile()) {
        throw new Error('請選擇播放 Flash 的程式（.exe）')
      }
      await ex.desktop.setFlashPlayer(file)
      return { flashPlayer: file }
    }
    case 'chooseVideoPlayer': {
      // R-431: picked in a main-process dialog; any existing absolute .exe (PotPlayer, mpv, VLC…).
      if (!ex.desktop.setVideoPlayer) throw new Error('無法設定外部影片播放器')
      if (req.clear) {
        await ex.desktop.setVideoPlayer(undefined)
        return {}
      }
      const chosen = await ex.desktop.choose('exe')
      if (!chosen) return { cancelled: true }
      if (!path.isAbsolute(chosen)) throw new Error('請選擇播放影片的程式（.exe）')
      const file = await fs.realpath(chosen)
      if (!/\.exe$/i.test(file) || !(await fs.stat(file)).isFile()) {
        throw new Error('請選擇播放影片的程式（.exe）')
      }
      await ex.desktop.setVideoPlayer(file)
      return { videoPlayer: file }
    }
    case 'listShortcuts': {
      const row = await ex.library.checkedRow(req.rowId)
      const entries = await fs.readdir(row.path, { withFileTypes: true })
      return {
        shortcuts: entries
          .filter((e) => e.isFile() && /\.(lnk|url)$/i.test(e.name))
          .map((e) => e.name)
          .sort((a, b) => a.localeCompare(b, 'zh-Hant', { numeric: true })),
      }
    }
    case 'chooseSubtitle': {
      return ex.chooseSubtitle(req.rowId)
    }
    case 'embeddedSubtitles':
      return embeddedFns.embeddedList(ex, req.rowId, req.fileId, req.early)
    case 'embeddedSubtitle':
      return embeddedFns.embeddedText(ex, req.rowId, req.fileId, req.track, req.early, req.time)
    case 'embeddedPictures':
      return embeddedFns.embeddedPictures(ex, req.rowId, req.fileId, req.track, req.early, req.time)
    case 'subtitle': {
      let file: string
      let portable = false
      let token = req.fileId ?? req.externalToken ?? ''
      if (req.fileId) {
        const f = await ex.file(req.rowId, req.fileId)
        if (!SUBTITLE_EXTENSIONS.includes(path.extname(f.file).toLowerCase())) {
          throw new Error('字幕格式未支援')
        }
        file = f.file
        portable = true
      } else {
        const external = ex.externals.get(`${req.rowId}/${token}`)
        if (!external || external.rowId !== req.rowId) throw new Error('外部字幕未授權')
        file = external.file
      }
      if ((await fs.stat(file)).size > 5 * 1024 * 1024) throw new Error('字幕過大')
      const bytes = await fs.readFile(file)
      const text = new TextDecoder(req.encoding ?? 'utf-8', { fatal: true }).decode(bytes)
      parseSubtitles(text)
      if (req.import && !portable) {
        const row = await ex.library.checkedRow(req.rowId, true)
        const r = await readFolder(row.path)
        const id = randomUUID()
        const relativePath = `subtitles/${id}${path.extname(file).toLowerCase()}`
        const target = path.join(row.path, DATA_DIR, relativePath)
        await safePath(row.path, target)
        await fs.mkdir(path.dirname(target), { recursive: true })
        await fs.writeFile(target, bytes, { flag: 'wx' })
        r.details ??= newDetails()
        r.details.subtitles ??= []
        r.details.subtitles.push({ id, name: path.basename(file), relativePath })
        try {
          await saveFolder(row.path, r, r.revision)
        } catch (e) {
          await fs.unlink(target)
          throw e
        }
        portable = true
        token = id
        await ex.library.scan()
        await ex.content(req.rowId)
      }
      return {
        subtitle: { token, name: path.basename(file), text, portable },
        snapshot: ex.library.snapshot(),
      }
    }
    case 'cellImage': {
      const { row, record } = await ex.record(req.rowId, req.revision)
      const project = ex.library
        .snapshot()
        .projects.find((p) => p.projectId === row.projectId)!.project!
      const cell = projectImageCells(project).find((c) => c.cellId === req.cellId)
      if (
        !cell ||
        (req.assetId !== null && !record.assets.some((a) => a.assetId === req.assetId))
      ) {
        throw new Error('圖片組件或圖片不存在')
      }
      record.details ??= newDetails()
      record.details.cellImages ??= {}
      if (req.assetId === null) delete record.details.cellImages[cell.attributeId ?? cell.cellId]
      else record.details.cellImages[cell.attributeId ?? cell.cellId] = req.assetId
      await saveFolder(row.path, record, req.revision)
      break
    }
    case 'deleteImage': {
      // One record write drops the asset and every reference to it; the file goes only after that write succeeds.
      const { row, record } = await ex.record(req.rowId, req.revision)
      const asset = record.assets.find((a) => a.assetId === req.assetId)
      if (typeof req.assetId !== 'string' || !asset) throw new Error('圖片不存在')
      const file = path.join(row.path, DATA_DIR, asset.relativePath)
      await safePath(row.path, file)
      record.assets = record.assets.filter((a) => a.assetId !== req.assetId)
      const cellImages = record.details?.cellImages
      if (cellImages) {
        for (const [key, id] of Object.entries(cellImages)) {
          if (id === req.assetId) delete cellImages[key]
        }
      }
      if (record.details?.bannerAssetId === req.assetId) delete record.details.bannerAssetId
      if (record.details) validateDetails(record.details)
      await saveFolder(row.path, record, req.revision)
      // Only a regular file inside this folder's own assets directory that no other entry shares.
      if (!record.assets.some((a) => a.relativePath === asset.relativePath)) {
        try {
          await safePath(row.path, file)
          if ((await fs.lstat(file)).isFile()) await fs.unlink(file)
        } catch {
          // The record is already consistent; a leftover or missing file is harmless.
        }
      }
      break
    }
    case 'imageUrlPreview':
      return { imagePreview: await ex.imageUrlPreview(req.url) }
    case 'imageUrlApply':
      await ex.applyImageUrl(req)
      break
    case 'metadataPreview':
      return {
        preview: await ex.metadataPreview(req.source, req.provider, {
          release: req.release,
          trackCount: req.trackCount,
        }),
      }
    case 'metadataApply':
      await ex.applyMetadata(req)
      break
    default:
      throw new Error('不支援的操作')
  }
  return ex.after(await ex.library.scan())
}
