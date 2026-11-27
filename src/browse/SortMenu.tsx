import { ActionIcon, Button, Popover, Select, Stack, Switch, Text, Tooltip } from '@mantine/core'

import { MAX_SORT_KEYS, sortChoices, type SortKey } from '../../shared/browse'

import { Icon } from '../common/icons'
import { useListDrag } from '../common/useListDrag'
import { t as tr } from '../i18n'

type Column = { id: string; label: string }

// R-467: the toolbar's sort button, shared by CARD and TABLE. Up to five keys, in order: add, remove, turn around,
// and move them (drag the grip, or Alt+↑／↓ on it). Rows equal on every key are ordered by name. "Folders first" puts
// folders that only group others before the works.
export function SortMenu({
  columns,
  keys,
  foldersFirst,
  busy,
  onChange,
}: {
  columns: Column[]
  keys: SortKey[]
  foldersFirst: boolean
  busy: boolean
  onChange: (keys: SortKey[], foldersFirst: boolean) => void
}) {
  const choices = sortChoices(columns)
  const label = (field: string) => columns.find((c) => c.id === field)?.label ?? field
  const arrow = (asc: boolean) => (asc ? '↑' : '↓')
  const shown = keys.filter((k) => columns.some((c) => c.id === k.field))
  const summary = !shown.length
    ? `${label('name')} ${arrow(true)}`
    : `${label(shown[0].field)} ${arrow(shown[0].asc)}` +
      (shown[1] ? ` · ${label(shown[1].field)} ${arrow(shown[1].asc)}` : '') +
      (shown.length > 2 ? ` +${shown.length - 2}` : '')
  const set = (next: SortKey[]) => onChange(next, foldersFirst)
  const move = (from: number, to: number) => {
    if (to < 0 || to >= shown.length || from === to) return
    const next = [...shown]
    const [key] = next.splice(from, 1)
    next.splice(to, 0, key)
    set(next)
  }
  const dnd = useListDrag(move)
  const unused = choices.filter((c) => !shown.some((k) => k.field === c.id))
  return (
    <Popover position="bottom-start" shadow="md" trapFocus>
      <Popover.Target>
        <Button
          className="sort-menu-button"
          size="xs"
          variant="default"
          disabled={busy}
          aria-label={tr('排序：{0}', summary)}
          leftSection={<Icon name="sort" size={15} />}
        >
          <span className="sort-menu-summary">{summary}</span>
        </Button>
      </Popover.Target>
      <Popover.Dropdown className="sort-menu">
        <Stack gap={6}>
          <Text size="sm" fw={600}>
            {tr('排序')}
          </Text>
          {!shown.length && (
            <Text size="xs" c="dimmed">
              {tr('依資料夾名稱排序')}
            </Text>
          )}
          <ol className="sort-keys" aria-label={tr('排序條件')} {...dnd.list}>
            {shown.map((key, index) => (
              <li
                key={key.field}
                {...dnd.row(index)}
                className={'sort-key' + dnd.row(index).className}
              >
                <Tooltip
                  label={tr('拖曳或 Alt+↑／↓ 調整順序')}
                  events={{ hover: true, focus: false, touch: false }}
                >
                  <button
                    type="button"
                    className="sort-key-grip"
                    aria-label={tr('移動排序條件 {0}', label(key.field))}
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
                <Select
                  size="xs"
                  variant="filled"
                  className="sort-key-field"
                  aria-label={tr('第 {0} 個排序條件', index + 1)}
                  allowDeselect={false}
                  searchable
                  comboboxProps={{ withinPortal: false }}
                  value={key.field}
                  data={choices
                    .filter((c) => c.id === key.field || !shown.some((k) => k.field === c.id))
                    .map((c) => ({ value: c.id, label: c.label }))}
                  onChange={(field) =>
                    field && set(shown.map((k, i) => (i === index ? { ...k, field } : k)))
                  }
                />
                <Tooltip label={key.asc ? tr('遞增') : tr('遞減')}>
                  <ActionIcon
                    variant="subtle"
                    aria-label={tr('{0}：{1}', label(key.field), key.asc ? tr('遞增') : tr('遞減'))}
                    onClick={() =>
                      set(shown.map((k, i) => (i === index ? { ...k, asc: !k.asc } : k)))
                    }
                  >
                    <Icon name={key.asc ? 'arrow-up' : 'arrow-down'} size={15} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label={tr('刪除排序條件')}>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    aria-label={tr('刪除排序條件 {0}', label(key.field))}
                    onClick={() => set(shown.filter((_, i) => i !== index))}
                  >
                    <Icon name="close" size={15} />
                  </ActionIcon>
                </Tooltip>
              </li>
            ))}
          </ol>
          {shown.length < MAX_SORT_KEYS && unused.length ? (
            <Button
              className="sort-key-add"
              size="compact-xs"
              variant="subtle"
              leftSection={<Icon name="plus" size={14} />}
              onClick={() => set([...shown, { field: unused[0].id, asc: true }])}
            >
              {tr('新增排序條件')}
            </Button>
          ) : (
            <Text size="xs" c="dimmed">
              {tr('已達 {0} 個條件的上限', MAX_SORT_KEYS)}
            </Text>
          )}
          <Text size="xs" c="dimmed">
            {tr('全部相同時依名稱排')}
          </Text>
          <Switch
            size="xs"
            label={tr('資料夾優先')}
            description={tr('只用來分類的資料夾排在作品前面')}
            checked={foldersFirst}
            onChange={(e) => onChange(shown, e.currentTarget.checked)}
          />
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )
}
