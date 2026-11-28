import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import { Library } from '../electron/library'
import { closeApp, launchApp, removeTestRoot, reportFailure } from './support/app'

// R-443: the name search's sources are chosen in a button left of Search. It says the first source and "+N"; the
// menu ticks sources by group and can go back to the kind's defaults; with nothing ticked the button says so and the
// search cannot run. The choice is kept per folder kind on this computer.
const base = path.resolve('.test-output')
await fs.mkdir(path.join(base, 'shot'), { recursive: true })
const root = await fs.mkdtemp(path.join(base, 'source-search-sources-ui-'))
const media = path.join(root, 'Library')
const local = path.join(root, 'local')
await fs.mkdir(path.join(media, 'Work'), { recursive: true })
const library = new Library(local, undefined, false)
await library.init()
await library.create(media, { name: 'Search', scanAll: true, depth: { mode: 'through', level: 2 } })

const errors: string[] = []
const { app, page } = await launchApp(local, errors, { width: 1500, height: 950 })
let passed = false
try {
  await page.getByRole('button', { name: '開啟專案 Search', exact: true }).first().click()
  await page.getByRole('button', { name: '目前資料夾設定', exact: true }).click()
  // R-549: website import starts collapsed as an on-demand action bar.
  await page.getByRole('button', { name: '從網站匯入…', exact: true }).click()
  // A general folder searches every keyless source by default: the first one and "+N".
  const sources = page.locator('.source-search-sources')
  await sources.waitFor()
  assert.equal((await sources.innerText()).trim(), 'VNDB +6')
  const searchButton = page.getByRole('button', { name: '搜尋', exact: true })
  assert.equal(await searchButton.isDisabled(), false)
  // The old multi-select below the search box is gone.
  assert.equal(await page.getByRole('textbox', { name: '搜尋的來源', exact: true }).count(), 0)
  await sources.click()
  const menu = page.locator('.source-search-menu')
  await menu.getByText('需要金鑰', { exact: true }).waitFor()
  await menu.getByText('成人向', { exact: true }).waitFor()
  // A source that needs a key the user has not set cannot be ticked.
  assert.equal(await menu.getByRole('checkbox', { name: /^TMDB/ }).isDisabled(), true)
  await page.screenshot({ path: path.join(base, 'shot', 'r443-sources.png') })
  // Unticking VNDB updates the button and is kept for this kind.
  await menu.getByRole('checkbox', { name: 'VNDB', exact: true }).click()
  await page.waitForFunction(
    () => document.querySelector('.source-search-sources')?.textContent?.trim() === 'MusicBrainz +5'
  )
  await page.waitForFunction(async () => {
    const saved = (await window.desktop.workspace()).prefs.searchSources?.general
    return !!saved && !saved.includes('vndb') && saved.includes('musicbrainz')
  })
  // With nothing ticked the button says so and the search is off.
  for (const name of ['MusicBrainz', 'AniList', 'Bangumi', 'Steam', 'DLsite', 'nhentai']) {
    await menu.getByRole('checkbox', { name, exact: true }).click()
  }
  await page.waitForFunction(
    () => document.querySelector('.source-search-sources')?.textContent?.trim() === '未選來源'
  )
  assert.equal(await searchButton.isDisabled(), true)
  // Back to the kind's defaults.
  await menu.getByRole('button', { name: '還原此類型預設', exact: true }).click()
  await page.waitForFunction(
    () => document.querySelector('.source-search-sources')?.textContent?.trim() === 'VNDB +6'
  )
  assert.equal(await searchButton.isDisabled(), false)
  assert.deepEqual(errors, [])
  passed = true
  console.log(
    'PASS name search sources button: label, groups, keyless sources, empty choice, defaults. ' +
      root
  )
} catch (error) {
  await reportFailure(page, root)
  throw error
} finally {
  await closeApp(app)
  if (passed) await removeTestRoot(root)
}
