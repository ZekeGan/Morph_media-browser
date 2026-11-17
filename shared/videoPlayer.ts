// R-431: starting a video in an external player. Pure: builds the argument array main hands to the program (never
// through a shell). PotPlayer and mpv are told where to start; any other program just gets the file.
export type ExternalPlayerKind = 'potplayer' | 'mpv' | 'other'

// By the program's file name only (PotPlayerMini64.exe, PotPlayerMini.exe, PotPlayer*.exe, mpv.exe).
export function externalPlayerKind(program: string): ExternalPlayerKind {
  const name = program.split(/[\\/]/).pop() ?? ''
  if (/^potplayer[^\\/]*\.exe$/i.test(name)) return 'potplayer'
  if (/^mpv\.exe$/i.test(name)) return 'mpv'
  return 'other'
}
// A position that can be passed on: finite, not negative, and sane. Anything else means "from the start".
export const validStartTime = (time: unknown): time is number =>
  typeof time === 'number' && Number.isFinite(time) && time > 0 && time < 1e9
const clock = (seconds: number) => {
  const whole = Math.floor(seconds),
    pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(whole / 3600))}:${pad(Math.floor(whole / 60) % 60)}:${pad(whole % 60)}`
}
export function externalPlayerArgs(program: string, file: string, time?: number): string[] {
  const kind = externalPlayerKind(program)
  if (!validStartTime(time) || kind === 'other') return [file]
  // PotPlayer: /seek=HH:MM:SS after the file. mpv: --start=<seconds> before it.
  if (kind === 'potplayer') return [file, `/seek=${clock(time)}`]
  return [`--start=${Math.round(time * 1000) / 1000}`, file]
}
