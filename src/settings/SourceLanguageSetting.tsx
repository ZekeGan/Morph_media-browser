import { useEffect, useState } from 'react'
import { Alert, Checkbox, Group, Text, Tooltip } from '@mantine/core'
import { t as tr } from '../i18n'
import { HelpTip } from '../common/HelpTip'
import { Icon } from '../common/icons'
import { useListDrag } from '../common/useListDrag'
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
    if (to < 0 || to >= order.length || from === to) return
    const next = [...order]
    next.splice(to, 0, ...next.splice(from, 1))
    void save(next)
  }
  const dnd = useListDrag(move, pending)
  return (
    <section className="settings-section" aria-label={tr('外部來源語言')}>
      <Group gap={4} wrap="nowrap" mb="xs">
        <Text fw={600}>{tr('外部來源語言')}</Text>
        <HelpTip
          text={tr(
            '匯入外部來源時，標題與簡介依這個順序取來源有的語言，沒有就用網站預設；標籤固定一種語言，已匯入的資料不會改變。'
          )}
        />
      </Group>
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
        <ol className="sort-keys source-language-list" aria-label={tr('語言順序')} {...dnd.list}>
          {order.map((id, index) => (
            <li key={id} {...dnd.row(index)} className={'sort-key' + dnd.row(index).className}>
              <Tooltip
                label={tr('拖曳或 Alt+↑／↓ 調整順序')}
                events={{ hover: true, focus: false, touch: false }}
              >
                <button
                  type="button"
                  className="sort-key-grip"
                  disabled={pending}
                  aria-label={tr('移動語言順序 {0}', nameOf(id))}
                  {...dnd.grip(index)}
                  onKeyDown={(e) => {
                    if (!e.altKey || !['ArrowUp', 'ArrowDown'].includes(e.key)) return
                    e.preventDefault()
                    move(index, index + (e.key === 'ArrowUp' ? -1 : 1))
                  }}
                >
                  <Icon name="grip" size={15} />
                </button>
              </Tooltip>
              <Text size="sm" c="dimmed" w={16} ta="right">
                {index + 1}
              </Text>
              <Text size="sm" ml="xs" style={{ flex: 1 }}>
                {nameOf(id)}
              </Text>
            </li>
          ))}
        </ol>
      )}
      {error && (
        <Alert color="orange" mt="xs">
          {error}
        </Alert>
      )}
    </section>
  )
}
