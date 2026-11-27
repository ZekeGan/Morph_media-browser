import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'

import {
  foreignDispose,
  openArchive,
  parseListing,
  readArchiveImage,
} from '../electron/archive-foreign'
import { rarFixture, sevenZipFixture, tinyPng, zipFixture } from './support/archive-fixture'

// R-407: CBR (RAR) and CB7 (7z) archives are read from memory by 7-Zip (WebAssembly); the real content picks the format.
async function folder(t: { after: (fn: () => Promise<void>) => void }) {
  const base = path.resolve('.test-output')
  await fs.mkdir(base, { recursive: true })
  const root = await fs.mkdtemp(path.join(base, 'archive-foreign-'))
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
  return root
}

const pages = [
  { name: '10.png', bytes: tinyPng },
  { name: '2.png', bytes: tinyPng },
  { name: 'sub/漫畫 01.png', bytes: tinyPng },
  { name: 'notes.txt', bytes: Buffer.from('not a page') },
]
test('a RAR archive lists its pictures in natural order and gives each one back unchanged', async (t) => {
  const file = path.join(await folder(t), 'book.cbr')
  await fs.writeFile(file, rarFixture(pages))
  const index = await openArchive(file)
  assert.equal(index.format, 'rar')
  assert.deepEqual(
    index.images.map((entry) => entry.name),
    ['2.png', '10.png', 'sub/漫畫 01.png']
  )
  for (const entry of index.images) {
    assert.deepEqual(await readArchiveImage(file, index, entry), tinyPng)
  }
  await foreignDispose(index)
})
test('a 7z archive lists and reads pictures, including names outside ASCII', async (t) => {
  const file = path.join(await folder(t), 'book.cb7')
  await fs.writeFile(file, await sevenZipFixture(pages))
  const index = await openArchive(file)
  assert.equal(index.format, '7z')
  assert.deepEqual(
    index.images.map((entry) => entry.name),
    ['2.png', '10.png', 'sub/漫畫 01.png']
  )
  for (const entry of index.images) {
    assert.deepEqual(await readArchiveImage(file, index, entry), tinyPng)
  }
  await foreignDispose(index)
})
test('the content, not the extension, decides: a ZIP named .cbr opens as ZIP', async (t) => {
  const file = path.join(await folder(t), 'zip.cbr')
  await fs.writeFile(file, zipFixture([{ name: '1.png', bytes: tinyPng }]))
  const index = await openArchive(file)
  assert.equal(index.format, undefined)
  assert.equal(index.images.length, 1)
})
test('damaged, changed and unsupported archives are refused without writing anything', async (t) => {
  const root = await folder(t)
  const bad = path.join(root, 'bad.cbr')
  await fs.writeFile(bad, rarFixture([{ name: '1.png', bytes: tinyPng, crc: 1 }]))
  const index = await openArchive(bad)
  await assert.rejects(readArchiveImage(bad, index, index.images[0]), /校驗|無法解壓/)
  // A changed file must be reopened.
  await fs.appendFile(bad, 'x')
  await assert.rejects(readArchiveImage(bad, index, index.images[0]), /已變更/)
  await foreignDispose(index)
  const text = path.join(root, 'text.cb7')
  await fs.writeFile(text, 'just text, not an archive')
  await assert.rejects(openArchive(text), /不是支援/)
  const empty = path.join(root, 'cut.cb7')
  await fs.writeFile(empty, (await sevenZipFixture(pages)).subarray(0, 40))
  await assert.rejects(openArchive(empty))
  assert.deepEqual((await fs.readdir(root)).sort(), ['bad.cbr', 'cut.cb7', 'text.cb7'])
})
test('names that could escape or act as command options are refused', async (t) => {
  const root = await folder(t)
  for (const name of ['../evil.png', '-o.png', '@list.png', 'C:/x.png', '/abs.png']) {
    const file = path.join(root, 'evil.cbr')
    await fs.writeFile(file, rarFixture([{ name, bytes: tinyPng }]))
    const result = await openArchive(file).then(
      (index) => index.images.map((entry) => entry.name),
      () => 'refused'
    )
    assert.ok(
      !Array.isArray(result) || result.every((entry) => !/(^|\/)\.\.(\/|$)|^[-@/]|:/.test(entry)),
      name + ' -> ' + JSON.stringify(result)
    )
  }
  assert.deepEqual(await fs.readdir(root), ['evil.cbr'])
  assert.throws(() => parseListing(['no dashed line']))
})
