import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  albumDiscs,
  albumSummary,
  type AlbumTrack,
  type AudioTags,
  discNumber,
  sameQueue,
  shuffled,
  trackClock,
  trackKey,
} from '../shared/album'

const track = (name: string, folderDisc?: number, rowId = 'r'): AlbumTrack => ({
  key: trackKey(rowId, name),
  rowId,
  fileId: name,
  name,
  folderDisc,
})
const order = (discs: ReturnType<typeof albumDiscs>) =>
  discs.map((disc) => `${disc.disc}:` + disc.tracks.map((t) => t.name).join(','))

test('disc folders are named Disc, Disk or CD with a number (R-390)', () => {
  assert.equal(discNumber('Disc 1'), 1)
  assert.equal(discNumber('CD2'), 2)
  assert.equal(discNumber('disk-03'), 3)
  assert.equal(discNumber('Disc 1 - Live'), 1)
  assert.equal(discNumber('Discography'), undefined)
  assert.equal(discNumber('CD 0'), undefined)
  assert.equal(discNumber('Bonus'), undefined)
  assert.equal(discNumber('CD123'), undefined, 'three digits is not a disc number')
})

test('tracks: disc first, then tag numbers when every track has one, else names', () => {
  const tracks = [track('10 b.mp3'), track('2 a.mp3'), track('1 c.mp3', 2, 'd2')]
  // Before every tag is read only folders and names count, so the list does not jump.
  assert.deepEqual(order(albumDiscs(tracks, {}, false)), ['1:2 a.mp3,10 b.mp3', '2:1 c.mp3'])
  const tags: Record<string, AudioTags> = {
    [tracks[0].key]: { track: 1 },
    [tracks[1].key]: { track: 2 },
    [tracks[2].key]: { track: 1, disc: 2 },
  }
  assert.deepEqual(order(albumDiscs(tracks, tags, true)), ['1:10 b.mp3,2 a.mp3', '2:1 c.mp3'])
  // One track without a number: names decide that disc.
  const partial = { ...tags, [tracks[1].key]: {} }
  assert.deepEqual(order(albumDiscs(tracks, partial, true)), ['1:2 a.mp3,10 b.mp3', '2:1 c.mp3'])
  // A disc tag wins over the folder.
  const moved = { ...tags, [tracks[2].key]: { track: 3, disc: 1 } }
  assert.deepEqual(order(albumDiscs(tracks, moved, true)), ['1:10 b.mp3,2 a.mp3,1 c.mp3'])
})

test('album header: values most tracks share, total length once every length is known', () => {
  const tracks = [track('a'), track('b'), track('c')]
  const tags: Record<string, AudioTags> = {
    [tracks[0].key]: { album: 'Blue', artist: 'X', year: 2001, duration: 60 },
    [tracks[1].key]: { album: 'blue ', artist: 'X', year: 2001, duration: 30.5 },
    [tracks[2].key]: { album: 'Other', artist: 'Y', duration: 10 },
  }
  const summary = albumSummary(tracks, tags)
  assert.equal(summary.album, 'Blue')
  assert.equal(summary.artist, 'X')
  assert.equal(summary.year, 2001)
  assert.equal(summary.various, false)
  assert.equal(summary.count, 3)
  assert.equal(summary.duration, 100.5)
  // No shared artist: the list names each track's artist.
  const mixed = albumSummary(tracks, {
    [tracks[0].key]: { artist: 'A' },
    [tracks[1].key]: { artist: 'B' },
    [tracks[2].key]: { artist: 'C' },
  })
  assert.equal(mixed.artist, undefined)
  assert.equal(mixed.various, true)
  // The album artist tag wins; a missing length leaves the total unknown.
  const credited = albumSummary(tracks, {
    [tracks[0].key]: { artist: 'A', albumArtist: 'Band', duration: 1 },
    [tracks[1].key]: { artist: 'B', albumArtist: 'Band' },
  })
  assert.equal(credited.artist, 'Band')
  assert.equal(credited.duration, undefined)
  assert.equal(albumSummary([], {}).duration, undefined)
})

test('clock, shuffle and queue comparison', () => {
  assert.equal(trackClock(187), '3:07')
  assert.equal(trackClock(3765), '1:02:45')
  assert.equal(trackClock(undefined), '')
  assert.equal(trackClock(-1), '')
  const list = [1, 2, 3, 4]
  const mixed = shuffled(list, () => 0)
  assert.deepEqual([...mixed].sort(), list, 'every item stays')
  assert.deepEqual(list, [1, 2, 3, 4], 'the original is not changed')
  assert.equal(sameQueue(['a', 'b'], ['a', 'b']), true)
  assert.equal(sameQueue(['a', 'b'], ['b', 'a']), false)
  assert.equal(sameQueue(['a'], ['a', 'b']), false)
})
