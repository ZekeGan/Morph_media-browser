// Portable project & folder record coordinator: serializes mutations, tracks linked projects and
// snapshots, and delegates scan/cleanup/removal/export operations to sibling library-*.ts modules.
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { dateOrText } from '../shared/fields'
import { identifyImage } from '../shared/images'
import { projectImageCells } from '../shared/layouts'
import { fmt } from '../shared/message'
import {
  type CleanupPreview,
  type CleanupResult,
  DATA_DIR,
  defaultCells,
  type FieldDeletionPreview,
  type FolderRecord,
  type FullRemovalPreview,
  type LinkedProject,
  type Project,
  type ProjectInput,
  type ProjectRemovalPreview,
  type ScanProgress,
  type Snapshot,
  validateFolder,
  validateProject,
  withoutGroupCells,
} from '../shared/model'
import { type QueryField, stabilizeQuery } from '../shared/query'
import { isNewerFormat } from '../shared/upgrade'

import {
  atomicJson,
  ensureFolder,
  exists,
  folderFile,
  keyPath,
  message,
  missing,
  projectFile,
  readFolder,
  readJson,
  relPath,
  safePath,
  saveFolder,
  within,
} from './files'
import { detectGame, insideAppBundle } from './game-detection'
import * as cleanupFns from './library-cleanup'
import * as exportFns from './library-export'
import * as fieldRemovalFns from './library-field-removal'
import * as fieldUnifyFns from './library-field-unify'
import * as removalFns from './library-removal'
import * as scanFns from './library-scan'
import { type Change, type ManagedFile, managedTree } from './maintenance'

export interface PlanEntry {
  dir: string
  record: FolderRecord
  files: { path: string; hash: string }[]
}

interface ProjectRef {
  projectId: string
  root: string
}

interface Plan {
  preview: CleanupPreview
  entries: PlanEntry[]
  rowId?: string
  projectId?: string
}

interface RemovalPlan {
  preview: ProjectRemovalPreview
  root: string
  records: { dir: string; record: FolderRecord }[]
  files: { path: string; hash: string }[]
  definitions: string[]
  rootFiles?: { path: string; hash: string }[]
}

interface FieldDeletionPlan {
  preview: FieldDeletionPreview
  changes: Change[]
  guards: ManagedFile[]
  refs: string
  scope: string
  absent: string[]
}

// R-364: confirmed previews of unifying a field's text values to dates.
interface FieldUnifyPlan {
  changes: Change[]
  guards: ManagedFile[]
  refs: string
  scope: string
}

interface FullRemovalPlan {
  preview: FullRemovalPreview
  tree: Awaited<ReturnType<typeof managedTree>>
  refs: string
  guards: ManagedFile[]
  absent: string[]
}

export class Library {
  // Registered links & active snapshot state
  refs: ProjectRef[] = []
  state: Snapshot = {
    projects: [],
    rows: [],
    problems: [],
    progress: { visited: 0, created: 0, errors: 0, active: false, cancelled: false },
  }

  generation = 0

  // Confirmed two-step maintenance plans (accessed by sibling library-*.ts modules)
  plans = new Map<string, Plan>()
  removalPlans = new Map<string, RemovalPlan>()
  fieldPlans = new Map<string, FieldDeletionPlan>()
  unifyPlans = new Map<string, FieldUnifyPlan>()
  fullPlans = new Map<string, FullRemovalPlan>()
  importPlans = new Map<string, exportFns.ImportPlan>()

  // Scan cancellation, hidden-dir cache & serialized mutation queue
  cancelled = false
  hiddenKnown = new Set<string>()
  tail: Promise<unknown> = Promise.resolve()

  constructor(
    readonly userData: string,
    readonly progress: (p: ScanProgress) => void = () => {},
    readonly hide = true
  ) {}

