import { useEffect, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Popover,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core'
import {
  defaultSearchSources,
  isSearchSource,
  metadataSources,
  searchableSources,
  sourceForUrl,
  type SearchSourceId,
} from '../../shared/sources'
import type { FolderKind } from '../../shared/kind'
import { localeOptions } from '../../shared/locales'
import { keySite, type KeyStatus } from '../../shared/keys'
import type {
  ExplorerRequest,
  ExplorerResponse,
  MetadataCandidate,
  MetadataPreview,
  MetadataVersion,
} from '../../shared/explorer'
import { errorMessage } from '../../shared/notifications'
import type { FolderRow } from '../../shared/model'
import { t as tr } from '../i18n'
import { HelpLabel, HelpTip } from '../common/HelpTip'
import { Icon } from '../common/icons'
import { importedFieldLabels } from '../editor/importedFieldLabels'

type Run = (request: ExplorerRequest) => Promise<ExplorerResponse | undefined>

// The import draft lives in the folder panel, so switching tabs keeps the pasted address and the preview.
export function useSourceImport() {
  const [source, setSource] = useState(''),
    [preview, setPreview] = useState<MetadataPreview>(),
    [keys, setKeys] = useState<string[]>([]),
    [cover, setCover] = useState(true),
    // R-449: also keep the album's own cover (MusicBrainz), beside the version's.
    [albumCover, setAlbumCover] = useState(false),
    // R-422: positions of the source's pictures picked for import (none by default).
    [images, setImages] = useState<number[]>([]),
    [result, setResult] = useState(''),
    [replace, setReplace] = useState(false)
  return {
    source,
    setSource,
    preview,
    setPreview,
    keys,
    setKeys,
    cover,
    setCover,
    albumCover,
    setAlbumCover,
    images,
    setImages,
    result,
    setResult,
    replace,
    setReplace,
  }
}
export type SourceImport = ReturnType<typeof useSourceImport>

// "Fill in from a website": paste an address, preview what the site has, pick the fields to import.
// R-420: preview values that are notes, not data to import.
const noteKeys = ['COVER_STATUS', 'LANGUAGE_NOTICE']
// The notice value is "<preferred language ids>|<script of the text>".
function languageNotice(value: unknown) {
  const [ids, script] = String(value ?? '').split('|')
  if (!ids || !script) return undefined
  const names = Object.fromEntries(localeOptions.map((option) => [option.value, option.label]))
  const found = { ja: tr('日文'), ko: tr('韓文'), zh: tr('中文'), latin: tr('拉丁字母的語言') }[
    script
  ]
  return found
    ? tr(
        '這個來源沒有{0}的資料，顯示的是{1}',
        ids
          .split(',')
          .map((id) => names[id] ?? id)
          .join('、'),
        found
      )
    : undefined
}

export function FolderSourceImport({
  importer,
  row,
  busy,
  disabled,
  fieldDirty,
  kind,
  run,
  setError,
}: {
  importer: SourceImport
  row: FolderRow
  busy: boolean
  disabled: boolean
  fieldDirty: boolean
  kind: FolderKind
  run: Run
  setError: (error: string) => void
}) {
  const sourceLabels = importedFieldLabels()
  // R-449: MusicBrainz keeps the album's first release date apart from the version's own date.
  const fieldLabel = (key: string) =>
    preview?.provider === 'musicbrainz' && key === 'RELEASE_DATE'
      ? tr('最早發行日')
      : (sourceLabels[key] ?? key)
  const { source, setSource, preview, setPreview, keys, setKeys, cover, setCover } = importer,
    { images, setImages, albumCover, setAlbumCover } = importer
  // R-511: sources only offer screenshots now.
  const imageLabel = (image: { n?: number }) => tr('截圖 {0}', image.n ?? 0)
  // R-418: search the sources by the folder's name (editable); picking a candidate previews its address.
  const [query, setQuery] = useState(row.name),
    [searching, setSearching] = useState(false),
    [found, setFound] = useState<{ list: MetadataCandidate[]; failed: string[] }>()
  useEffect(() => {
    setQuery(row.name)
    setFound(undefined)
  }, [row.rowId])
  const sourceName = (id: string) => metadataSources.find((item) => item.id === id)?.name ?? id
  // R-424: which sources a name search asks. The choice is kept per folder kind on this computer (workspace prefs);
  // until the user has chosen for a kind, the kind's defaults are ticked. TMDB and FANZA need the user's own key.
  const [saved, setSaved] = useState<SearchSourceId[]>(),
    [searchKeys, setSearchKeys] = useState<Record<string, KeyStatus>>()
  useEffect(() => {
    let alive = true
    setSaved(undefined)
    void window.desktop
      .workspace()
      .then((state) => alive && setSaved(state.prefs.searchSources?.[kind]))
      .catch(() => {})
    void window.explorer
      .request({ action: 'keyStatus' })
      .then((result) => alive && setSearchKeys(result.keys ?? {}))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [kind])
  const needsKey = (id: string) =>
      (id === 'tmdb' || id === 'fanza') && !!searchKeys && !searchKeys[id]?.set,
    chosen = (saved ?? defaultSearchSources(kind)).filter((id) => !needsKey(id)),
    keyless = searchableSources.filter(needsKey)
  // R-443: the button says which sources are ticked (the first name, then "+N"); its tooltip lists them all.
  const chosenLabel = chosen.length
    ? sourceName(chosen[0]) + (chosen.length > 1 ? ' +' + (chosen.length - 1) : '')
    : tr('未選來源')
  const sourceGroups: { label: string; ids: SearchSourceId[] }[] = [
    { label: tr('一般'), ids: ['vndb', 'musicbrainz', 'anilist', 'bangumi', 'steam', 'dlsite'] },
    { label: tr('需要金鑰'), ids: ['tmdb', 'fanza'] },
    { label: tr('成人向'), ids: ['nhentai'] },
  ]
  const tick = (id: SearchSourceId, on: boolean) =>
    chooseSources(on ? [...chosen, id] : chosen.filter((item) => item !== id))
  const chooseSources = (value: string[]) => {
    const next = value.filter(isSearchSource)
    setSaved(next)
    void window.desktop
      .updateWorkspace({ action: 'searchSources', kind, value: next })
      .catch((error) =>
        setError(errorMessage(error instanceof Error ? error.message : String(error)))
      )
  }
  const search = async () => {
    setError('')
    setSearching(true)
    try {
      const result = await window.explorer.request({
        action: 'metadataSearch',
        query,
        sources: chosen,
      })
      setFound({ list: result.candidates ?? [], failed: result.failedSources ?? [] })
    } catch (error) {
      setError(errorMessage(error instanceof Error ? error.message : String(error)))
    } finally {
      setSearching(false)
    }
  }
  // The source is recognised from the pasted address alone; the preview button only works for a known site.
  const detected = sourceForUrl(source.trim()),
    [listOpen, setListOpen] = useState(false)
  // R-285: a site that needs the user's own key says so here, with a way to the settings, before anything is asked.
  const keyed = detected ? keySite(detected) : undefined,
    [keyStatus, setKeyStatus] = useState<Record<string, KeyStatus>>()
  useEffect(() => {
    if (!keyed) return
    let alive = true
    void window.explorer
      .request({ action: 'keyStatus' })
      .then((result) => alive && setKeyStatus(result.keys ?? {}))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [keyed?.id])
  // R-293: a store address (or FANZA without the key) is looked up through VNDB, and the badge says so.
  const viaVndb =
    (detected === 'vndb' && !/^https:\/\/vndb\.org\//.test(source.trim())) ||
    (detected === 'fanza' && !!keyStatus && !keyStatus.fanza?.set)
  const detectedName = viaVndb
    ? tr('經 VNDB')
    : metadataSources.find((item) => item.id === detected)?.name
  const missingKey =
    !!keyed && keyed.need === 'required' && !!keyStatus && !keyStatus[keyed.id]?.set
  const openKeys = () =>
    window.dispatchEvent(
      new CustomEvent('morph:open-settings', { detail: { tab: 'keys', site: keyed?.id } })
    )
  // R-359: also called with the related work's address (the same game on VNDB) to preview that source instead.
  // R-449: `release` asks a MusicBrainz album for one of its versions (null: album data only); switching versions keeps
  // what was ticked (fields new to this version start ticked).
  const loadPreview = async (address = source.trim(), release?: string | null) => {
    setError('')
    importer.setResult('')
    const provider = address === source.trim() ? detected : sourceForUrl(address)
    if (!provider) {
      setError(tr('無法辨識這個網址的來源'))
      return
    }
    const before = release !== undefined ? preview : undefined
    const result = await run({
      action: 'metadataPreview',
      source: address,
      provider,
      ...(release !== undefined ? { release } : {}),
      ...(row.contents?.audio ? { trackCount: row.contents.audio } : {}),
    })
    if (result?.preview) {
      const next = result.preview,
        all = next.values.filter((v) => !noteKeys.includes(v.key)).map((v) => v.key)
      setPreview(next)
      if (before) {
        setKeys(
          all.filter(
            (key) => keys.includes(key) || !before.values.some((value) => value.key === key)
          )
        )
        setCover((ticked) => (before.image ? ticked : true))
        setAlbumCover((ticked) => (before.albumImage ? ticked : !next.image))
        return
      }
      importer.setReplace(false)
      setKeys(all)
      setImages([])
      setCover(true)
      setAlbumCover(!next.image)
    }
  }
  // R-449: how a version reads in the menu: a matching track count first (it would be cut off at the end), then date ·
  // country · formats · tracks · label and catalogue number.
  const versionLabel = (version: MetadataVersion) =>
    [
      version.matches ? '✓ ' + tr('曲數相符') : undefined,
      version.date || '—',
      version.country,
      version.formats,
      version.tracks ? tr('{0} 首', version.tracks) : undefined,
      [version.label, version.catalog].filter(Boolean).join(' '),
      version.official ? undefined : tr('非正式'),
    ]
      .filter(Boolean)
      .join(' · ')
  return (
    <Stack gap="sm" className="folder-source">
      <div>
        <Group gap={4} wrap="nowrap">
          <Text fw={600}>{tr('從網站補充資訊')}</Text>
          <HelpTip text={tr('從網站抓作品的標題、標籤等資料。')} />
        </Group>
      </div>
      <section className="settings-section">
        <Stack gap="sm">
          <form
            className="source-search"
            onSubmit={(event) => {
              event.preventDefault()
              if (query.trim() && chosen.length && !searching && !disabled && !fieldDirty)
                void search()
            }}
          >
            <TextInput
              id="folder-source-search"
              disabled={busy}
              maxLength={200}
              label={
                <HelpLabel label={tr('用名稱搜尋')} help={tr('用名稱找作品，挑一個再預覽。')} />
              }
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              className="source-search-input"
            />
            <Popover position="bottom-end" withArrow shadow="md" width={300}>
              <Popover.Target>
                <Button
                  size="xs"
                  variant="default"
                  className="source-search-sources"
                  color={chosen.length ? undefined : 'red'}
                  disabled={busy}
                  rightSection={<Icon name="chevron-down" size={12} />}
                  aria-label={tr(
                    '搜尋的來源：{0}',
                    chosen.map(sourceName).join('、') || tr('未選來源')
                  )}
                  data-empty={chosen.length ? undefined : ''}
                  title={chosen.map(sourceName).join('、') || tr('未選來源')}
                >
                  <span className="source-search-sources-text">{chosenLabel}</span>
                </Button>
              </Popover.Target>
              <Popover.Dropdown className="source-search-menu">
                {sourceGroups.map((group) => (
                  <div key={group.label} className="source-search-group">
                    <Text size="xs" fw={600}>
                      {group.label}
                    </Text>
                    <Group gap="xs" mt={4} mb={8}>
                      {group.ids.map((id) => (
                        <Checkbox
                          key={id}
                          size="xs"
                          label={
                            needsKey(id) ? tr('{0}（需要金鑰）', sourceName(id)) : sourceName(id)
                          }
                          checked={chosen.includes(id)}
                          disabled={needsKey(id)}
                          onChange={(event) => tick(id, event.currentTarget.checked)}
                        />
                      ))}
                    </Group>
                  </div>
                ))}
                {keyless.length > 0 && (
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    onClick={() =>
                      window.dispatchEvent(
                        new CustomEvent('morph:open-settings', {
                          detail: { tab: 'keys', site: keyless[0] },
                        })
                      )
                    }
                  >
                    {tr('設定金鑰')}
                  </Button>
                )}
                <Button
                  size="compact-xs"
                  variant="subtle"
                  onClick={() => chooseSources(defaultSearchSources(kind))}
                >
                  {tr('還原此類型預設')}
                </Button>
              </Popover.Dropdown>
            </Popover>
            <Button
              type="submit"
              size="xs"
              loading={searching}
              disabled={disabled || fieldDirty || busy || !query.trim() || !chosen.length}
            >
              {tr('搜尋')}
            </Button>
          </form>
          {found && (
            <div className="source-candidates">
              {found.failed.length > 0 && (
                <Text size="xs" c="orange">
                  {tr('{0} 搜尋失敗', found.failed.map(sourceName).join('、'))}
                </Text>
              )}
              {!found.list.length && (
                <Text size="xs" c="dimmed">
                  {tr('沒有找到候選，可以改個名稱再搜尋，或直接貼上網址。')}
                </Text>
              )}
              <ul>
                {found.list.map((item) => (
                  <li key={item.url}>
                    <button
                      type="button"
                      disabled={disabled || fieldDirty || busy}
                      onClick={() => {
                        setSource(item.url)
                        void loadPreview(item.url)
                      }}
                    >
                      <span className="candidate-title">{item.title}</span>
                      {item.detail && <span className="candidate-detail">{item.detail}</span>}
                      {item.adult && (
                        <Badge variant="light" size="sm" color="red">
                          {tr('成人')}
                        </Badge>
                      )}
                      <Badge variant="light" size="sm">
                        {sourceName(item.provider)}
                      </Badge>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <TextInput
            id="folder-source-url"
            disabled={busy}
            label={<HelpLabel label={tr('作品網址或 ID')} help={tr('例如 https://vndb.org/v97')} />}
            placeholder={tr('貼上作品網址（Steam 可直接輸入 App ID）')}
            error={source.trim() && !detected ? tr('無法辨識這個網址的來源') : undefined}
            rightSectionWidth={detectedName ? 96 : undefined}
            rightSection={
              detectedName ? (
                <Badge color="teal" variant="light" leftSection={<Icon name="check" size={10} />}>
                  {detectedName}
                </Badge>
              ) : undefined
            }
            value={source}
            onChange={(event) => {
              setSource(event.currentTarget.value)
              setPreview(undefined)
            }}
          />
          {/* R-329: the supported sites, by kind, only when asked for. */}
          <div>
            <Button
              variant="subtle"
              size="compact-xs"
              aria-expanded={listOpen}
              onClick={() => setListOpen((open) => !open)}
            >
              {listOpen ? tr('收合支援的網站') : tr('支援的網站')}
            </Button>
            {listOpen && (
              <dl className="source-site-list">
                {[...new Set(metadataSources.map((item) => item.group))].map((group) => (
                  <div key={group}>
                    <dt>{tr(group)}</dt>
                    <dd>
                      {metadataSources
                        .filter((item) => item.group === group)
                        .map((item) => item.name)
                        .join('、')}
                    </dd>
                  </div>
                ))}
                <div>
                  <dt>{tr('經 VNDB')}</dt>
                  <dd>
                    Getchu、{tr('批評空間')}、Melonbooks、{tr('虎之穴')}、FANZA
                  </dd>
                </div>
              </dl>
            )}
          </div>
          <Group justify="flex-end">
            <Button
              disabled={disabled || fieldDirty || !detected || missingKey}
              loading={busy}
              onClick={() => void loadPreview()}
            >
              {tr('取得預覽')}
            </Button>
          </Group>
        </Stack>
      </section>

      {keyed &&
        (missingKey || (keyed.need === 'optional' && keyStatus && !keyStatus[keyed.id]?.set)) && (
          <Alert color={missingKey ? 'orange' : 'gray'}>
            <Group justify="space-between" wrap="nowrap">
              <span>
                {missingKey
                  ? tr('{0} 需要你自己的金鑰才能查資料。', keyed.name)
                  : tr('{0} 可以加上你的金鑰：{1}', keyed.name, tr(keyed.purpose))}
              </span>
              <Button size="xs" variant="light" onClick={openKeys}>
                {tr('前往設定')}
              </Button>
            </Group>
          </Alert>
        )}
      {importer.result && <Alert color="teal">{importer.result}</Alert>}
      {preview && (
        <Checkbox
          label={
            <HelpLabel
              label={tr('覆寫已填來源欄位')}
              help={tr('勾選後，網站的新資料會取代舊的；你自己填的不會被改。')}
            />
          }
          checked={importer.replace}
          onChange={(event) => importer.setReplace(event.currentTarget.checked)}
        />
      )}
      {preview && (
        <section className="settings-section source-preview">
          <Group align="start">
            {preview.image && (
              <img className="metadata-cover" src={preview.image} alt={tr('候選封面')} />
            )}
            <div>
              <Text fw={600}>{preview.title}</Text>
              <Text size="xs" c="dimmed" className="path">
                {preview.source}
              </Text>
            </div>
          </Group>
          {preview.versions && (
            <Stack gap={4} mt="sm">
              <Select
                label={tr('版本')}
                allowDeselect={false}
                disabled={disabled || busy}
                value={preview.version ?? ''}
                data={[
                  ...preview.versions.map((version) => ({
                    value: version.id,
                    label: versionLabel(version),
                  })),
                  { value: '', label: tr('不選版本，只用專輯資料') },
                ]}
                onChange={(value) =>
                  value !== null &&
                  value !== (preview.version ?? '') &&
                  void loadPreview(
                    String(
                      preview.values.find((v) => v.key === 'RELEASE_GROUP_URL')?.value ??
                        preview.source
                    ),
                    value || null
                  )
                }
              />
              {preview.versionPick === 'fallback' && !!row.contents?.audio && (
                <Text size="xs" c="orange">
                  {tr(
                    '沒有曲數與資料夾（{0} 首）相符的版本，先選了最早的正式版。',
                    row.contents.audio
                  )}
                </Text>
              )}
            </Stack>
          )}
          {preview.related && (
            <Alert color="blue" mt="sm" className="source-related">
              <Group gap="xs" justify="space-between" wrap="nowrap">
                <Text size="sm">
                  {tr('VNDB 也有這部作品：{0}', preview.related.title || preview.related.url)}
                </Text>
                <Button
                  size="compact-xs"
                  variant="light"
                  disabled={disabled}
                  onClick={() => {
                    const url = preview.related!.url
                    setSource(url)
                    void loadPreview(url)
                  }}
                >
                  {tr('改看 VNDB 的資料')}
                </Button>
              </Group>
            </Alert>
          )}
          <Text size="sm" c="dimmed" my="sm">
            {preview.provider === 'steam'
              ? tr('發售日保留 Steam 商店顯示的日期，不推定為作品首次發行日。')
              : tr('日期依來源保留，不推定為作品首次發行日。')}
            {/* Attribution the sources' terms ask for. */}
            {preview.provider === 'tmdb' &&
              ' ' + tr('本產品使用 TMDB API，但未經 TMDB 認可或認證。')}
            {preview.provider === 'fanza' && ' Powered by FANZA Webサービス'}
            {tr('預設只填空值；人工欄位保持原樣。')}
          </Text>
          <table className="source-diff">
            <thead>
              <tr>
                <th aria-label={tr('匯入')} />
                <th>{tr('欄位')}</th>
                <th>{tr('現值')}</th>
                <th>{tr('新值')}</th>
              </tr>
            </thead>
            <tbody>
              {preview.values
                .filter((v) => !noteKeys.includes(v.key))
                .map((v) => {
                  const next = Array.isArray(v.value) ? v.value.join('、') : String(v.value),
                    existing = row.record?.attributes.find(
                      (attribute) =>
                        attribute.attributeId ===
                        (preview.provider ?? 'eh') + '-' + v.key.toLowerCase()
                    ),
                    current = existing
                      ? Array.isArray(existing.value)
                        ? existing.value.join('、')
                        : String(existing.value)
                      : '',
                    same = !!existing && current === next
                  return (
                    <tr key={v.key} className={same ? 'same' : undefined}>
                      <td>
                        <Checkbox
                          aria-label={fieldLabel(v.key)}
                          checked={keys.includes(v.key)}
                          onChange={(e) =>
                            setKeys((list) =>
                              e.currentTarget.checked
                                ? [...list, v.key]
                                : list.filter((k) => k !== v.key)
                            )
                          }
                        />
                      </td>
                      <th scope="row">{fieldLabel(v.key)}</th>
                      <td>{current ? <LongValue text={current} /> : '—'}</td>
                      <td>{same ? tr('相同') : <LongValue text={next} />}</td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
          {preview.values.find((v) => v.key === 'COVER_STATUS') && (
            <Alert color="orange" mt="sm">
              {String(preview.values.find((v) => v.key === 'COVER_STATUS')!.value)}
            </Alert>
          )}
          {languageNotice(preview.values.find((v) => v.key === 'LANGUAGE_NOTICE')?.value) && (
            <Alert color="orange" mt="sm">
              {languageNotice(preview.values.find((v) => v.key === 'LANGUAGE_NOTICE')!.value)}
            </Alert>
          )}
          {preview.image && (
            <Checkbox
              mt="md"
              label={preview.albumImage ? tr('同時保存這個版本的封面') : tr('同時保存封面圖片')}
              checked={cover}
              onChange={(e) => setCover(e.currentTarget.checked)}
            />
          )}
          {preview.albumImage && (
            <Group gap="sm" mt="xs" wrap="nowrap">
              <img className="metadata-cover small" src={preview.albumImage} alt={tr('專輯封面')} />
              <Checkbox
                label={tr('同時保存專輯的封面')}
                checked={albumCover}
                onChange={(e) => setAlbumCover(e.currentTarget.checked)}
              />
            </Group>
          )}
          {!!preview.images?.length && (
            <fieldset className="source-images">
              <legend>{tr('同時保存來源的圖片')}</legend>
              <ul>
                {preview.images.map((image, index) => (
                  <li key={index}>
                    <img src={image.image} alt="" />
                    <Checkbox
                      size="xs"
                      label={imageLabel(image)}
                      checked={images.includes(index)}
                      onChange={(e) =>
                        setImages((list) =>
                          e.currentTarget.checked
                            ? [...list, index]
                            : list.filter((i) => i !== index)
                        )
                      }
                    />
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
          <Group justify="flex-end" mt="md" className="settings-savebar">
            <Button variant="default" disabled={busy} onClick={() => setPreview(undefined)}>
              {tr('取消預覽')}
            </Button>
            <Button
              disabled={
                disabled ||
                fieldDirty ||
                (!keys.length &&
                  !(preview.image && cover) &&
                  !(preview.albumImage && albumCover) &&
                  !images.length)
              }
              onClick={async () => {
                if (
                  await run({
                    action: 'metadataApply',
                    rowId: row.rowId,
                    revision: row.record!.revision,
                    token: preview.token,
                    keys,
                    image: !!preview.image && cover,
                    ...(preview.albumImage && albumCover ? { albumImage: true } : {}),
                    mode: importer.replace ? 'replace' : 'fill',
                    ...(images.length ? { images } : {}),
                  })
                ) {
                  importer.setResult(tr('已匯入選定資料，可至「資料」查看。'))
                  setPreview(undefined)
                }
              }}
            >
              {tr('匯入選定資料')}
            </Button>
          </Group>
        </section>
      )}
    </Stack>
  )
}

// R-332: a long value (a synopsis) shows a few lines and opens on a click.
function LongValue({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  if (text.length <= 160) return <>{text}</>
  return (
    <div className={'source-long' + (open ? ' open' : '')}>
      <span>{text}</span>
      <Button variant="subtle" size="compact-xs" onClick={() => setOpen(!open)}>
        {open ? tr('收合') : tr('展開全文')}
      </Button>
    </div>
  )
}
