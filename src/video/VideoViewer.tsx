import { Accordion, Button } from '@mantine/core'
import { Video, VideoPlayer } from '@videojs/react/video'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  defaultSubtitle,
  type EmbeddedPictures,
  type EmbeddedSubtitleInfo,
  type ExplorerRequest,
  type ExplorerResponse,
  type MediaEntry,
  type SubtitlePrefs,
} from '../../shared/explorer'
import type { FolderRow } from '../../shared/model'
import { type Cue, parseSubtitles } from '../../shared/subtitles'
import { chooseSubtitleTrack, trackPreference } from '../../shared/subtitleTrack'

import { Icon } from '../common/icons'
import { keyboardNavigation } from '../common/inputModality'
import { t as tr, useLocale } from '../i18n'
import { podcastFolder } from '../media/podcast'
import { useVideoAudio } from '../media/useVideoAudio'
import { clockText, resumeAt, saveVideoPlace, videoPlace } from '../media/videoPlace'
import { describeError } from '../notices/errors'
import { embeddedLabel } from './embeddedLabel'
import { VideoControls } from './VideoControls'
import { VideoPictureSubtitle } from './VideoPictureSubtitle'
import { type EmbeddedState, VideoSubtitleSettings } from './VideoSubtitleSettings'

type UpNext = {
  fileId: string
  nextId: string
  remaining: number
}

