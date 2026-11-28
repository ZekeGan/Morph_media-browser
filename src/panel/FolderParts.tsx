import { ActionIcon, Button, Tooltip } from '@mantine/core'
import { Fragment, useEffect, useRef, useState } from 'react'

import { isFilled } from '../../shared/cells'
import { fieldValue, type FolderRow, type Project } from '../../shared/model'

import { Icon } from '../common/icons'
import { fieldSourceGroups, rowFieldAttributes } from '../editor/fieldSources'
import { yesNo } from '../editor/fieldTypes'
import { importedFieldLabels } from '../editor/importedFieldLabels'
import { t as tr, useLocale } from '../i18n'
import { importSources } from '../metadata/importSource'

// Filled values only; 0 and false are real values, empty strings and arrays are not.
const shown = (value: unknown, binding?: { trueLabel?: string; falseLabel?: string }) =>
  !isFilled(value)
    ? undefined
    : typeof value === 'boolean'
      ? yesNo(value, binding)
      : Array.isArray(value)
        ? value.join(', ')
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value)

export function FolderDetails({
  row,
  project,
  openFolder,
  all = false,
}: {
  row: FolderRow
  project: Project
  openFolder: () => void
  // R-390: also the values stored for the folder that are not fields of this project (for example ones a website
  // import brought), long text shown whole, and a mark on website values changed by hand.
  all?: boolean
}) {
  useLocale()
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  // Only the last two folders are shown (with an ellipsis in front); the copy button still copies the whole path.
  const parts = row.path.split(/[\\/]+/).filter(Boolean)
  const separator = row.path.includes('\\') ? '\\' : '/'
  const shortPath = (parts.length > 2 ? '…' + separator : '') + parts.slice(-2).join(separator)
  const sources = importSources(row)
  const stored = [
    ...(row.record?.projectOverrides[row.projectId] ?? []),
    ...(row.record?.attributes ?? []),
  ]
  const bound = new Set(project.fieldBindings.map((field) => field.attributeId))
  const plain = importedFieldLabels()
  const fields = [
    ...project.fieldBindings.map((field) => ({
      attributeId: field.attributeId,
      label: field.alias,
      binding: field as { trueLabel?: string; falseLabel?: string } | undefined,
    })),
    ...(all
      ? [...new Map(stored.map((a) => [a.attributeId, a])).values()]
          .filter((a) => !bound.has(a.attributeId))
          .map((a) => ({
            attributeId: a.attributeId,
            label: plain[a.key] ?? a.key,
            binding: undefined,
          }))
      : []),
  ].flatMap((field) => {
    const text = shown(fieldValue(row, field.attributeId), field.binding)
    return text === undefined
      ? []
      : [
          {
            attributeId: field.attributeId,
            label: field.label,
            text,
            // A website value the user changed afterwards.
            edited:
              all && stored.find((a) => a.attributeId === field.attributeId)?.source === 'manual',
          },
        ]
  })
  return (
    <details className={'folder-details' + (all ? ' folder-details-full' : '')}>
      <summary>{tr('資料夾詳情')}</summary>
      <dl>
        <div className="folder-details-row">
          <dt>{tr('位置')}</dt>
          <dd>
            <Tooltip label={copied ? tr('已複製') : tr('複製完整路徑')}>
              <button
                type="button"
                className="path-copy-button folder-details-path-button"
                aria-label={tr('複製完整路徑')}
                onClick={async () => {
                  try {
                    await window.media.request({ action: 'copyPath', rowId: row.rowId })
                    setCopyError('')
                    setCopied(true)
                    window.clearTimeout(timer.current)
                    timer.current = window.setTimeout(() => setCopied(false), 1500)
                  } catch (error) {
                    setCopyError(String(error))
                  }
                }}
              >
                <Icon name={copied ? 'check' : 'copy'} size={13} />
                <span className="folder-details-path" title={row.path}>
                  {shortPath}
                </span>
                {copied && <span className="applied-pill">{tr('已複製')}</span>}
              </button>
            </Tooltip>
            <Tooltip label={tr('在檔案總管開啟')}>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                aria-label={tr('在檔案總管開啟')}
                onClick={openFolder}
              >
                <Icon name="folder" size={14} />
              </ActionIcon>
            </Tooltip>
          </dd>
        </div>
        {!!sources.length && (
          <div className="folder-details-row">
            <dt>{tr('資料來源')}</dt>
            <dd>
              <span className="folder-details-sources">
                {sources.map((source, index) => (
                  <span key={source.name}>
                    {index > 0 && '、'}
                    <button
                      type="button"
                      className="source-link"
                      onClick={async () => {
                        try {
                          await window.explorer.request({ action: 'openExternal', url: source.url })
                          setCopyError('')
                        } catch (error) {
                          setCopyError(String(error))
                        }
                      }}
                    >
                      {source.name}
                      <Icon name="external" size={12} />
                    </button>
                  </span>
                ))}
              </span>
            </dd>
          </div>
        )}
        {fieldSourceGroups(fields, rowFieldAttributes([row])).map(({ source, fields }) => (
          <Fragment key={source}>
            <div className="folder-details-row field-source-heading">
              <dt>{source}</dt>
              <dd />
            </div>
            {fields.map((field) => (
              <div className="folder-details-row" key={field.attributeId}>
                <dt title={field.label}>{field.label}</dt>
                <dd>
                  <span>{field.text}</span>
                  {field.edited && source !== tr('自建') && (
                    <small className="muted">{tr('已手動修改')}</small>
                  )}
                </dd>
              </div>
            ))}
          </Fragment>
        ))}
      </dl>
      {copyError && <small role="alert">{copyError}</small>}
    </details>
  )
}

export function SubfolderList({
  folders,
  childNames,
  busy,
  onChild,
  className = '',
}: {
  folders: { id: string; name: string }[]
  childNames?: string[]
  busy: boolean
  onChild: (name: string) => void
  className?: string
}) {
  useLocale()
  if (!folders.length) return null
  return (
    <details className={'media-subfolders ' + className} open>
      <summary>
        {tr('子資料夾')} ({folders.length})
      </summary>
      <div>
        {folders.map((folder) => (
          <div className="media-subfolder" key={folder.id}>
            <Button
              size="compact-xs"
              variant="subtle"
              disabled={busy || !childNames?.includes(folder.name)}
              title={childNames?.includes(folder.name) ? folder.name : tr('尚未建立或受保護')}
              onClick={() => onChild(folder.name)}
            >
              <Icon name="folder" size={14} />
              {folder.name}
            </Button>
          </div>
        ))}
      </div>
    </details>
  )
}
