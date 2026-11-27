// Adds interface text in all five languages to src/i18n/messages.json (R-358). Keys are the zh-TW sentence.
//   pnpm i18n add <file.json> [--force]
// The file maps each zh-TW sentence to its other four languages, as a list or an object:
//   { "上次讀到第 {0} 頁": ["上次读到第 {0} 页", "Last read: page {0}", "前回は {0} ページまで", "Última lectura: página {0}"] }
//   { "…": { "zh-CN": "…", "en": "…", "ja": "…", "es": "…" } }
// An existing key is only replaced with --force; every translation must keep the {n} placeholders of its key.
// A sentence using a word people do not understand is refused, with what to write instead (R-515).
//   pnpm i18n diff [ref]
// Lists the sentences added, changed or removed since ref (default origin/main, so the whole unpushed batch), with
// where each new one is used; the batch report quotes it (R-515).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { wordingProblems } from './text-rules.mjs'

export const languages = ['zh-CN', 'en', 'ja', 'es']
const placeholders = (text) =>
  [...text.matchAll(/\{\d+\}/g)]
    .map((m) => m[0])
    .sort()
    .join(',')

export function addMessages(messages, entries, force = false) {
  const out = { ...messages }
  const added = []
  for (const [key, value] of Object.entries(entries)) {
    const translations = Array.isArray(value)
      ? Object.fromEntries(languages.map((language, i) => [language, value[i]]))
      : value
    for (const language of languages) {
      if (typeof translations[language] !== 'string' || !translations[language].trim()) {
        throw new Error(`「${key}」缺少 ${language}`)
      }
    }
    for (const language of languages) {
      if (placeholders(translations[language]) !== placeholders(key)) {
        throw new Error(`「${key}」的 ${language} 佔位符不一致：${translations[language]}`)
      }
    }
    if (key in out && !force) throw new Error(`「${key}」已經有翻譯（要取代就加 --force）`)
    const wording = wordingProblems(key)
    if (wording.length) throw new Error(`「${key}」用了一般人看不懂的詞：${wording.join('、')}`)
    out[key] = Object.fromEntries(languages.map((language) => [language, translations[language]]))
    added.push(key)
  }
  return { messages: out, added }
}

// Where a sentence is used in the window or main-process code, as file:line.
function usedAt(root, key) {
  const needle = key.replace(/\s+/g, ' ')
  const files = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', 'src', 'shared', 'electron'],
    {
      cwd: root,
      encoding: 'utf8',
    }
  )
    .split('\n')
    .filter((file) => /\.(ts|tsx)$/.test(file))
  for (const file of files) {
    const lines = fs.readFileSync(path.join(root, file), 'utf8').split('\n')
    const index = lines.findIndex((line) => line.includes(needle))
    if (index >= 0) return `${file}:${index + 1}`
  }
  return '（多行字串或動態組合）'
}

function diff(ref = 'origin/main') {
  const root = path.resolve(import.meta.dirname, '..')
  const now = JSON.parse(fs.readFileSync(path.join(root, 'src/i18n/messages.json'), 'utf8'))
  const before = JSON.parse(
    execFileSync('git', ['show', ref + ':src/i18n/messages.json'], { cwd: root, encoding: 'utf8' })
  )
  const added = Object.keys(now).filter((key) => !(key in before))
  const removed = Object.keys(before).filter((key) => !(key in now))
  const changed = Object.keys(now).filter(
    (key) => key in before && JSON.stringify(now[key]) !== JSON.stringify(before[key])
  )
  console.log(
    `介面文字變動（相對 ${ref}）：新增 ${added.length}、改翻譯 ${changed.length}、移除 ${removed.length}`
  )
  for (const key of added) console.log(`+ ${key}　〔${usedAt(root, key)}〕`)
  for (const key of changed) console.log(`~ ${key}（只改翻譯）`)
  if (removed.length) console.log(`- 移除 ${removed.length} 句`)
}

function main() {
  const [command, file, ...rest] = process.argv.slice(2)
  if (command === 'diff') return diff(file)
  if (command !== 'add' || !file) {
    console.log(
      fs
        .readFileSync(import.meta.filename, 'utf8')
        .split('\n')
        .filter((l) => l.startsWith('//'))
        .join('\n')
    )
    process.exit(command ? 2 : 0)
  }
  const target = path.resolve(import.meta.dirname, '../src/i18n/messages.json')
  const { messages, added } = addMessages(
    JSON.parse(fs.readFileSync(target, 'utf8')),
    JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')),
    rest.includes('--force')
  )
  fs.writeFileSync(target, JSON.stringify(messages, null, 2) + '\n')
  console.log(`加入 ${added.length} 句`)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