export function VideoViewer({
  background = false,
  row,
  entries,
  run,
  busy,
  autoplay,
  autoNext,
  changeAutoNext,
  changeAutoplay,
  initialFileId,
  hideStrip = false,
  onSelected,
}: {
  background?: boolean
  row: FolderRow
  entries: MediaEntry[]
  run: (req: ExplorerRequest) => Promise<ExplorerResponse | undefined>
  autoplay: boolean
  hideStrip?: boolean
  onSelected?: (id: string) => void
  initialFileId?: string

  busy: boolean
  autoNext: boolean
  changeAutoNext: (value: boolean) => Promise<boolean>
  changeAutoplay: (value: boolean) => Promise<boolean>
}) {
  useLocale()

  const videos = entries.filter((entry) => entry.kind === 'video')
  const subtitles = entries.filter((entry) => entry.kind === 'subtitle')

  const [fileId, setFileId] = useState(initialFileId ?? videos[0]?.id)
  const [subtitle, setSubtitle] = useState<ExplorerResponse['subtitle']>()
  const [cues, setCues] = useState<Cue[]>([])
  // R-412: the subtitle tracks inside the playing MKV/WebM, read when the subtitle settings are opened.
  const [embedded, setEmbedded] = useState<EmbeddedState>()
  // R-417: the embedded track shown while its cues are still being read, and when it was last fetched again.
  const partialTrack = useRef<EmbeddedSubtitleInfo | undefined>(undefined)
  const partialRefreshed = useRef(0)
  // R-421: the chosen picture (VobSub) track: the stretch of cues around the playback time, the track it is
  // from, and the time last asked for.
  const [pictures, setPictures] = useState<EmbeddedPictures>()
  const pictureTrack = useRef<EmbeddedSubtitleInfo | undefined>(undefined)
  const pictureAsked = useRef(0)
  const offsetLive = useRef(0)
  const subtitleLive = useRef<ExplorerResponse['subtitle']>(undefined)

  const [settings, setSettings] = useState(defaultSubtitle)
  const [error, setError] = useState('')
  const [failure, setFailure] = useState<{ fileId: string; probe?: string }>()
  const [files, setFiles] = useState<File[]>([])
  const [captions, setCaptions] = useState(true)

  const [subtitleSection, setSubtitleSection] = useState<string | null>(null)
  const [audioDragging, setAudioDragging] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [subtitleExpanded, setSubtitleExpanded] = useState(false)
  // R-405: the second this video resumed from, shown briefly with a way back to the start.
  const [resumed, setResumed] = useState<number>()

  const [paused, setPaused] = useState(true)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [rate, setRate] = useState(1)
  const [waiting, setWaiting] = useState(false)

  const [active, setActive] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [upNext, setUpNext] = useState<UpNext>()

  const [box, setBox] = useState({ bottom: 0, left: 0, width: 0, height: 0 })
  const [controlHeight, setControlHeight] = useState(80)
  const [stageSize, setStageSize] = useState({ width: 360, height: 480 })

  const viewer = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const controls = useRef<HTMLDivElement>(null)
  const strip = useRef<HTMLDivElement>(null)

  const video = useRef<HTMLVideoElement | null>(null)
  const latest = useRef(row)
  const mounted = useRef(false)
  const saving = useRef(false)
  const wantsPlayback = useRef(initialFileId ? true : autoplay)
  const pendingStart = useRef(false)
  // R-405: the latest place of the playing video and when it was last written; kept on this computer only.
  const lastPlace = useRef<
    { folder: string; fileId: string; time: number; duration: number } | undefined
  >(undefined)
  const savedAt = useRef(-1)

  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const clickTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const nextRef = useRef<UpNext | undefined>(undefined)

  const windowVisible = useRef(true)

  const audio = useVideoAudio()
  const audioLive = useRef(audio)
  const speed = useRef(rate)
  const filesLive = useRef(videos)
  const currentFile = useRef<string | undefined>(undefined)
  const wantedUrl = useRef<string | undefined>(undefined)

  const file = videos.find((entry) => entry.id === fileId) ?? videos[0]
  const index = videos.findIndex((entry) => entry.id === file?.id)

  latest.current = row
  // R-432: whether a subtitle is already loaded now, read when the embedded track list arrives.
  subtitleLive.current = subtitle
  audioLive.current = audio
  speed.current = rate
  filesLive.current = videos
  currentFile.current = file?.id
  wantedUrl.current = file?.url

  // R-405: remembers where this video is; written at most every 10 seconds, and when it pauses or ends. The latest
  // place is also written when the video is switched or the player closes.
  const remember = (node: HTMLVideoElement, write: boolean) => {
    const target = currentFile.current
    const duration = Number.isFinite(node.duration) ? node.duration : 0
    if (node !== video.current || !target || !duration) return
    const time = node.ended ? duration : node.currentTime
    lastPlace.current = { folder: podcastFolder(latest.current), fileId: target, time, duration }
    if (write || Math.abs(time - savedAt.current) >= 10) {
      savedAt.current = time
      saveVideoPlace(lastPlace.current.folder, target, time, duration)
    }
  }

  const countdown = (value?: UpNext) => {
    nextRef.current = value
    setUpNext(value)
  }

  const release = (node: HTMLVideoElement) => {
    node.pause()
    node.removeAttribute('src')
    node.load()
  }

  const bindVideo = useCallback((node: HTMLVideoElement | null) => {
    const previous = video.current
    video.current = node
    pendingStart.current = false

    if (previous && previous !== node) release(previous)

    if (node) {
      // StrictMode detaches and re-attaches the same node after release() cleared its src.
      if (wantedUrl.current && !node.getAttribute('src')) node.src = wantedUrl.current
      node.muted = true
      if (audioLive.current.ready) {
        node.volume = audioLive.current.volume
        node.muted = audioLive.current.muted
      }
      node.playbackRate = speed.current
    }
  }, [])

  const showControls = () => {
    setActive(true)

    if (hideTimer.current) clearTimeout(hideTimer.current)

    hideTimer.current = setTimeout(() => {
      if (
        // R-447: only a control reached with Tab keeps them shown; one clicked with the mouse does not.
        !(keyboardNavigation() && controls.current?.querySelector(':focus-visible')) &&
        !controls.current?.matches(':hover')
      ) {
        setActive(false)
      }
    }, 2500)
  }

  const playSelected = async (node: HTMLVideoElement) => {
    if (node !== video.current || !node.isConnected) return

    if ((!background && document.hidden) || !windowVisible.current || !audioLive.current.ready) {
      pendingStart.current = true
      return
    }

    pendingStart.current = false

    try {
      await node.play()
      if (
        node !== video.current ||
        !node.isConnected ||
        (!background && document.hidden) ||
        !windowVisible.current
      ) {
        node.pause()
      } else if (mounted.current) setError('')
    } catch (reason) {
      if (
        mounted.current &&
        node === video.current &&
        node.isConnected &&
        (reason as Error).name !== 'AbortError'
      ) {
        if (node.error || (reason as Error).name === 'NotSupportedError') reportDecodeFailure()
        else setError(tr('無法自動播放，請按播放器的播放按鈕。'))
      }
    }
  }

  // The browser only says "cannot decode"; the file's first bytes usually say why.
  const reportDecodeFailure = () => {
    setError(
      tr(
        '這部影片無法播放，可能是格式不支援或檔案壞了。MP4、WebM 最穩；MKV、HEVC 可以改用外部播放器開。'
      )
    )
    const target = currentFile.current
    if (!target) return
    setFailure({ fileId: target })
    void run({ action: 'fileProbe', rowId: row.rowId, fileId: target }).then((result) => {
      if (mounted.current && currentFile.current === target) {
        setFailure({ fileId: target, probe: result?.probe?.kind })
      }
    })
  }
  const failureCause = (kind?: string) =>
    ({
      zip: tr('這個檔案其實是 ZIP 壓縮檔，只是副檔名是影片；請先解壓縮。'),
      rar: tr('這個檔案其實是 RAR 壓縮檔，只是副檔名是影片；請先解壓縮。'),
      '7z': tr('這個檔案其實是 7z 壓縮檔，只是副檔名是影片；請先解壓縮。'),
      gzip: tr('這個檔案其實是壓縮檔，只是副檔名是影片；請先解壓縮。'),
      html: tr('這個檔案是網頁或文字，不是影片；可能是下載失敗，請重新下載。'),
      empty: tr('這個檔案是空的（0 位元組）；可能是下載或複製中斷。'),
    })[kind as 'zip'] ?? ''

  const togglePlay = () => {
    const node = video.current
    if (!node) return

    countdown()
    showControls()

    if (node.paused) {
      wantsPlayback.current = true
      void playSelected(node)
    } else {
      pendingStart.current = false
      node.pause()
    }
  }

  const selectVideo = (entry: MediaEntry) => {
    countdown()
    setMenuOpen(false)
    showControls()

    wantsPlayback.current = true

    if (entry.id === file?.id) {
      if (video.current) void playSelected(video.current)
      return
    }

    video.current?.pause()
    setFileId(entry.id)
  }

  useEffect(() => {
    if (initialFileId && initialFileId !== file?.id) {
      const next = videos.find((entry) => entry.id === initialFileId)
      if (next) selectVideo(next)
    }
  }, [initialFileId])
  useEffect(() => {
    if (file) onSelected?.(file.id)
  }, [file?.id])
  const seek = (value: number) => {
    const node = video.current
    if (!node || !Number.isFinite(node.duration) || node.duration <= 0) return

    countdown()
    node.currentTime = Math.max(0, Math.min(node.duration, value))
    setTime(node.currentTime)
    showControls()
    // R-417: a jump while the chosen embedded track is still being read moves the reading there.
    if (partialTrack.current) void loadEmbedded(partialTrack.current, true)
  }

  // R-431: the external player (app settings; the system default without one) starts at the current position. Only
  // the row and file ids travel; main resolves the file and the program. The built-in player pauses once it started.
  const openExternal = async (entry: MediaEntry) => {
    const node = video.current
    const at = node && Number.isFinite(node.currentTime) ? node.currentTime : undefined
    const result = await run({
      action: 'openExternalPlayer',
      rowId: row.rowId,
      fileId: entry.id,
      ...(at ? { time: at } : {}),
    })
    if (result && node === video.current && !node?.paused) {
      pendingStart.current = false
      wantsPlayback.current = false
      node?.pause()
    }
  }

  const changeAudio = (volume: number, muted: boolean) => {
    audio.change({ volume, muted })
    const node = video.current
    if (node) {
      node.volume = volume
      node.muted = muted
    }
    showControls()
  }

  const changeRate = (value: number) => {
    speed.current = value
    setRate(value)
    if (video.current) video.current.playbackRate = value
  }

  const openSubtitles = () => {
    countdown()
    setSubtitleSection('source')
    setSubtitleExpanded(true)
    setMenuOpen(true)
    showControls()
  }

  const toggleCaptions = () => {
    if (subtitle) setCaptions((value) => !value)
    else openSubtitles()
    showControls()
  }

  const toggleFullscreen = async () => {
    const target = viewer.current
    if (!target) return

    try {
      if (document.fullscreenElement === target) await document.exitFullscreen()
      else if (!document.fullscreenElement) {
        await target.requestFullscreen()
        if (!target.isConnected && document.fullscreenElement === target) {
          await document.exitFullscreen()
        }
      }

      if (mounted.current) showControls()
    } catch (reason) {
      if (mounted.current) setError(tr('全螢幕切換失敗：') + String(reason))
    }
  }

  const save = async () => {
    if (!file || !subtitle || row.readonly || !latest.current.record || saving.current) return

    saving.current = true

    try {
      await run({
        action: 'playback',
        rowId: row.rowId,
        revision: latest.current.record.revision,
        fileId: file.id,
        time: 0,
        subtitle: subtitle.token,
        settings,
      })
    } finally {
      saving.current = false
    }
  }

  const apply = (value: ExplorerResponse['subtitle']) => {
    if (!value) return
    if (!value.partial) partialTrack.current = undefined
    pictureTrack.current = undefined
    setPictures(undefined)

    try {
      // R-417: an embedded track still being read may have nothing yet near the start.
      const parsed = value.partial && !value.text.trim() ? [] : parseSubtitles(value.text)
      setCues(parsed)
      setSubtitle(value)
      setCaptions(true)
      setSettings(
        latest.current.record?.details?.playback?.[file?.id ?? '']?.settings?.[value.token] ??
          defaultSubtitle()
      )
      setError('')
    } catch (reason) {
      setError(String(reason))
    }
  }

  const load = async (entry?: MediaEntry, external?: File) => {
    const target = currentFile.current

    try {
      const result = external
        ? await window.explorer.dropSubtitle(row.rowId, external)
        : await window.explorer.request(
            entry
              ? {
                  action: 'subtitle',
                  rowId: row.rowId,
                  fileId: entry.id,
                  encoding: settings.encoding,
                }
              : { action: 'chooseSubtitle', rowId: row.rowId }
          )
      if (mounted.current && currentFile.current === target) apply(result.subtitle)
    } catch (reason) {
      if (mounted.current && currentFile.current === target) setError(String(reason))
    }
  }
  // R-412: one embedded track; main returns it as SRT text, so it loads like a subtitle file.
  // R-417: while the video is still being read, main gives the cues read so far (partial) and reads near the
  // playback time first; the track is fetched again as reading goes on (refresh keeps the subtitle settings).
  const loadEmbedded = async (track: EmbeddedSubtitleInfo, refresh = false) => {
    if (track.picture) return loadPictures(track, refresh)
    const target = currentFile.current
    if (!target) return
    try {
      const result = await window.explorer.request({
        action: 'embeddedSubtitle',
        rowId: row.rowId,
        fileId: target,
        track: track.number,
        early: true,
        time: video.current?.currentTime ?? 0,
      })
      if (!mounted.current || currentFile.current !== target || !result.subtitle) return
      if (refresh && partialTrack.current?.number !== track.number) return
      const value = { ...result.subtitle, name: embeddedLabel(track) }
      partialTrack.current = value.partial ? track : undefined
      if (!refresh) apply(value)
      else {
        setCues(value.text.trim() ? parseSubtitles(value.text) : [])
        setSubtitle(value)
      }
    } catch (reason) {
      if (mounted.current && currentFile.current === target) setError(describeError(reason).message)
    }
  }
  // R-421: a picture (VobSub) track. Main answers with the cues around the asked time only, so this is asked again
  // as playback moves on (refresh), and while the video is still being read like a text track.
  const loadPictures = async (track: EmbeddedSubtitleInfo, refresh = false) => {
    const target = currentFile.current
    if (!target) return
    const token = 'emb-' + track.number
    const saved =
      latest.current.record?.details?.playback?.[target]?.settings?.[token] ?? defaultSubtitle()
    // The cues that show now are the ones timed before the subtitle delay.
    const asked = Math.max(
      0,
      (video.current?.currentTime ?? 0) - (refresh ? offsetLive.current : saved.offset)
    )
    pictureAsked.current = asked
    try {
      const result = await window.explorer.request({
        action: 'embeddedPictures',
        rowId: row.rowId,
        fileId: target,
        track: track.number,
        early: true,
        time: asked,
      })
      if (!mounted.current || currentFile.current !== target || !result.pictures) return
      if (refresh && pictureTrack.current?.number !== track.number) return
      const value = { ...result.pictures, name: embeddedLabel(track) }
      partialTrack.current = value.partial ? track : undefined
      pictureTrack.current = track
      if (!refresh) {
        setCues([])
        setSubtitle({ token, name: value.name, text: '', portable: false })
        setCaptions(true)
        setSettings(saved)
        setError('')
      }
      setPictures(value)
    } catch (reason) {
      if (mounted.current && currentFile.current === target) setError(describeError(reason).message)
    }
  }
  const importSubtitle = async () => {
    if (!subtitle) return
    const result = await run({
      action: 'subtitle',
      rowId: row.rowId,
      externalToken: subtitle.token,
      import: true,
      encoding: settings.encoding,
    })
    apply(result?.subtitle)
  }

  const changeSubtitleEncoding = async (v: string | null) => {
    if (!subtitle || !v) return
    try {
      const result = await window.explorer.request({
        action: 'subtitle',
        rowId: row.rowId,
        ...(subtitles.some((s) => s.id === subtitle.token)
          ? { fileId: subtitle.token }
          : { externalToken: subtitle.token }),
        encoding: v,
      })
      if (result.subtitle) {
        const parsed = parseSubtitles(result.subtitle.text)
        setCues(parsed)
        setSubtitle(result.subtitle)
        setSettings((s) => ({ ...s, encoding: v as SubtitlePrefs['encoding'] }))
      }
    } catch (e) {
      setError(String(e))
    }
  }

  useEffect(() => {
    mounted.current = true

    const target = viewer.current
    const changed = () => {
      setFullscreen(document.fullscreenElement === target)
      setActive(true)
    }

    document.addEventListener('fullscreenchange', changed)

    return () => {
      mounted.current = false
      pendingStart.current = false
      nextRef.current = undefined

      if (hideTimer.current) clearTimeout(hideTimer.current)
      if (clickTimer.current) clearTimeout(clickTimer.current)

      document.removeEventListener('fullscreenchange', changed)

      if (target && document.fullscreenElement === target) {
        void document.exitFullscreen().catch(() => {})
      }
    }
  }, [])

  // The place of the video that is leaving (a new one chosen, or the player closed).
  useEffect(
    () => () => {
      const place = lastPlace.current
      lastPlace.current = undefined
      savedAt.current = -1
      if (place) saveVideoPlace(place.folder, place.fileId, place.time, place.duration)
    },
    [file?.id]
  )
  useEffect(() => {
    if (resumed === undefined) return
    const timer = setTimeout(() => setResumed(undefined), 4000)
    return () => clearTimeout(timer)
  }, [resumed])

  // R-412: the tracks inside an MKV/WebM, read by main (with a cache, so opening the same video again is quick).
  // R-417: reading starts as soon as the video opens; the track list comes back first and the cues are read in the
  // background with progress, so the subtitle settings usually find them ready.
  const matroska = !!file && /\.(mkv|webm)$/i.test(file.name)
  const listEmbedded = (target: string, early: boolean) =>
    window.explorer
      .request({ action: 'embeddedSubtitles', rowId: row.rowId, fileId: target, early })
      .then((result) => {
        if (mounted.current && currentFile.current === target) {
          setEmbedded((state) => ({
            fileId: target,
            status: result.embedded?.reading ? 'loading' : 'done',
            progress: result.embedded?.reading && state?.fileId === target ? state.progress : 1,
            tracks: result.embedded?.tracks ?? [],
          }))
          return result.embedded?.tracks
        }
      })
  // R-432: the track list has arrived: the track of the name (else language) picked in this folder before opens,
  // else the file's own default track. A subtitle the user already has for this file wins: one saved for it, or one
  // loaded now. A track only picked here (not by hand) is not remembered.
  const autoSelectTrack = (target: string, tracks?: EmbeddedSubtitleInfo[]) => {
    if (!tracks?.length || !mounted.current || currentFile.current !== target) return
    const details = latest.current.record?.details
    if (details?.playback?.[target]?.subtitle || subtitleLive.current) return
    const track = chooseSubtitleTrack(tracks, details?.subtitleTrack)
    if (track) void loadEmbedded(track)
  }
  // The user picked a track by hand: the folder remembers its name and language for the other videos.
  const pickEmbedded = async (track: EmbeddedSubtitleInfo) => {
    await loadEmbedded(track)
    if (!mounted.current) return
    const wanted = trackPreference(track)
    const record = latest.current.record
    const known = record?.details?.subtitleTrack
    if (
      wanted &&
      record &&
      !row.readonly &&
      (known?.name !== wanted.name || known?.language !== wanted.language)
    ) {
      await run({
        action: 'subtitleTrack',
        rowId: row.rowId,
        revision: record.revision,
        ...wanted,
      })
    }
  }
  useEffect(() => {
    if (!matroska || !file || embedded?.fileId === file.id) return
    const target = file.id
    setEmbedded({ fileId: target, status: 'loading', progress: 0, tracks: [] })
    void listEmbedded(target, true)
      .then((tracks) => autoSelectTrack(target, tracks))
      // The second answer waits for the whole read: final counts, and the chosen track in full.
      .then(() => listEmbedded(target, false))
      .then(() => {
        if (partialTrack.current) void loadEmbedded(partialTrack.current, true)
      })
      .catch((reason) => {
        if (mounted.current && currentFile.current === target) {
          setEmbedded({
            fileId: target,
            status: 'error',
            progress: 0,
            tracks: [],
            error: describeError(reason).message,
          })
        }
      })
  }, [matroska, file?.id])
  useEffect(
    () =>
      window.explorer.onSubtitleProgress((progress) => {
        if (progress.rowId !== row.rowId || progress.fileId !== currentFile.current) return
        setEmbedded((state) =>
          state?.status === 'loading' && state.fileId === progress.fileId
            ? { ...state, progress: progress.fraction }
            : state
        )
        // R-417: the chosen track fills in as it is read, at most every two seconds.
        if (partialTrack.current && Date.now() - partialRefreshed.current > 2000) {
          partialRefreshed.current = Date.now()
          void loadEmbedded(partialTrack.current, true)
        }
      }),
    [row.rowId]
  )

  // R-421: playback left the stretch of picture cues that was fetched (or comes near its end): the next one is
  // asked for, at most once per five seconds of movement.
  offsetLive.current = settings.offset
  useEffect(() => {
    const track = pictureTrack.current
    if (!pictures || !track || pictures.partial) return
    const at = time - settings.offset
    if (
      (at < pictures.from || (pictures.until !== undefined && at > pictures.until - 15)) &&
      Math.abs(Math.max(0, at) - pictureAsked.current) > 5
    ) {
      void loadPictures(track, true)
    }
  }, [time, pictures, settings.offset])

  useEffect(() => {
    setResumed(undefined)
    partialTrack.current = undefined
    pictureTrack.current = undefined
    setPictures(undefined)
    setEmbedded(undefined)
    setSubtitle(undefined)
    setCues([])
    setError('')
    setTime(0)
    setDuration(0)
    setBuffered(0)
    setFiles([])
    setSubtitleSection(null)
    setPaused(true)
    setWaiting(false)
    countdown()
    setMenuOpen(false)
    showControls()
  }, [file?.id])

  useEffect(() => {
    wantsPlayback.current = !!initialFileId || autoplay
    if (!autoplay) pendingStart.current = false
  }, [autoplay])

  useEffect(() => {
    const node = video.current
    if (!node || !audio.ready) return

    node.volume = audio.volume
    node.muted = audio.muted

    if (pendingStart.current && node.readyState >= 1) void playSelected(node)
  }, [audio.ready, file?.id])

  useEffect(() => {
    const visibility = () => {
      if (!background && document.hidden) {
        wantsPlayback.current = false
        pendingStart.current = false
        video.current?.pause()
        countdown()
      }
    }

    document.addEventListener('visibilitychange', visibility)
    return () => document.removeEventListener('visibilitychange', visibility)
  }, [])

  useEffect(() => {
    let alive = true
    let observed = false

    const apply = (visible: boolean | undefined) => {
      windowVisible.current = background || visible !== false

      if (!background && visible === false) {
        wantsPlayback.current = false
        pendingStart.current = false
        video.current?.pause()
        countdown()
      }
    }

    const remove = window.desktop.onWindowState((state) => {
      observed = true
      apply(state.visible)
    })

    void window.desktop
      .windowAction('state')
      .then((state) => {
        if (alive && !observed) apply(state.visible)
      })
      .catch(() => {})

    return () => {
      alive = false
      remove()
    }
  }, [])

  useEffect(() => {
    const update = () => {
      const node = video.current
      const container = stage.current
      if (!node || !container) return

      const bounds = container.getBoundingClientRect()
      const ratio = (node.videoWidth || 16) / (node.videoHeight || 9)
      const width = Math.min(bounds.width, bounds.height * ratio)
      const height = width / ratio

      setStageSize({ width: bounds.width, height: bounds.height })
      setBox({
        left: (bounds.width - width) / 2,
        bottom: (bounds.height - height) / 2,
        width,
        height,
      })
      setControlHeight(controls.current?.getBoundingClientRect().height ?? 80)
    }

    const node = video.current
    const observer = new ResizeObserver(update)

    if (stage.current) observer.observe(stage.current)
    if (controls.current) observer.observe(controls.current)

    node?.addEventListener('loadedmetadata', update)
    update()

    return () => {
      observer.disconnect()
      node?.removeEventListener('loadedmetadata', update)
    }
  }, [file?.id])

  useEffect(() => {
    if (menuOpen) {
      countdown()
      setActive(true)
    }
  }, [menuOpen])

  useEffect(() => {
    if (!autoNext) countdown()
  }, [autoNext])

  useEffect(() => {
    if (!upNext || !autoNext) return

    const timer = setInterval(() => {
      const current = nextRef.current
      const list = filesLive.current

      if (
        !current ||
        (!background && document.hidden) ||
        !windowVisible.current ||
        current.fileId !== currentFile.current
      ) {
        countdown()
        return
      }

      const next = list[list.findIndex((entry) => entry.id === current.fileId) + 1]

      if (!next || next.id !== current.nextId) {
        countdown()
        return
      }

      if (current.remaining > 1) countdown({ ...current, remaining: current.remaining - 1 })
      else {
        countdown()
        selectVideo(next)
      }
    }, 1000)

    return () => clearInterval(timer)
  }, [upNext?.fileId, autoNext])

  useEffect(() => {
    const element = strip.current
    if (!element) return

    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || element.scrollWidth <= element.clientWidth) return

      const delta =
        (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY) *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientWidth : 1)
      const next = Math.max(
        0,
        Math.min(element.scrollWidth - element.clientWidth, element.scrollLeft + delta)
      )

      if (next !== element.scrollLeft) {
        event.preventDefault()
        element.scrollLeft = next
      }
    }

    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [entries])

  const keyboard = (event: React.KeyboardEvent) => {
    if (
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.nativeEvent.isComposing ||
      menuOpen
    ) {
      return
    }

    const target = event.target as HTMLElement

    if (target.closest('input,select,textarea,[contenteditable="true"]')) return

    const key = event.key.toLowerCase()
    const node = video.current
    if (!node) return

    if (event.repeat && ['k', ' ', 'm', 'f', 'c'].includes(key)) return

    if (key === ' ' && target.closest('button')) return

    if (
      [
        'k',
        ' ',
        'm',
        'f',
        'c',
        'j',
        'l',
        'arrowleft',
        'arrowright',
        'arrowup',
        'arrowdown',
      ].includes(key)
    ) {
      event.preventDefault()
      event.stopPropagation()
      showControls()

      if (key === 'k' || key === ' ') togglePlay()
      else if (key === 'm') {
        changeAudio(audio.volume || 0.5, audio.volume === 0 ? false : !audio.muted)
      } else if (key === 'f') void toggleFullscreen()
      else if (key === 'c') toggleCaptions()
      else if (['j', 'l', 'arrowleft', 'arrowright'].includes(key)) {
        seek(
          node.currentTime +
            (['j', 'arrowleft'].includes(key) ? -1 : 1) * (['j', 'l'].includes(key) ? 10 : 5)
        )
      } else {
        changeAudio(
          Math.max(0, Math.min(1, audio.volume + (key === 'arrowup' ? 0.05 : -0.05))),
          false
        )
      }
    }
  }

  const controlsVisible = active || paused || audioDragging || menuOpen || !!error || !!upNext

  const visible = captions
    ? cues
        .filter((cue) => time >= cue.start + settings.offset && time < cue.end + settings.offset)
        .map((cue) => cue.text)
        .join('\n')
    : ''

  // R-421: the picture cue on screen; of two that overlap, the later one.
  const pictureCue =
    captions && pictures
      ? pictures.cues
          .filter((cue) => time >= cue.start + settings.offset && time < cue.end + settings.offset)
          .pop()
      : undefined

  const upcoming = videos.find((entry) => entry.id === upNext?.nextId)

  if (!file) return <div className="video-empty">{tr('此資料夾沒有直接影片')}</div>

  return (
    <div className="video-viewer" ref={viewer}>
      <div
        className="video-stage custom-video-stage"
        ref={stage}
        tabIndex={0}
        aria-label={tr('影片播放器')}
        onKeyDown={keyboard}
        onFocusCapture={showControls}
        onPointerMove={showControls}
        onPointerDown={showControls}
        onDoubleClick={(event) => {
          if (event.target === video.current || event.target === stage.current) {
            if (clickTimer.current) clearTimeout(clickTimer.current)
            void toggleFullscreen()
          }
        }}
        onDragOver={(event) => {
          if (
            event.dataTransfer.types.includes('Files') ||
            event.dataTransfer.types.includes('application/x-media-subtitle')
          ) {
            event.preventDefault()
          }
        }}
        onDrop={(event) => {
          event.preventDefault()
          const id = event.dataTransfer.getData('application/x-media-subtitle')
          if (id) {
            const entry = subtitles.find((item) => item.id === id)
            if (entry) void load(entry)
          } else {
            const incoming = [...event.dataTransfer.files]
            setFiles(incoming)
            if (incoming.length > 1) openSubtitles()
            if (incoming.length === 1) void load(undefined, incoming[0])
          }
        }}
      >
        <VideoPlayer key={file.id}>
          <Video
            ref={bindVideo}
            src={file.url}
            playsInline
            autoPlay={false}
            controls={false}
            preload="metadata"

            onClick={() => {
              if (clickTimer.current) clearTimeout(clickTimer.current)
              clickTimer.current = setTimeout(togglePlay, 200)
            }}

            onPlay={(event) => {
              if (
                event.currentTarget !== video.current ||
                !event.currentTarget.isConnected ||
                (!background && document.hidden) ||
                !windowVisible.current
              ) {
                event.currentTarget.pause()
              } else {
                setPaused(false)
                countdown()
                showControls()
              }
            }}

            onPause={(event) => {
              if (event.currentTarget !== video.current) return
              setPaused(true)
              remember(event.currentTarget, true)
            }}
            onTimeUpdate={(event) => {
              if (event.currentTarget !== video.current) return
              setTime(event.currentTarget.currentTime)
              remember(event.currentTarget, false)
            }}

            onLoadedMetadata={(event) => {
              const node = event.currentTarget
              if (node !== video.current) return
              setDuration(Number.isFinite(node.duration) ? node.duration : 0)
              node.playbackRate = speed.current
              // R-405: goes on from where it was left, unless it was watched to the end.
              const at = resumeAt(videoPlace(podcastFolder(latest.current), file.id))
              if (at > 0 && at < node.duration) {
                node.currentTime = at
                setTime(at)
                setResumed(at)
              }
              if (wantsPlayback.current) void playSelected(node)
            }}

            onDurationChange={(event) => {
              if (event.currentTarget === video.current) {
                setDuration(
                  Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0
                )
              }
            }}

            onProgress={(event) => {
              const node = event.currentTarget
              if (node === video.current && node.buffered.length) {
                setBuffered(node.buffered.end(node.buffered.length - 1))
              }
            }}

            onWaiting={() => setWaiting(true)}
            onPlaying={() => setWaiting(false)}
            onCanPlay={() => setWaiting(false)}

            onEnded={(event) => {
              if (event.currentTarget !== video.current) return
              setPaused(true)
              setWaiting(false)
              remember(event.currentTarget, true)
              const next = videos[index + 1]
              if (
                autoNext &&
                !menuOpen &&
                !(!background && document.hidden) &&
                windowVisible.current &&
                next
              ) {
                countdown({ fileId: file.id, nextId: next.id, remaining: 5 })
              }
            }}

            onError={(event) => {
              if (event.currentTarget === video.current) {
                countdown()
                setWaiting(false)
                reportDecodeFailure()
              }
            }}
          />
        </VideoPlayer>

        {visible && (
          <div
            className="subtitle-overlay"
            style={{
              left: box.left,
              width: box.width || '100%',
              bottom: Math.max(
                box.bottom + (box.height * settings.bottom) / 100,
                controlsVisible ? controlHeight + 8 : 8
              ),
              fontSize: settings.size,
              color: settings.color,
            }}
          >
            <span style={{ background: settings.background + 'c0' }}>{visible}</span>
          </div>
        )}

        {pictures && box.width > 0 && (
          <VideoPictureSubtitle
            key={pictures.token}
            width={pictures.width}
            height={pictures.height}
            palette={pictures.palette}
            cue={pictureCue}
            box={box}
          />
        )}

        {resumed !== undefined && (
          <div className="reader-notice" role="status">
            <span>{tr('從 {0} 繼續', clockText(resumed))}</span>
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={() => {
                setResumed(undefined)
                seek(0)
              }}
            >
              {tr('從頭開始')}
            </Button>
          </div>
        )}

        {waiting && !paused && !error && (
          <div className="video-waiting" role="status">
            {tr('影片緩衝中…')}
          </div>
        )}

        {(error || audio.error) && (
          <div className="video-error" role="alert">
            {failure && failure.fileId === file?.id && failureCause(failure.probe)
              ? failureCause(failure.probe)
              : error || audio.error}
            {failure && failure.fileId === file?.id && file && (
              <div className="video-error-actions">
                <button
                  type="button"
                  onClick={() =>
                    void run({ action: 'openFile', rowId: row.rowId, fileId: file.id })
                  }
                >
                  {tr('用系統預設播放器開啟')}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void run({ action: 'revealFile', rowId: row.rowId, fileId: file.id })
                  }
                >
                  {tr('在檔案總管顯示')}
                </button>
              </div>
            )}
          </div>
        )}

        {upNext && upcoming && (
          <div className="video-up-next" role="status">
            <strong>{tr('{0} 秒後播放下一部', upNext.remaining)}</strong>
            <span title={upcoming.name}>{upcoming.name}</span>
            <div>
              <button type="button" onClick={() => countdown()}>
                {tr('取消接續播放')}
              </button>
              <button type="button" onClick={() => selectVideo(upcoming)}>
                {tr('立即播放')}
              </button>
            </div>
          </div>
        )}

        <VideoControls
          controls={controls}
          stage={stage}
          panelHeight={Math.max(80, Math.min(440, stageSize.height - controlHeight - 20))}
          panelWidth={Math.max(200, Math.min(360, stageSize.width - 24))}
          interacting={setAudioDragging}
          visible={controlsVisible}
          paused={paused}
          time={time}
          duration={duration}
          buffered={buffered}
          volume={audio.volume}
          muted={audio.muted}
          rate={rate}
          audioReady={audio.ready}
          fullscreen={fullscreen}
          canPrevious={index > 0}
          canNext={index >= 0 && index < videos.length - 1}
          menuOpen={menuOpen}
          menu={(opened) => {
            if (opened) {
              setSubtitleSection(null)
              setSubtitleExpanded(false)
            }
            setMenuOpen(opened)
          }}
          play={togglePlay}
          seek={seek}
          audio={changeAudio}
          speed={changeRate}
          previous={() => {
            const previous = videos[index - 1]
            if (previous) selectVideo(previous)
          }}
          next={() => {
            const next = videos[index + 1]
            if (next) selectVideo(next)
          }}
          subtitleSettings={
            <Accordion
              className="player-subtitle-group"
              value={subtitleExpanded ? 'subtitles' : null}
              onChange={(value) => setSubtitleExpanded(!!value)}
              transitionDuration={0}
            >
              <Accordion.Item value="subtitles">
                <Accordion.Control>{tr('字幕設定')}</Accordion.Control>
                <Accordion.Panel>
                  <VideoSubtitleSettings
                    captions={captions}
                    toggleCaptions={toggleCaptions}
                    section={subtitleSection}
                    changeSection={setSubtitleSection}
                    error={error}
                    subtitle={subtitle}
                    picture={!!pictures}
                    files={files}
                    subtitles={subtitles}
                    embedded={matroska ? embedded : undefined}
                    loadEmbedded={pickEmbedded}
                    settings={settings}
                    readonly={row.readonly}
                    load={load}
                    clear={() => {
                      partialTrack.current = undefined
                      pictureTrack.current = undefined
                      setPictures(undefined)
                      setSubtitle(undefined)
                      setCues([])
                    }}
                    save={save}
                    importSubtitle={importSubtitle}
                    changeEncoding={changeSubtitleEncoding}
                    setSettings={setSettings}
                  />
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>
          }
          full={() => void toggleFullscreen()}
          external={file ? () => void openExternal(file) : undefined}
        />
      </div>

      {!hideStrip && (
        <div ref={strip} className="video-strip" aria-label={tr('資料夾影片')}>
          {videos.map((entry) => (
            <button
              key={entry.id}
              className={'video-tile ' + (entry.id === file.id ? 'active' : '')}
              aria-label={tr('播放 ') + entry.name}
              title={entry.name}
              onClick={() => selectVideo(entry)}
            >
              {entry.thumb ? (
                <img
                  src={entry.thumb}
                  alt=""
                  onError={(event) => {
                    event.currentTarget.style.display = 'none'
                  }}
                />
              ) : (
                <span className="video-symbol">
                  <Icon name="play" size={24} />
                </span>
              )}
              <span>{entry.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
