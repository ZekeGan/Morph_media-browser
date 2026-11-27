import { Alert, Button, Group, Text } from '@mantine/core'
import { useEffect, useState } from 'react'

import { HelpTip } from '../common/HelpTip'
import { t as tr } from '../i18n'
import { describeError } from '../notices/errors'

// Application settings (R-320): the program that plays .swf games (Flash Player projector or Ruffle desktop). It is
// picked in a main-process dialog; the window only shows the path. M:orph never plays Flash itself.
export function FlashPlayerSetting({ opened }: { opened: boolean }) {
  const [file, setFile] = useState<string>()
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  useEffect(() => {
    if (!opened) return
    void window.desktop
      .workspace()
      .then((state) => setFile(state.prefs.flashPlayer))
      .catch(() => {})
  }, [opened])
  const change = async (clear: boolean) => {
    setPending(true)
    setError('')
    try {
      const result = await window.explorer.request({ action: 'chooseFlashPlayer', clear })
      if (clear) setFile(undefined)
      else if (result.flashPlayer) setFile(result.flashPlayer)
    } catch (reason) {
      setError(describeError(reason).message)
    } finally {
      setPending(false)
    }
  }
  return (
    <section className="settings-section" aria-label={tr('Flash 播放器')}>
      <Group gap={4} wrap="nowrap" mb="xs">
        <Text fw={600}>{tr('Flash 播放器')}</Text>
        <HelpTip text={tr('選好後就能開 .swf 遊戲。')} />
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
