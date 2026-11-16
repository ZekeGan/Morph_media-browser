import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { safePath } from './files'
import { renpySaveDirectory } from './renpy-save'
import { httpUrl } from '../shared/fields'
import { localeProfileId, type FolderRecord } from '../shared/model'

// Game page extras (R-305–R-310): everything here is read-only and worked out in main from the game folder and its
// record. The window only ever learns names and labels, never paths it could hand back to be opened.

// R-307: the Steam App ID from steam_appid.txt at the top of the game, or from a Steam import on the folder.
export async function steamAppId(root: string, record: FolderRecord | undefined) {
  const file = path.join(root, 'steam_appid.txt')
  try {
    await safePath(root, file)
    const stat = await fs.stat(file)
    if (stat.isFile() && stat.size <= 64) {
      const id = (await fs.readFile(file, 'utf8')).trim()
      if (/^[1-9]\d{0,9}$/.test(id) && Number(id) <= 4294967295) return id
    }
  } catch {}
  const value = record?.attributes.find((a) => a.attributeId === 'steam-app_id')?.value
  const id = typeof value === 'number' || typeof value === 'string' ? String(value) : ''
  return /^[1-9]\d{0,9}$/.test(id) && Number(id) <= 4294967295 ? id : undefined
}

// R-310, R-316: the work's page on a store, from what a website import saved. Catalogue sites (VNDB, Bangumi…)
// are not stores, so they give no button. HTTPS only.
export const storeSites: Record<string, string> = {
  steam: 'Steam',
  dlsite: 'DLsite',
  fanza: 'FANZA',
  booth: 'BOOTH',
}
export function store(record: FolderRecord | undefined) {
  const attributes = record?.attributes ?? []
  const site = (id: string) => id.slice(0, id.indexOf('-'))
  const order = (id: string) => (id === 'steam-store_url' ? 0 : id.endsWith('-store_url') ? 1 : 2)
  const found = attributes
    .filter(
      (a) => /-(store_url|source_url)$/.test(a.attributeId) && site(a.attributeId) in storeSites
    )
    .sort((a, b) => order(a.attributeId) - order(b.attributeId))
    .find((a) => typeof a.value === 'string' && httpUrl(a.value) && a.value.startsWith('https://'))
  return found
    ? { url: found.value as string, site: storeSites[site(found.attributeId)] }
    : undefined
}
export const storeUrl = (record: FolderRecord | undefined) => store(record)?.url

const isDir = async (file: string) => {
  try {
    return (await fs.stat(file)).isDirectory()
  } catch {
    return false
  }
}
const readSmall = async (root: string, file: string, limit = 64 * 1024) => {
  try {
    await safePath(root, file)
    const stat = await fs.stat(file)
    return stat.isFile() && stat.size <= limit ? await fs.readFile(file, 'utf8') : undefined
  } catch {
    return undefined
  }
}
// A name taken from a game file must stay one plain folder name before it is joined to a user folder.
const plainName = (value: string) =>
  value && value.length <= 200 && !/[\\/:*?"<>|\0]/.test(value) && !/^\.+$/.test(value)
    ? value
    : undefined

// R-305, R-384: where the engine keeps saves. `found` is a folder that exists; `pending` is a place the engine is known
// to use that does not exist yet (the game has not saved: "no saves yet"); `unknown` is when nothing can be worked out.
// Rules, all read-only and with names that must stay one plain folder name:
// - Unity: *_Data/app.info names the company and product (AppData\LocalLow).
// - Ren'Py: config.save_directory in game/options.rpy, else in options.rpyc (loose or inside an .rpa) (AppData\Roaming\RenPy).
// - Godot: project.godot next to the game (an exported game keeps its settings inside the .pck, which is not read):
//   AppData\Roaming\Godot\app_userdata\<config/name>, or <custom_user_dir_name> under AppData\Roaming.
// - RPG Maker 2000/2003: Save01.lsd… next to RPG_RT.exe, so the game folder itself.
// - NW.js (nw.pak next to the game) and Electron (resources\app): package.json `name`. NW.js keeps its profile in
//   AppData\Local\<name>; Electron in AppData\Roaming\<productName or name>. TyranoScript games and unidentified
//   packaged apps only; Electron's app.asar is not opened.
// - RPG Maker MV/MZ: save or www/save inside the game; WOLF: Save; RPG Maker XP–Ace: Save (R-416 shelved).
export type SaveGuess = { state: 'found'; folder: string } | { state: 'pending' | 'unknown' }
export async function engineSave(
  root: string,
  engines: string[],
  home = os.homedir()
): Promise<SaveGuess> {
  let pending = false
  const user = (...parts: string[]) => path.join(home, 'AppData', ...parts)
  // A folder the engine is known to use: found when it exists, otherwise remembered as "no saves yet".
  const expect = async (folder: string) => {
    if (await isDir(folder)) return true
    pending = true
    return false
  }
  if (engines.includes('Unity')) {
    for (const entry of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory() || !/_Data$/i.test(entry.name)) continue
      const info = await readSmall(root, path.join(root, entry.name, 'app.info'), 4096)
      const [company, product] = (info ?? '').split(/\r?\n/).map((line) => line.trim())
      const safeCompany = plainName(company ?? ''),
        safeProduct = plainName(product ?? '')
      if (!safeCompany || !safeProduct) continue
      const folder = user('LocalLow', safeCompany, safeProduct)
      if (await expect(folder)) return { state: 'found', folder }
    }
  }
  if (engines.includes('Ren’Py')) {
    const options = await readSmall(root, path.join(root, 'game', 'options.rpy'))
    const name = plainName(
      /config\.save_directory\s*=\s*["']([^"'\r\n]+)["']/.exec(options ?? '')?.[1] ??
        (options === undefined ? ((await renpySaveDirectory(root)) ?? '') : '')
    )
    if (name) {
      const folder = user('Roaming', 'RenPy', name)
      if (await expect(folder)) return { state: 'found', folder }
    }
  }
  if (engines.includes('Godot')) {
    const project = await readSmall(root, path.join(root, 'project.godot'))
    if (project !== undefined) {
      const setting = (key: string) =>
          new RegExp('^' + key + '\s*=\s*"([^"\r\n]*)"', 'm').exec(project)?.[1] ?? '',
        custom = /^config\/use_custom_user_dir\s*=\s*true/m.test(project)
          ? plainName(setting('config/custom_user_dir_name'))
          : undefined,
        name = plainName(setting('config/name'))
      const folder = custom
        ? user('Roaming', custom)
        : name
          ? user('Roaming', 'Godot', 'app_userdata', name)
          : undefined
      if (folder && (await expect(folder))) return { state: 'found', folder }
    }
  }
  if (engines.includes('RPG Maker 2000/2003')) {
    const names = await fs.readdir(root).catch(() => [])
    if (names.some((name) => /^Save\d\d\.lsd$/i.test(name))) return { state: 'found', folder: root }
    pending = true
  }
  if (engines.includes('TyranoScript') || !engines.length) {
    const folder = await packagedAppFolder(root, home)
    if (folder && (await expect(folder))) return { state: 'found', folder }
  }
  const inside = [
    ...(engines.some((e) => /^RPG Maker M[VZ]$/.test(e)) ? ['www/save', 'save'] : []),
    ...(engines.some((e) => e === 'RPG Maker XP/VX/Ace' || e === 'WOLF RPG') ? ['Save'] : []),
  ]
  for (const rel of inside) {
    const folder = path.join(root, rel)
    try {
      await safePath(root, folder)
      if (await isDir(folder)) return { state: 'found', folder }
    } catch {}
  }
  // Engines that create their save folder on the first save are known, just empty so far.
  if (engines.some((e) => /^RPG Maker M[VZ]$/.test(e) || e === 'WOLF RPG')) pending = true
  return { state: pending ? 'pending' : 'unknown' }
}
export async function engineSaveFolder(root: string, engines: string[], home = os.homedir()) {
  const guess = await engineSave(root, engines, home)
  return guess.state === 'found' ? guess.folder : undefined
}

