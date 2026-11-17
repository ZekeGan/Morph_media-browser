import { useMemo, useState } from 'react'
import { Alert, Button, Group, Stack, Text } from '@mantine/core'
import type { FolderRow } from '../../shared/model'
import type { ExplorerRequest, ExplorerResponse, MediaEntry } from '../../shared/explorer'
import { episodeLabel, matchEpisodes, parseEpisodeList } from '../../shared/episodes'
import { t as tr, useLocale } from '../i18n'

// R-423 (tentative): the episode list imported from TMDB (R-419) as the folder's attribute.
export function episodeListOf(row: FolderRow) {
  return parseEpisodeList(
    row.record?.attributes.find((attribute) => attribute.attributeId === 'tmdb-episodes')?.value
  )
}

const PREVIEW_ROWS = 40

// Matches the folder's videos to the episode list and shows the result; nothing is written until the user asks.
export function VideoEpisodes({
  row,
  videos,
  run,
}: {
  row: FolderRow
  videos: MediaEntry[]
  run: (req: ExplorerRequest) => Promise<ExplorerResponse | undefined>
}) {
  useLocale()
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const list = useMemo(() => episodeListOf(row), [row]),
    result = useMemo(() => matchEpisodes(videos, list), [videos, list]),
    saved = row.record?.details?.episodes,
    changed = result.matches.length > 0

  const write = async (episodes: NonNullable<typeof saved> | null) => {
    if (!row.record || busy) return
    setBusy(true)
    setError('')
    try {
      await run({ action: 'episodes', rowId: row.rowId, revision: row.record.revision, episodes })
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack gap="xs" className="player-episodes">
      {error && <Alert color="orange">{error}</Alert>}
      {list.length > 0 ? (
        <Text size="xs">
          {tr(
            '{0} 個影片可標上集名（共 {1} 個影片，{2} 個無法判斷）',
            result.matches.length,
            videos.length,
            result.skipped.length
          )}
        </Text>
      ) : (
        <Text size="xs" className="muted">
          {tr('尚未匯入集數清單（用 TMDB 影集網址匯入）')}
        </Text>
      )}
      {result.matches.length > 0 && (
        <ul className="player-episode-preview" aria-label={tr('集名預覽')}>
          {result.matches.slice(0, PREVIEW_ROWS).map((match) => (
            <li key={match.id} title={match.name}>
              <span>{match.name}</span>
              <span>{episodeLabel(match)}</span>
            </li>
          ))}
          {result.matches.length > PREVIEW_ROWS && (
            <li className="muted">{tr('還有 {0} 個', result.matches.length - PREVIEW_ROWS)}</li>
          )}
        </ul>
      )}
      {!row.readonly && (
        <Group gap="xs">
          <Button
            size="xs"
            variant="light"
            disabled={busy || !changed}
            onClick={() =>
              void write(
                Object.fromEntries(
                  result.matches.map((match) => [
                    match.id,
                    {
                      season: match.season,
                      episode: match.episode,
                      ...(match.title ? { title: match.title } : {}),
                    },
                  ])
                )
              )
            }
          >
            {tr('依集數清單標上集名')}
          </Button>
          {saved && Object.keys(saved).length > 0 && (
            <Button size="xs" variant="default" disabled={busy} onClick={() => void write(null)}>
              {tr('清除集名')}
            </Button>
          )}
        </Group>
      )}
    </Stack>
  )
}