  // A single queue owns every mutation. cancelScan intentionally bypasses it.
  run<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation)
    this.tail = next.catch(() => {})
    return next
  }

  snapshot() {
    return { ...structuredClone(this.state), generation: ++this.generation }
  }

  cancelScan() {
    this.cancelled = true
  }

  get registry() {
    return path.join(this.userData, 'poc-projects.json')
  }

  async init() {
    await fs.mkdir(this.userData, { recursive: true })
    if (await exists(this.registry)) {
      const refs = await readJson(this.registry)
      if (
        !Array.isArray(refs) ||
        !refs.every(
          (r) =>
            typeof r.projectId === 'string' &&
            /^[\w-]+$/.test(r.projectId) &&
            typeof r.root === 'string' &&
            path.isAbsolute(r.root)
        )
      ) {
        throw new Error('本機專案清單損壞；原檔保留，可從專案根重新連結')
      }
      this.refs = refs
    }
    return this.scan()
  }

  async persistRefs() {
    await atomicJson(this.registry, this.refs)
  }

  linked(projectId: string): LinkedProject {
    const linked = this.state.projects.find((p) => p.projectId === projectId)
    if (!linked?.project || linked.error) throw new Error('專案不可用，請重新連結或重新掃描')
    return linked
  }

  async currentProject(linked: LinkedProject) {
    const file = projectFile(linked.root, linked.projectId)
    await safePath(linked.root, file)
    const p = await readJson(file)
    validateProject(p)
    if (p.projectId !== linked.projectId) throw new Error('專案 ID 不符')
    return p
  }

  async protectedAncestor(dir: string) {
    if (insideAppBundle(dir)) return dir
    let parent = path.dirname(dir)
    while (parent !== path.dirname(parent)) {
      await safePath(parent, parent)
      const record = await readFolder(parent).catch((e) => {
        if (missing(e)) return undefined
        throw e
      })
      // Saved/manual boundaries always apply, including overlapping project roots.
      // Unregistered runtime boundaries also apply to deep internal paths.
      const state = record?.details?.boundary
      if (state?.state !== 'not-game' && (state || (await detectGame(parent)))) return parent
      parent = path.dirname(parent)
    }
    return undefined
  }

  async create(root: string, input: ProjectInput) {
    root = await fs.realpath(root)
    const protectedBy = await this.protectedAncestor(root)
    if (protectedBy) {
      throw new Error(fmt('這裡在受保護的遊戲或 App 裡面，請選擇外層資料夾：{0}', protectedBy))
    }
    const p: Project = {
      kind: 'media-viewer.project',
      schemaVersion: 4,
      projectId: randomUUID(),
      rootFolderId: 'pending',
      revision: 1,
      name: input.name,
      depth: input.depth,
      fieldBindings: [],
      cells: defaultCells(randomUUID),
      list: { itemsPerRow: 3, pageSize: 100 },
      excludedRelativePaths: [],
    }
    validateProject(p)
    p.cardView = { mode: 'single', level: 1 }
    if (input.scanAll) p.scanAll = true
    p.rootFolderId = (await ensureFolder(root, this.hide)).record.folderId
    const file = projectFile(root, p.projectId)
    await safePath(root, file)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await atomicJson(file, p)
    this.refs.push({ root, projectId: p.projectId })
    await this.persistRefs()
    return this.scan()
  }

  // Projects whose definitions already live in this folder, so a new project can offer to bring them back.
  // Only definitions `link` would accept are offered; `linked` means linked at this very folder (a project
  // moved from another place is still offered, because linking replaces its missing old location).
  async projectsAt(root: string) {
    const found: { projectId: string; name: string; linked: boolean }[] = []
    try {
      root = await fs.realpath(root)
      const rootId = (await readFolder(root)).folderId
      const dir = path.join(root, DATA_DIR, 'projects')
      for (const name of (await fs.readdir(dir))
        .filter((n) => /^[\w-]+\.json$/.test(n))
        .slice(0, 50)) {
        try {
          const file = path.join(dir, name)
          await safePath(root, file)
          if ((await fs.stat(file)).size > 2 * 1024 * 1024) continue
          const project = (await readJson(file)) as Project
          validateProject(project)
          if (name !== `${project.projectId}.json` || project.rootFolderId !== rootId) continue
          found.push({
            projectId: project.projectId,
            name: project.name,
            linked: this.refs.some(
              (ref) => ref.projectId === project.projectId && keyPath(ref.root) === keyPath(root)
            ),
          })
        } catch {
          // Unreadable or foreign files are not offered.
        }
      }
    } catch {
      // No folder record or no project folder: nothing to bring back.
    }
    return found
  }

  async link(root: string) {
    root = await fs.realpath(root)
    let record: FolderRecord
    try {
      record = await readFolder(root)
    } catch (error) {
      if (isNewerFormat(error)) throw error
      await safePath(root, `${folderFile(root)}.bak`)
      if (!(await exists(`${folderFile(root)}.bak`))) {
        if (missing(error)) {
          throw new Error(
            '這裡沒有可以重新連結的專案資訊或備份；如果專案已移除或清理，請重新新增專案，之前的設定不會自動還原'
          )
        }
        throw new Error(fmt('專案資訊讀不出來，也沒有可復原的備份；原檔保留：{0}', message(error)))
      }
      const backup = await readJson(`${folderFile(root)}.bak`)
      validateFolder(backup)
      record = backup
    }
    const dir = path.join(root, DATA_DIR, 'projects')
    await safePath(root, dir)
    const names = await fs.readdir(dir)
    const found: Project[] = []
    for (const name of new Set(
      names.filter((n) => /^[\w-]+\.json(\.bak)?$/.test(n)).map((n) => n.replace(/\.bak$/, ''))
    )) {
      await safePath(root, path.join(dir, name))
      let p: Project
      try {
        const current = withoutGroupCells(await readJson(path.join(dir, name)))
        validateProject(current)
        p = current
      } catch (error) {
        if (isNewerFormat(error)) throw error
        await safePath(root, path.join(dir, `${name}.bak`))
        const backup = withoutGroupCells(await readJson(path.join(dir, `${name}.bak`)))
        validateProject(backup)
        p = backup
      }
      if (p.rootFolderId !== record.folderId || name !== `${p.projectId}.json`) {
        throw new Error('專案與根資料夾身分不符')
      }
      const old = this.refs.find((r) => r.projectId === p.projectId)
      if (old && keyPath(old.root) !== keyPath(root) && (await exists(old.root))) {
        throw new Error('同一專案的原根仍存在；若是搬移，先取消舊連結後再連結新位置')
      }
      found.push(p)
    }
    if (!found.length) throw new Error('這個資料夾沒有專案設定；可以新增專案來讀取底下資料夾的資訊')
    for (const p of found) {
      this.refs = [
        ...this.refs.filter((r) => r.projectId !== p.projectId),
        { root, projectId: p.projectId },
      ]
    }
    await this.persistRefs()
    return this.scan()
  }

  async unlink(projectId: string) {
    this.refs = this.refs.filter((p) => p.projectId !== projectId)
    await this.persistRefs()
    return this.scan()
  }

  async maintenanceRecovery(token: string, roots: string[]) {
    if (roots.some((root) => within(root, this.userData))) {
      throw new Error('本機復原區位於修改範圍內，操作未執行')
    }
    const parent = path.join(this.userData, 'maintenance-backups')
    await safePath(this.userData, parent)
    await fs.mkdir(parent, { recursive: true })
    return path.join(parent, token)
  }

  fieldScope() {
    return fieldRemovalFns.fieldScope(this)
  }

  async previewDeleteField(projectId: string, attributeId: string): Promise<FieldDeletionPreview> {
    return fieldRemovalFns.previewDeleteField(this, projectId, attributeId)
  }

  async deleteField(token: string) {
    return fieldRemovalFns.deleteField(this, token)
  }

  async previewUnifyField(projectId: string, attributeId: string) {
    return fieldUnifyFns.previewUnifyField(this, projectId, attributeId)
  }

  async unifyField(token: string) {
    return fieldUnifyFns.unifyField(this, token)
  }

  async previewFullRemoval(projectId: string): Promise<FullRemovalPreview> {
    return removalFns.previewFullRemoval(this, projectId)
  }

  async fullRemoveProject(token: string): Promise<CleanupResult> {
    return removalFns.fullRemoveProject(this, token)
  }

  async exportProject(projectId: string, dest: string, appVersion: string) {
    return exportFns.exportProject(this, projectId, dest, appVersion)
  }

  async previewProjectImport(bundle: string, root: string) {
    return exportFns.previewProjectImport(this, bundle, root)
  }

  async applyProjectImport(token: string, overwrite: boolean) {
    return exportFns.applyProjectImport(this, token, overwrite)
  }

  async removableRoot(
    root: string,
    projectId: string
  ): Promise<{ path: string; hash: string }[] | undefined> {
    return removalFns.removableRoot(this, root, projectId)
  }

  async previewRemoveProject(projectId: string): Promise<ProjectRemovalPreview> {
    return removalFns.previewRemoveProject(this, projectId)
  }

  async removeProject(token: string): Promise<CleanupResult> {
    return removalFns.removeProject(this, token)
  }

  async saveProject(next: Project) {
    validateProject(next)
    const linked = this.linked(next.projectId)
    const current = await this.currentProject(linked)
    // Upgrade old saved strings only during an explicit project save. Resolve
    // against the old aliases before a rename; never infer an ambiguous identity.
    if (next.savedSearches?.some((search) => !search.queryAst)) {
      const fields: QueryField[] = []
      for (const entry of this.state.projects) {
        const project = entry.projectId === current.projectId ? current : entry.project
        if (!project) continue
        const known = new Map(
          project.fieldBindings.map((field) => [
            field.attributeId,
            {
              key: field.alias,
              type: field.type,
              attributeId: field.attributeId,
              projectId: entry.projectId,
            },
          ])
        )
        for (const row of this.state.rows.filter((row) => row.projectId === entry.projectId)) {
          for (const attribute of [
            ...(row.record?.attributes ?? []),
            ...(row.record?.projectOverrides[entry.projectId] ?? []),
          ]) {
            if (!known.has(attribute.attributeId)) {
              known.set(attribute.attributeId, {
                key: attribute.key,
                type: attribute.type,
                attributeId: attribute.attributeId,
                projectId: entry.projectId,
              })
            }
          }
        }
        fields.push(...known.values())
      }
      next = {
        ...next,
        savedSearches: next.savedSearches.map((search) => {
          if (search.queryAst) return search
          try {
            return {
              ...search,
              queryAst: stabilizeQuery(
                search.query,
                current.savedSearches?.some(
                  (old) => old.id === search.id && old.query === search.query
                )
                  ? fields
                  : fields.map((field) =>
                      field.projectId === next.projectId
                        ? {
                            ...field,
                            key:
                              next.fieldBindings.find(
                                (binding) => binding.attributeId === field.attributeId
                              )?.alias ?? field.key,
                          }
                        : field
                    )
              ),
            }
          } catch {
            return search
          }
        }),
      }
    }
    if (await this.protectedAncestor(linked.root)) {
      throw new Error('專案在受保護的遊戲或 App 裡面，不能修改設定')
    }
    if (
      next.rootFolderId !== current.rootFolderId ||
      JSON.stringify(next.excludedRelativePaths) !== JSON.stringify(current.excludedRelativePaths)
    ) {
      throw new Error('根身分與清理排除須由受控操作修改')
    }
    // R-510: the read-only look inside a game is gone; an older project drops it here.
    const { traversal: _traversal, ...kept } = next
    await atomicJson(
      projectFile(linked.root, next.projectId),
      { ...kept, revision: next.revision + 1 },
      next.revision
    )
    if (
      JSON.stringify([next.scanAll, next.depth]) !==
      JSON.stringify([current.scanAll, current.depth])
    ) {
      return this.scan()
    }
    linked.project = { ...structuredClone(kept), revision: next.revision + 1 }
    return this.snapshot()
  }

  async scan() {
    return scanFns.scan(this)
  }

  row(rowId: string, writable = false) {
    const row = (this.state.structure ?? this.state.rows).find((r) => r.rowId === rowId)
    if (!row) throw new Error('資料已更新，請重新選取')
    if (writable && (row.error || row.duplicate || row.stopped || row.readonly || !row.record)) {
      throw new Error('此項目前不可寫入，請先處理問題或重新啟用')
    }
    return row
  }

  async checkedRow(rowId: string, writable = false) {
    const row = this.row(rowId, writable)
    const root = this.linked(row.projectId).root
    await safePath(root, row.path)
    if (writable && (insideAppBundle(row.path) || (await this.protectedAncestor(row.path)))) {
      throw new Error('這裡在受保護的遊戲或 App 裡面，不能寫入')
    }
    if (row.record) {
      const current = await readFolder(row.path)
      if (current.folderId !== row.record.folderId) {
        throw new Error('目前位置已是另一資料夾，請重新掃描')
      }
    }
    return row
  }

  async readableRow(rowId: string) {
    const row = await this.checkedRow(rowId)
    if (
      !row.record ||
      row.readonly ||
      row.stopped ||
      row.error ||
      row.duplicate ||
      (await this.protectedAncestor(row.path))
    ) {
      throw new Error('這個資料夾還沒有資訊，或在受保護的遊戲裡面')
    }
    return row
  }

  async refreshRecord(rowId: string) {
    const row = await this.checkedRow(rowId)
    const record = await readFolder(row.path)
    for (const item of new Set([...(this.state.structure ?? []), ...this.state.rows])) {
      if (keyPath(item.path) === keyPath(row.path)) item.record = structuredClone(record)
    }
    return this.snapshot()
  }

  async visit(rowId: string) {
    return scanFns.visit(this, rowId)
  }

  async saveValues(rowId: string, revision: number, values: Record<string, string>) {
    const row = await this.checkedRow(rowId, true)
    const p = this.linked(row.projectId).project!
    const record = await readFolder(row.path)
    const allowed = new Map([
      // Only text fields: a number, date or other typed field is never stored as text here (R-247).
      ...p.fieldBindings
        .filter((f) => f.type === 'string')
        .map((f) => [f.attributeId, f.alias] as const),
      ...record.attributes
        .filter((a) => a.type === 'string')
        .map((a) => [a.attributeId, a.key] as const),
    ])
    for (const [attributeId, value] of Object.entries(values)) {
      if (p.fieldBindings.some((f) => f.attributeId === attributeId && f.type !== 'string')) {
        throw new Error('欄位格式不符，不自動轉換')
      }
      if (!allowed.has(attributeId) || typeof value !== 'string' || value.length > 10000) {
        throw new Error('文字欄位不合法或超過 10,000 字')
      }
      const old = record.attributes.find((a) => a.attributeId === attributeId)
      // A date saved before the field became text is replaced by the text (R-240); other types are never converted.
      if (old && !dateOrText(old.type, 'string')) throw new Error('欄位格式不符，不自動轉換')
      if (!old && !value) continue
      record.attributes = [
        ...record.attributes.filter((a) => a.attributeId !== attributeId),
        { attributeId, key: allowed.get(attributeId)!, type: 'string', value, source: 'manual' },
      ]
    }
    await saveFolder(row.path, record, revision)
    return this.scan()
  }

  async addImage(rowId: string, revision: number, source: string, cellId?: string) {
    const row = await this.checkedRow(rowId, true)
    const record = await readFolder(row.path)
    const bytes = await fs.readFile(source)
    const cell =
      cellId === undefined
        ? undefined
        : projectImageCells(
            this.state.projects.find((p) => p.projectId === row.projectId)!.project!
          ).find((c) => c.cellId === cellId)
    if (cellId !== undefined && !cell) throw new Error('圖片組件不存在，請先保存版面')
    const identified = identifyImage(bytes)
    const media = identified ? [identified.ext, identified.mime] : undefined
    if (!media) throw new Error('圖片格式未支援，請使用 PNG、JPEG、GIF、WebP、BMP、AVIF 或 ICO')
    if (record.revision !== revision) throw new Error('版本衝突，請重新載入後再選圖')
    const assetId = randomUUID()
    const relativePath = `assets/${assetId}.${media[0]}`
    const target = path.join(row.path, DATA_DIR, relativePath)
    await safePath(row.path, target)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, bytes, { flag: 'wx' })
    record.assets.push({
      assetId,
      relativePath,
      originalName: path.basename(source),
      mediaType: media[1],
    })
    if (cell) {
      record.details ??= { schemaVersion: 1 }
      record.details.cellImages ??= {}
      record.details.cellImages[cell.attributeId ?? cell.cellId] = assetId
    }
    try {
      await saveFolder(row.path, record, revision)
    } catch (e) {
      await fs.unlink(target)
      throw e
    }
    return this.scan()
  }

  async asset(rowId: string, assetId: string) {
    const row = await this.checkedRow(rowId)
    const record = await readFolder(row.path)
    const asset = record.assets.find((a) => a.assetId === assetId)
    if (!asset) throw new Error('圖片不存在')
    const file = path.join(row.path, DATA_DIR, asset.relativePath)
    await safePath(row.path, file)
    return { file, mediaType: asset.mediaType }
  }

  async resume(rowId: string) {
    const row = this.row(rowId)
    if (row.readonly || (await this.protectedAncestor(row.path))) {
      throw new Error('這個資料夾在受保護的遊戲或 App 裡面')
    }
    for (const linked of this.state.projects) {
      if (linked.project && !linked.error && within(linked.root, row.path)) {
        const p = await this.currentProject(linked)
        const rel = relPath(linked.root, row.path)
        await atomicJson(
          projectFile(linked.root, p.projectId),
          {
            ...p,
            revision: p.revision + 1,
            excludedRelativePaths: p.excludedRelativePaths.filter((r) => r !== rel),
          },
          p.revision
        )
      }
    }
    return this.scan()
  }

  async copyIdentity(rowId: string) {
    const row = await this.checkedRow(rowId)
    const record = await readFolder(row.path)
    if (row.readonly || (await this.protectedAncestor(row.path))) {
      throw new Error('這個資料夾在受保護的遊戲或 App 裡面')
    }
    if (!row.duplicate) throw new Error('此項不是重複 ID')
    if (this.refs.some((r) => keyPath(r.root) === keyPath(row.path))) {
      throw new Error('副本本身是專案根；先取消此根專案連結，再於父專案處理副本')
    }
    record.folderId = randomUUID()
    record.revision++
    await atomicJson(folderFile(row.path), record, record.revision - 1)
    return this.scan()
  }

  async restore(rowId: string) {
    return cleanupFns.restore(this, rowId)
  }

  async restoreProject(projectId: string) {
    return cleanupFns.restoreProject(this, projectId)
  }

  async previewCleanup(
    rowId?: string,
    scope: 'folder' | 'private' | 'tree' | 'all' = 'folder'
  ): Promise<CleanupPreview> {
    return cleanupFns.previewCleanup(this, rowId, scope)
  }

  async cleanup(token: string, restart: boolean): Promise<CleanupResult> {
    return cleanupFns.cleanup(this, token, restart)
  }
}
