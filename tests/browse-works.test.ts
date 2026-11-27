import assert from 'node:assert/strict'
import { test } from 'node:test'

import { worksBelow } from '../shared/browse'
import { emptySample } from '../shared/kind'
import type { FolderRow } from '../shared/model'

const none = emptySample()
const pictures = { ...none, images: 20, total: 20 }
let n = 0
const row = (path: string, extra: Partial<FolderRow> = {}): FolderRow => ({
  rowId: 'r' + n++,
  path,
  name: path.split('/').pop()!,
  depth: path.split('/').length - 1,
  projectId: 'p',
  stopped: false,
  duplicate: false,
  contents: none,
  ...extra,
})
const names = (rows: FolderRow[]) => rows.map((r) => r.name).sort()

test('R-340: "all works" follows each branch to its first work and passes collections through', () => {
  const rows = [
    row('L'),
    // A game on level 2, another inside a category on level 3.
    row('L/Game A', { boundary: { engines: ['Unity'], evidence: [], state: 'root' } }),
    row('L/RPG'),
    row('L/RPG/Game B', { boundary: { engines: ['RPG Maker'], evidence: [], state: 'candidate' } }),
    // A manga series: volumes are one work.
    row('L/Manga'),
    row('L/Manga/Series'),
    row('L/Manga/Series/Vol.1', { contents: pictures }),
    row('L/Manga/Series/Vol.2', { contents: pictures }),
    // A single manga holds its pictures itself.
    row('L/Manga/One shot', { contents: pictures }),
    // A collection with one stray image is still a collection.
    row('L/Music', { contents: { ...none, images: 1, total: 1 } }),
    row('L/Music/Album', { contents: { ...none, audio: 12, total: 12 } }),
  ]
  assert.deepEqual(names(worksBelow(rows, 'L', Infinity)), [
    'Album',
    'Game A',
    'Game B',
    'One shot',
    'Series',
  ])
  // A depth limit stops at that level even inside collections.
  assert.deepEqual(names(worksBelow(rows, 'L', 1)), ['Game A', 'Manga', 'Music', 'RPG'])
  // Folders named without numbers are separate works, not volumes.
  const plain = [
    row('M'),
    row('M/Comics'),
    row('M/Comics/Alpha', { contents: pictures }),
    row('M/Comics/Beta', { contents: pictures }),
  ]
  assert.deepEqual(names(worksBelow(plain, 'M', Infinity)), ['Alpha', 'Beta'])
})
