import { useLayoutEffect, useState, type RefObject } from 'react'
import { t as tr } from './i18n'

// R-243: the drafts not saved yet (a folder's fields, the layout editor, the shell's group or project editing, the
// appearance settings) and what they guard: leaving asks first, and closing the window warns while any is open.
export function useDrafts({
  settingsDirty,
  creating,
  busy,
}: {
  // The project settings differ from what is saved (worked out by the caller from the snapshot).
  settingsDirty: boolean
  // The new project dialog is open.
  creating: boolean
  busy: RefObject<boolean>
}) {
  const [detailDirty, setDetailDirty] = useState(false),
    [editorDirty, setEditorDirty] = useState(false),
    [shellDirty, setShellDirty] = useState(false),
    [appearanceDirty, setAppearanceDirty] = useState(false)
  const unsaved = detailDirty || editorDirty || settingsDirty || shellDirty || appearanceDirty,
    dirty = unsaved || creating
  const confirmLeave = () => !dirty || window.confirm(tr('離開會放棄尚未保存的草稿，確定繼續？'))
  useLayoutEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty || busy.current) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])
  return {
    detailDirty,
    setDetailDirty,
    setEditorDirty,
    setShellDirty,
    setAppearanceDirty,
    unsaved,
    confirmLeave,
  }
}
