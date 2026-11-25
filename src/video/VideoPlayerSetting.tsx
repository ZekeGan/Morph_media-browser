import { useEffect, useState } from 'react'
import { Alert, Button, Group, Text } from '@mantine/core'
import { t as tr } from '../i18n'
import { HelpTip } from '../common/HelpTip'
import { describeError } from '../notices/errors'

// Application settings (R-431): the program the video player's "open in external player" button starts. It is picked
// in a main-process dialog; the window only shows the path. Without one, the system default player is used.
export function VideoPlayerSetting({ opened }: { opened: boolean }) {
  const [file, setFile] = useState<string>(),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false)
  useEffect(() => {
    if (!opened) return
    void window.desktop
      .workspace()
      .then((state) => setFile(state.prefs.videoPlayer))
      .catch(() => {})
  }, [opened])
  const change = async (clear: boolean) => {
    setPending(true)
    setError('')
    try {
      const result = await window.explorer.request({ action: 'chooseVideoPlayer', clear })
      if (clear) setFile(undefined)
      else if (result.videoPlayer) setFile(result.videoPlayer)
    } catch (reason) {
      setError(describeError(reason).message)
    } finally {
      setPending(false)
    }
  }
  return (
    <section className="settings-section" aria-label={tr('外部影片播放器')}>
      <Group gap={4} wrap="nowrap" mb="xs">
        <Text fw={600}>{tr('外部影片播放器')}</Text>
        <HelpTip text={tr('「用外部播放器開啟」會用這個程式。')} />
      </Group>
      <Text size="sm" className="path" title={file}>
        {file ?? tr('尚未指定')}
      </Text>
      <Group gap="xs" mt="xs">
        <Button size="xs" variant="default" disabled={pending} onClick={() => void change(false)}>
          {tr('選擇播放程式')}
        </Button>
        {file && (
          <Button size="xs" variant="subtle" disabled={pending} onClick={() => void change(true)}>
            {tr('清除')}
          </Button>
        )}
      </Group>
      {error && (
        <Alert color="orange" mt="xs">
          {error}
        </Alert>
      )}
    </section>
  )
}
