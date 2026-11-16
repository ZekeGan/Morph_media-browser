import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarkdownChapter } from '../src/novel/MarkdownChapter'
import { readNovel } from '../electron/novel'
import { emptySample, countFile } from '../shared/kind'

const html = (text: string) => renderToStaticMarkup(createElement(MarkdownChapter, { text }))

test('R-399: headings, lists, tables and code blocks are typeset', () => {
  const out = html(
    '# Title\n\n- one\n- two\n\n1. a\n2. b\n\n| h1 | h2 |\n| -- | -- |\n| x | y |\n\n```\nlet a = 1\n```\n\n**bold** and `code`\n'
  )
  for (const part of [
    '<h1>Title</h1>',
    '<ul>',
    '<ol>',
    '<table>',
    '<th>h1</th>',
    '<pre><code>',
    '<strong>bold</strong>',
  ])
    assert.ok(out.includes(part), part)
})

test('R-399: raw HTML stays text, pictures are never loaded, only http(s) links are links', () => {
  const out = html(
    '<script>alert(1)</script>\n\n<img src="x.png" onerror="alert(1)">\n\n![alt text](https://example.com/a.png)\n\n' +
      '[web](https://example.com/page) [bad](javascript:alert(1)) [file](file:///C:/x) [rel](other.md)\n'
  )
  // Escaped HTML is only text: no real script or image element, no attribute that navigates or loads.
  assert.ok(!/<(script|img|iframe)|<[a-z]+[^>]* (href|src|onerror)=/i.test(out), out)
  assert.ok(out.includes('[alt text]'))
  assert.equal((out.match(/role="link"/g) ?? []).length, 1)
  assert.ok(out.includes('title="https://example.com/page"'))
})

test('R-399: a .md file is one text chapter in the reader and does not make a folder a text book', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'md-'))
  try {
    const file = path.join(dir, 'note.md')
    await fs.writeFile(file, '# Head\r\n\r\ntext\r\n')
    const book = await readNovel(file, () => '')
    assert.equal(book.markdown, true)
    assert.equal(book.title, 'note')
    assert.deepEqual(book.chapters, [{ title: '', text: '# Head\n\ntext\n' }])
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
  const sample = emptySample()
  countFile(sample, 'text', 'README.md')
  countFile(sample, 'text', 'a.txt')
  assert.equal(sample.texts, 1)
})