// NW.js and Electron keep their profile (local storage, and so many games' saves) under the app's package.json name.
async function packagedAppFolder(root: string, home: string) {
  const has = async (...rel: string[]) => {
    try {
      await safePath(root, path.join(root, ...rel))
      return (await fs.stat(path.join(root, ...rel))).isFile()
    } catch {
      return false
    }
  }
  const nw =
    (await has('nw.pak')) || (await has('nw_100_percent.pak')) || (await has('nw_200_percent.pak'))
  for (const rel of nw ? [['package.json']] : [['resources', 'app', 'package.json']]) {
    let manifest: { name?: unknown; productName?: unknown } | undefined
    try {
      manifest = JSON.parse((await readSmall(root, path.join(root, ...rel))) ?? '')
    } catch {}
    const name = plainName(typeof manifest?.name === 'string' ? manifest.name : '')
    if (nw && name) return path.join(home, 'AppData', 'Local', name)
    const product = plainName(
      typeof manifest?.productName === 'string' ? manifest.productName : (name ?? '')
    )
    if (!nw && product) return path.join(home, 'AppData', 'Roaming', product)
  }
  return undefined
}

// R-306: bundled settings tools and manuals at the top of the game folder. Installers, uninstallers and runtime
// redistributables are left out; nothing is run or added until the user picks it.
const excluded =
  /^(unins|vcredist|vc_redist|dxsetup|dxwebsetup|directx|dotnet|ndp\d|oalinst|physx)/i
export async function bundledSuggestions(root: string) {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  const result: { name: string; role: 'config' | 'manual' }[] = []
  for (const entry of entries) {
    if (!entry.isFile() || excluded.test(entry.name)) continue
    if (/^(config|setup|環境設定.*|.*config.*)\.exe$/i.test(entry.name))
      result.push({ name: entry.name, role: 'config' })
    else if (
      /\.(pdf|html?)$/i.test(entry.name) ||
      /^(readme|manual|説明書|マニュアル|説明|はじめに|お読みください|使用說明|說明書)[^\\/]*\.(txt|md|rtf|pdf|html?)$/i.test(
        entry.name
      )
    )
      result.push({ name: entry.name, role: 'manual' })
  }
  return result
    .sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name))
    .slice(0, 20)
}

// R-319: the profiles made in Locale Emulator, from LEConfig.xml next to LEProc.exe. Only names and GUIDs are read
// (a small file, forward attribute scanning, no XML parser); a missing or odd file just means no profiles.
export async function localeProfiles(runner: string | undefined) {
  if (!runner) return []
  try {
    const file = path.join(path.dirname(runner), 'LEConfig.xml'),
      stat = await fs.stat(file)
    if (!stat.isFile() || stat.size > 512 * 1024) return []
    const text = await fs.readFile(file, 'utf8'),
      found: { guid: string; name: string }[] = []
    for (const tag of text.match(/<Profile\s[^>]{0,2000}>/g) ?? []) {
      const attr = (name: string) => tag.match(new RegExp('\\s' + name + '="([^"]{0,200})"'))?.[1]
      const guid = attr('Guid'),
        name = attr('Name')
      if (guid && name && localeProfileId(guid) && !found.some((p) => p.guid === guid))
        found.push({ guid: guid.toLowerCase(), name: xmlText(name).slice(0, 100) })
      if (found.length >= 50) break
    }
    return found
  } catch {
    return []
  }
}
const xmlText = (value: string) =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
