import { useEffect, useState } from 'react'

import type { ProjectInput, RootSelection } from '../shared/model'
import type { WorkspacePrefs } from '../shared/workspace'

// R-243: the new project dialog's own state: whether it is open, the name and depth, the chosen root and the group
// the project goes into (with the groups to choose from, read when it opens).
export function useCreateProject(notifyError: (message: string) => void) {
  const [opened, setOpened] = useState(false)
  const [input, setInput] = useState<ProjectInput>({
    // Filled with the localized default when the dialog opens (the locale is not loaded yet at first render).
    name: '',
    depth: { mode: 'through', level: 50 },
    scanAll: true,
  })
  const [rootChoice, setRootChoice] = useState<RootSelection>()
  const [group, setGroup] = useState('')
  const [groups, setGroups] = useState<WorkspacePrefs['groups']>([])
  useEffect(() => {
    if (opened) {
      void window.desktop
        .workspace()
        .then((r) => setGroups(r.prefs.groups))
        .catch((e) => notifyError(String(e)))
    }
  }, [opened, notifyError])
  // Opens it empty: no name, no root, no group.
  const begin = () => {
    setInput((current) => ({ ...current, name: '' }))
    setRootChoice(undefined)
    setGroup('')
    setOpened(true)
  }
  return {
    opened,
    setOpened,
    begin,
    // Nothing typed or chosen yet, so closing loses nothing.
    empty: !rootChoice && !input.name.trim(),
    // The dialog's fields, as CreateProjectDialog takes them.
    fields: { input, setInput, groups, group, setGroup, rootChoice, setRootChoice },
  }
}
