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
import { useEffect, useState } from 'react'

import type {
  ExplorerRequest,
  ExplorerResponse,
  MetadataCandidate,
  MetadataPreview,
  MetadataVersion,
} from '../../shared/explorer'
import { keySite, type KeyStatus } from '../../shared/keys'
import type { FolderKind } from '../../shared/kind'
import { localeOptions } from '../../shared/locales'
import type { FolderRow } from '../../shared/model'
import { errorMessage } from '../../shared/notifications'
import {
  defaultSearchSources,
  isSearchSource,
  metadataSources,
  searchableSources,
  type SearchSourceId,
  sourceForUrl,
} from '../../shared/sources'

import { Icon } from '../common/icons'
import { importedFieldLabels } from '../editor/importedFieldLabels'
import { t as tr } from '../i18n'

type Run = (request: ExplorerRequest) => Promise<ExplorerResponse | undefined>

// The import draft lives in the folder panel, so switching tabs keeps the pasted address and the preview.
export function useSourceImport() {
  const [source, setSource] = useState('')
  const [preview, setPreview] = useState<MetadataPreview>()
  const [keys, setKeys] = useState<string[]>([])
  const [cover, setCover] = useState(true)
  // R-449: also keep the album's own cover (MusicBrainz), beside the version's.
  const [albumCover, setAlbumCover] = useState(false)
  // R-422: positions of the source's pictures picked for import (none by default).
  const [images, setImages] = useState<number[]>([])
  const [result, setResult] = useState('')
  const [replace, setReplace] = useState(false)
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
  openSignal = 0,
}: {
  importer: SourceImport
  row: FolderRow
  busy: boolean
  disabled: boolean
  fieldDirty: boolean
  kind: FolderKind
  run: Run
  setError: (error: string) => void
  // R-549: incremented when a "still to add" button asks to open the import area.
  openSignal?: number
}) {
  const sourceLabels = importedFieldLabels()
  // R-449: MusicBrainz keeps the album's first release date apart from the version's own date.
  const fieldLabel = (key: string) =>
    preview?.provider === 'musicbrainz' && key === 'RELEASE_DATE'
      ? tr('最早發行日')
      : (sourceLabels[key] ?? key)
  const { source, setSource, preview, setPreview, keys, setKeys, cover, setCover } = importer
  const { images, setImages, albumCover, setAlbumCover } = importer
  // R-511: sources only offer screenshots now.
  const imageLabel = (image: { n?: number }) => tr('截圖 {0}', image.n ?? 0)
  // R-562: single smart input holds either a search keyword (defaults to folder name) or a pasted URL/App ID.
  const [searching, setSearching] = useState(false)
  const [found, setFound] = useState<{ list: MetadataCandidate[]; failed: string[] }>()
  // R-549: collapsed to a compact action bar by default; opens on click, via todo shortcut, or while active.
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    setSource(row.name)
    setFound(undefined)
    setExpanded(false)
  }, [row.rowId])
  useEffect(() => {
    if (openSignal > 0) setExpanded(true)
  }, [openSignal])
  const shown = expanded || !!preview || !!found || !!importer.result
  const sourceName = (id: string) => metadataSources.find((item) => item.id === id)?.name ?? id
  // R-424: which sources a name search asks. The choice is kept per folder kind on this computer (workspace prefs);
  // until the user has chosen for a kind, the kind's defaults are ticked. TMDB and FANZA need the user's own key.
  const [saved, setSaved] = useState<SearchSourceId[]>()
  const [searchKeys, setSearchKeys] = useState<Record<string, KeyStatus>>()
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
    (id === 'tmdb' || id === 'fanza') && !!searchKeys && !searchKeys[id]?.set
  const chosen = (saved ?? defaultSearchSources(kind)).filter((id) => !needsKey(id))
  const keyless = searchableSources.filter(needsKey)
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
  const search = async (term = source.trim()) => {
    if (!term) return
    setError('')
    setSearching(true)
    try {
      const result = await window.explorer.request({
        action: 'metadataSearch',
        query: term,
        sources: chosen,
      })
      setFound({ list: result.candidates ?? [], failed: result.failedSources ?? [] })
    } catch (error) {
      setError(errorMessage(error instanceof Error ? error.message : String(error)))
    } finally {
      setSearching(false)
    }
  }
  // R-562: smart input detects URLs/App IDs automatically; everything else searches by name.
  const trimmed = source.trim()
  const detected = sourceForUrl(trimmed)
  const unknownUrl = /^https?:\/\//i.test(trimmed) && !detected
  // R-285: a site that needs the user's own key says so here, with a way to the settings, before anything is asked.
  const keyed = detected ? keySite(detected) : undefined
  const [keyStatus, setKeyStatus] = useState<Record<string, KeyStatus>>()
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
      const next = result.preview
      const all = next.values.filter((v) => !noteKeys.includes(v.key)).map((v) => v.key)
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
  const importableValues = preview ? preview.values.filter((v) => !noteKeys.includes(v.key)) : []
  const allSelected = importableValues.length > 0 && keys.length === importableValues.length
  return (
    <Stack gap="xs" className="folder-source">
      <div className="source-import-bar">
        <Button
          size="xs"
          variant={shown ? 'light' : 'default'}
          leftSection={<Icon name="search" size={14} />}
          rightSection={<Icon name={shown ? 'chevron-down' : 'chevron-right'} size={12} />}
          aria-expanded={shown}
          onClick={() => setExpanded((value) => !value)}
        >
          {tr('從網站匯入…')}
        </Button>
        {!shown && (
          <span className="source-import-summary" title={chosen.map(sourceName).join('、')}>
            {chosenLabel}
          </span>
        )}
      </div>
      {shown && (
        <>
          <section className="settings-section source-import-panel">
            <Stack gap="xs">
              <form
                className="source-search"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (disabled || fieldDirty || busy || !trimmed || unknownUrl) return
                  if (detected) {
                    if (!missingKey) void loadPreview(trimmed)
                  } else if (chosen.length && !searching) {
                    void search(trimmed)
                  }
                }}
              >
                <TextInput
                  id="folder-source-search"
                  size="xs"
                  disabled={busy}
                  maxLength={500}
                  aria-label={tr('搜尋名稱或貼上網址')}
                  placeholder={tr('輸入作品名稱、網址或 Steam App ID')}
                  error={unknownUrl ? tr('無法辨識這個網址的來源') : undefined}
                  rightSectionWidth={detectedName ? 94 : undefined}
                  rightSection={
                    detectedName ? (
                      <Badge
                        size="xs"
                        color="teal"
                        variant="light"
                        leftSection={<Icon name="check" size={10} />}
                      >
                        {detectedName}
                      </Badge>
                    ) : undefined
                  }
                  value={source}
                  onChange={(event) => {
                    setSource(event.currentTarget.value)
                    if (preview) setPreview(undefined)
                  }}
                  className="source-search-input"
                />
                <Popover position="bottom-end" withArrow shadow="md" width={310}>
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
                                needsKey(id)
                                  ? tr('{0}（需要金鑰）', sourceName(id))
                                  : sourceName(id)
                              }
                              checked={chosen.includes(id)}
                              disabled={needsKey(id)}
                              onChange={(event) => tick(id, event.currentTarget.checked)}
                            />
                          ))}
                        </Group>
                      </div>
                    ))}
                    <Group gap="xs" mb={8}>
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
                    </Group>
                    <div className="source-supported-footer">
                      <Text size="xs" fw={600} c="dimmed" mb={4}>
                        {tr('支援的網站')}
                      </Text>
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
                    </div>
                  </Popover.Dropdown>
                </Popover>
                <Button
                  type="submit"
                  size="xs"
                  loading={detected ? busy : searching}
                  disabled={
                    disabled ||
                    fieldDirty ||
                    busy ||
                    !trimmed ||
                    unknownUrl ||
                    (detected ? missingKey : !chosen.length)
                  }
                >
                  {detected || unknownUrl ? tr('取得預覽') : tr('搜尋')}
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
                      {tr('沒有找到結果，可以改個名稱再搜尋，或直接貼上網址。')}
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
            </Stack>
          </section>

          {keyed &&
            (missingKey ||
              (keyed.need === 'optional' && keyStatus && !keyStatus[keyed.id]?.set)) && (
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
            <section className="settings-section source-preview">
              <div className="source-preview-head">
                {preview.image && (
                  <img className="metadata-cover" src={preview.image} alt={tr('可選的封面')} />
                )}
                <div className="source-preview-title">
                  <Text fw={600} size="sm">
                    {preview.title}
                  </Text>
                  <Text size="xs" c="dimmed" className="path">
                    {preview.source}
                  </Text>
                  {preview.image && (
                    <Checkbox
                      size="xs"
                      mt={6}
                      label={
                        preview.albumImage ? tr('同時保存這個版本的封面') : tr('同時保存封面圖片')
                      }
                      checked={cover}
                      onChange={(e) => setCover(e.currentTarget.checked)}
                    />
                  )}
                  {preview.albumImage && (
                    <Group gap="xs" mt={4} wrap="nowrap">
                      <img
                        className="metadata-cover small"
                        src={preview.albumImage}
                        alt={tr('專輯封面')}
                      />
                      <Checkbox
                        size="xs"
                        label={tr('同時保存專輯的封面')}
                        checked={albumCover}
                        onChange={(e) => setAlbumCover(e.currentTarget.checked)}
                      />
                    </Group>
                  )}
                </div>
              </div>
              {preview.versions && (
                <Stack gap={4} mt="xs">
                  <Select
                    size="xs"
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
                <Alert color="blue" mt="xs" className="source-related">
                  <Group gap="xs" justify="space-between" wrap="nowrap">
                    <Text size="xs">
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
              {importableValues.length > 0 && (
                <div className="source-preview-fields">
                  <div className="source-preview-fields-header">
                    <Text size="xs" fw={600} c="dimmed">
                      {tr('可匯入欄位 ({0}/{1})', keys.length, importableValues.length)}
                    </Text>
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      onClick={() =>
                        setKeys(allSelected ? [] : importableValues.map((item) => item.key))
                      }
                    >
                      {allSelected ? tr('取消全選') : tr('全選')}
                    </Button>
                  </div>
                  <div className="source-preview-list">
                    {importableValues.map((v) => {
                      const next = Array.isArray(v.value) ? v.value.join('、') : String(v.value)
                      const existing = row.record?.attributes.find(
                        (attribute) =>
                          attribute.attributeId ===
                          (preview.provider ?? 'eh') + '-' + v.key.toLowerCase()
                      )
                      const current = existing
                        ? Array.isArray(existing.value)
                          ? existing.value.join('、')
                          : String(existing.value)
                        : ''
                      const same = !!existing && current === next
                      const label = fieldLabel(v.key)
                      return (
                        <div
                          key={v.key}
                          className={'source-preview-item' + (same ? ' is-same' : '')}
                        >
                          <Checkbox
                            size="xs"
                            aria-label={label}
                            checked={keys.includes(v.key)}
                            onChange={(e) =>
                              setKeys((list) =>
                                e.currentTarget.checked
                                  ? [...list, v.key]
                                  : list.filter((k) => k !== v.key)
                              )
                            }
                          />
                          <div className="source-preview-item-body">
                            <div className="source-preview-item-top">
                              <span className="source-preview-label">{label}</span>
                              {same && (
                                <Badge size="xs" variant="light" color="gray">
                                  {tr('相同')}
                                </Badge>
                              )}
                            </div>
                            {!same && (
                              <div className="source-preview-value">
                                <LongValue text={next} />
                              </div>
                            )}
                            {current && !same && (
                              <div className="source-preview-old">{tr('原：{0}', current)}</div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
              {preview.values.find((v) => v.key === 'COVER_STATUS') && (
                <Alert color="orange" mt="xs">
                  {String(preview.values.find((v) => v.key === 'COVER_STATUS')!.value)}
                </Alert>
              )}
              {languageNotice(preview.values.find((v) => v.key === 'LANGUAGE_NOTICE')?.value) && (
                <Alert color="orange" mt="xs">
                  {languageNotice(preview.values.find((v) => v.key === 'LANGUAGE_NOTICE')!.value)}
                </Alert>
              )}
              {!!preview.images?.length && (
                <details className="source-images-fold">
                  <summary>
                    <span>{tr('更多圖片 ({0})', preview.images.length)}</span>
                    {images.length > 0 && (
                      <Badge size="xs" variant="light" color="blue">
                        {tr('已選 {0}', images.length)}
                      </Badge>
                    )}
                  </summary>
                  <div className="source-images-grid">
                    {preview.images.map((image, index) => {
                      const picked = images.includes(index)
                      const label = imageLabel(image)
                      return (
                        <button
                          key={index}
                          type="button"
                          className={'source-image-tile' + (picked ? ' picked' : '')}
                          aria-pressed={picked}
                          aria-label={label}
                          onClick={() =>
                            setImages((list) =>
                              picked ? list.filter((i) => i !== index) : [...list, index]
                            )
                          }
                        >
                          <img src={image.image} alt="" />
                          {picked && (
                            <span className="source-image-check" aria-hidden="true">
                              <Icon name="check" size={11} />
                            </span>
                          )}
                          <span className="source-image-caption">{label}</span>
                        </button>
                      )
                    })}
                  </div>
                </details>
              )}
              <Text size="xs" c="dimmed" mt="xs">
                {tr('日期依網站標示；你手動改過的欄位不會被覆蓋。')}
                {preview.provider === 'tmdb' &&
                  ' ' + tr('本產品使用 TMDB API，但未經 TMDB 認可或認證。')}
                {preview.provider === 'fanza' && ' Powered by FANZA Webサービス'}
              </Text>
              <div className="settings-savebar source-preview-bar">
                <Checkbox
                  size="xs"
                  label={tr('更新已從網站匯入的欄位')}
                  checked={importer.replace}
                  onChange={(event) => importer.setReplace(event.currentTarget.checked)}
                />
                <Group gap="xs" wrap="nowrap">
                  <Button
                    size="xs"
                    variant="default"
                    disabled={busy}
                    onClick={() => setPreview(undefined)}
                  >
                    {tr('取消預覽')}
                  </Button>
                  <Button
                    size="xs"
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
              </div>
            </section>
          )}
        </>
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
