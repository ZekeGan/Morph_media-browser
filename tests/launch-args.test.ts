import assert from 'node:assert/strict'
import { test } from 'node:test'

import { formatLaunchArgs, parseLaunchArgs } from '../shared/launchArgs'

test('Steam-style launch arguments handle Windows paths, quotes, round-trips and legacy JSON', () => {
  assert.deepEqual(parseLaunchArgs(''), [])
  assert.deepEqual(parseLaunchArgs('   '), [])
  assert.deepEqual(parseLaunchArgs('-run D:\\game.exe'), ['-run', 'D:\\game.exe'])
  assert.deepEqual(parseLaunchArgs('--fullscreen "含 空白 的值" "D:\\Games\\My Game\\\\"'), [
    '--fullscreen',
    '含 空白 的值',
    'D:\\Games\\My Game\\',
  ])
  assert.deepEqual(parseLaunchArgs('"\\"quoted\\"" $(literal) ; keep'), [
    '"quoted"',
    '$(literal)',
    ';',
    'keep',
  ])
  // Apostrophes in Windows paths or titles stay literal.
  assert.deepEqual(parseLaunchArgs("D:\\Ren'Py\\game.exe"), ["D:\\Ren'Py\\game.exe"])
  // Unclosed quote is rejected.
  assert.equal(parseLaunchArgs('--title "unterminated'), undefined)
  assert.equal(parseLaunchArgs('["unterminated'), undefined)
  // Legacy JSON string arrays still parse cleanly.
  assert.deepEqual(parseLaunchArgs('[]'), [])
  assert.deepEqual(parseLaunchArgs('["-run","D:\\\\Media\\\\game.exe"]'), [
    '-run',
    'D:\\Media\\game.exe',
  ])
  assert.deepEqual(parseLaunchArgs('["-run","D:\\Media\\gal\\遊戲\\game.exe"]'), [
    '-run',
    'D:\\Media\\gal\\遊戲\\game.exe',
  ])
  assert.deepEqual(parseLaunchArgs('["D:\\new\\test.exe"]'), ['D:\\new\\test.exe'])
  // Format + parse round-trips cleanly.
  const samples: string[][] = [
    [],
    ['[]'],
    ['--fullscreen', '-w', '1920'],
    ['with spaces', '"quoted"', '$(literal)', 'D:\\Games\\My Game\\', ''],
  ]
  for (const sample of samples) {
    assert.deepEqual(parseLaunchArgs(formatLaunchArgs(sample)), sample)
  }
})
