import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import { Library } from '../electron/library'
import { closeApp, launchApp, removeTestRoot, reportFailure } from './support/app'

// R-449: a MusicBrainz album preview offers its versions, picks the one whose track count matches the folder's music
// files, and switching versions keeps what was ticked. Main's fetch is replaced: no request leaves the computer.
const base = path.resolve('.test-output')
await fs.mkdir(path.join(base, 'shot'), { recursive: true })
const root = await fs.mkdtemp(path.join(base, 'musicbrainz-version-ui-'))
const media = path.join(root, 'Album')
const local = path.join(root, 'local')
await fs.mkdir(media, { recursive: true })
for (let n = 1; n <= 10; n++) {
  await fs.writeFile(path.join(media, String(n).padStart(2, '0') + '.mp3'), '')
}
const library = new Library(local, undefined, false)
await library.init()
await library.create(media, {
  name: 'Album test',
  depth: { mode: 'through', level: 1 },
  scanAll: true,
})
const group = '11111111-2222-3333-4444-000000000001'
const cd = '11111111-2222-3333-4444-00000000000a'
const digital = '11111111-2222-3333-4444-00000000000b'
const errors: string[] = []
const { app, page } = await launchApp(local, errors, { width: 1300, height: 900 })
let passed = false
try {
  // tsx names the functions below with a helper the main process does not have.
  await app.evaluate('globalThis.__name = (target) => target')
  await app.evaluate(
    (_electron, { group, cd, digital }) => {
      const release = (id: string, date: string, tracks: number, format: string) => ({
        id,
        date,
        status: 'Official',
        country: 'JP',
        'label-info': [{ label: { name: 'Label' }, 'catalog-number': 'CAT-' + id.slice(-1) }],
        media: [{ format, 'track-count': tracks }],
      })
      const releases = [
        release(cd, '2004-03-04', 10, 'CD'),
        release(digital, '2010-01-01', 12, 'Digital Media'),
      ]
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input)
        const json = (body: unknown) => new Response(JSON.stringify(body))
        if (url.startsWith('https://musicbrainz.org/ws/2/release-group/' + group)) {
          return json({
            id: group,
            title: 'Test Album',
            'first-release-date': '2004-03-04',
            'artist-credit': [{ name: 'Band' }],
          })
        }
        if (url.startsWith('https://musicbrainz.org/ws/2/release?release-group=' + group)) {
          return json({ releases })
        }
        const id = /\/ws\/2\/release\/([0-9a-f-]{36})\?/.exec(url)?.[1]
        const raw = releases.find((r) => r.id === id)
        if (raw) {
          return json({
            ...raw,
            barcode: 'BAR-' + raw.id.slice(-1),
            'release-group': { id: group },
            media: raw.media.map((m) => ({
              ...m,
              tracks: Array.from({ length: m['track-count'] }, (_, i) => ({ title: 'T' + i })),
            })),
          })
        }
        return new Response('', { status: 404 })
      }) as typeof fetch
    },
    { group, cd, digital }
  )
  await page.getByRole('button', { name: '開啟專案 Album test', exact: true }).first().click()
  await page.getByRole('button', { name: '目前資料夾設定', exact: true }).click()
  const drawer = page.locator('.folder-panel-dock-settings')
  await drawer.getByRole('tab', { name: /^資料/ }).click()
  await drawer
    .getByRole('textbox', { name: '作品網址或 ID', exact: true })
    .fill('https://musicbrainz.org/release-group/' + group)
  await drawer.getByRole('button', { name: '取得預覽', exact: true }).click()
  const menu = drawer.getByRole('textbox', { name: '版本', exact: true })
  await menu.waitFor()
  // The 10-track CD matches the folder's 10 music files.
  assert.match(await menu.inputValue(), /^✓ 曲數相符 · 2004-03-04 · JP · CD · 10 首 · Label CAT-a$/)
  const preview = drawer.locator('.source-preview')
  const barcode = preview.getByRole('checkbox', { name: '條碼', exact: true })
  await preview.getByText('BAR-a', { exact: true }).waitFor()
  await preview.getByRole('rowheader', { name: '最早發行日', exact: true }).waitFor()
  // Untick one field, switch to the digital version: the field stays unticked, the values are the new version's.
  await barcode.uncheck()
  await page.screenshot({ path: path.join(base, 'shot', 'r449-versions.png') })
  await menu.click()
  await page.getByRole('option', { name: /^2010-01-01 · JP · Digital Media · 12 首/ }).click()
  await preview.getByText('BAR-b', { exact: true }).waitFor()
  assert.equal(await barcode.isChecked(), false, 'what was unticked stays unticked')
  assert.equal(
    await preview.getByRole('checkbox', { name: '本版發行日', exact: true }).isChecked(),
    true
  )
  assert.equal(
    await preview.getByRole('checkbox', { name: '同時保存專輯的封面', exact: true }).count(),
    0,
    'no cover could be fetched in this test'
  )
  // Album data only: the version's values go away.
  await menu.click()
  await page.getByRole('option', { name: '不選版本，只用專輯資料', exact: true }).click()
  await barcode.waitFor({ state: 'detached' })
  assert.equal(await menu.inputValue(), '不選版本，只用專輯資料')
  assert.deepEqual(errors, [])
  passed = true
  console.log(
    'PASS MusicBrainz version menu: matching pick, switching keeps ticks, album only. ' + root
  )
} catch (error) {
  await reportFailure(page, root)
  throw error
} finally {
  await closeApp(app)
  if (passed) await removeTestRoot(root)
}
