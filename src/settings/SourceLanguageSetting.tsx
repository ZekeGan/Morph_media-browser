import { useEffect, useState } from 'react'
import { ActionIcon, Alert, Checkbox, Group, Stack, Text, Tooltip } from '@mantine/core'
import { t as tr } from '../i18n'
import { describeError } from '../notices/errors'
import { localeIds, localeOptions, type LocaleId } from '../../shared/locales'

// Application settings (R-381): the languages an external source's title and description are taken in, first
// choice first. By default it is the interface language alone; the order is kept on this computer only.
const nameOf = (id: LocaleId) => localeOptions.find((option) => option.value === id)?.label ?? id

export function SourceLanguageSetting({ opened, locale }: { opened: boolean; locale: LocaleId }) {
  const [saved, setSaved] = useState<LocaleId[]>([]),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false)
  useEffect(() => {
    if (!opened) return
    void window.desktop
      .workspace()
      .then((state) => setSaved(state.prefs.sourceLanguages ?? []))
      .catch(() => {})
  }, [opened])
  const custom = saved.length > 0,
    // A saved list that leaves some languages out still shows all five; the rest follow in the usual order.
    order = [...saved, ...localeIds.filter((id) => !saved.includes(id))]
  const save = async (value: LocaleId[]) => {
    setPending(true)
    setError('')
    try {
      const state = await window.desktop.updateWorkspace({ action: 'sourceLanguages', value })
      setSaved(state.prefs.sourceLanguages ?? [])
    } catch (reason) {
      setError(describeError(reason).message)
    } finally {
      setPending(false)
    }
  }
  const move = (from: number, to: number) => {
    const next = [...order]
    next.splice(to, 0, ...next.splice(from, 1))
    void save(next)
  }
  return (
    <section className="settings-section" aria-label={tr('外部來源語言')}>
      <Text fw={600}>{tr('外部來源語言')}</Text>
      <Text size="sm" c="dimmed" mb="xs">
        {tr(
          '匯入外部來源時，標題與簡介依這個順序取來源有的語言，沒有就用網站預設；標籤固定一種語言，已匯入的資料不會改變。'
        )}
      </Text>
      <Checkbox
        label={tr('跟著介面語言')}
        checked={!custom}
        disabled={pending}
        onChange={(event) =>
          void save(
            event.currentTarget.checked ? [] : [locale, ...localeIds.filter((id) => id !== locale)]
          )
        }
      />
      {custom && (
        <Stack gap={4} mt="xs" component="ol" className="source-language-list">
          {order.map((id, index) => (
            <Group key={id} gap="xs" wrap="nowrap" component="li">
              <Text size="sm" c="dimmed" w={16} ta="right">
                {index + 1}
              </Text>
              <Text size="sm" style={{ flex: 1 }}>
                {nameOf(id)}
              </Text>
              <Tooltip label={tr('上移')}>
                <ActionIcon
                  variant="default"
                  size="sm"
                  aria-label={tr('上移 {0}', nameOf(id))}
                  disabled={pending || index === 0}
                  onClick={() => move(index, index - 1)}
                >
                  <span aria-hidden>↑</span>
                </ActionIcon>
              </Tooltip>
              <Tooltip label={tr('下移')}>
                <ActionIcon
                  variant="default"
                  size="sm"
                  aria-label={tr('下移 {0}', nameOf(id))}
                  disabled={pending || index === order.length - 1}
                  onClick={() => move(index, index + 1)}
                >
                  <span aria-hidden>↓</span>
                </ActionIcon>
              </Tooltip>
            </Group>
          ))}
        </Stack>
      )}
      {error && (
        <Alert color="orange" mt="xs">
          {error}
        </Alert>
      )}
    </section>
  )
}
