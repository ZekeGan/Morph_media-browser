import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  clockText,
  continueTarget,
  placeProgress,
  remembers,
  resumeAt,
  trimPlaces,
  VIDEO_PLACES,
  type VideoPlaces,
  watchState,
  withPlace,
} from '../src/media/videoPlace'

test('videos under five minutes are not remembered (R-405)', () => {
  assert.equal(remembers(299), false)
  assert.equal(remembers(300), true)
  assert.equal(remembers(NaN), false)
  const places: VideoPlaces = {}
  assert.equal(withPlace(places, 'f/a', 100, 299, 1), places)
  assert.equal(withPlace(places, 'f/a', -1, 3000, 1), places)
  assert.deepEqual(withPlace(places, 'f/a', 100, 3000, 7), {
    'f/a': { time: 100, duration: 3000, at: 7 },
  })
})

test('a video is finished with under 5% or under 2 minutes left, and then starts over', () => {
  assert.equal(watchState(undefined), 'new')
  assert.equal(watchState({ time: 3, duration: 3000, at: 1 }), 'new')
  assert.equal(watchState({ time: 1000, duration: 3000, at: 1 }), 'partial')
  // A 2 hour film: 5% is 360 seconds.
  assert.equal(watchState({ time: 7000, duration: 7200, at: 1 }), 'done')
  assert.equal(watchState({ time: 6800, duration: 7200, at: 1 }), 'partial')
  // A 10 minute video: two minutes left is already finished.
  assert.equal(watchState({ time: 481, duration: 600, at: 1 }), 'done')
  assert.equal(watchState({ time: 470, duration: 600, at: 1 }), 'partial')
  assert.equal(resumeAt({ time: 1000, duration: 3000, at: 1 }), 1000)
  assert.equal(resumeAt({ time: 2990, duration: 3000, at: 1 }), 0)
  assert.equal(resumeAt(undefined), 0)
  assert.equal(placeProgress({ time: 750, duration: 3000, at: 1 }), 0.25)
  assert.equal(placeProgress({ time: 2990, duration: 3000, at: 1 }), 1)
  assert.equal(placeProgress({ time: 1, duration: 3000, at: 1 }), undefined)
})

test('the store keeps the most recently watched videos', () => {
  const places: VideoPlaces = Object.fromEntries(
    Array.from({ length: VIDEO_PLACES + 3 }, (_, i) => [
      'f/' + i,
      { time: 10, duration: 600, at: i },
    ])
  )
  const kept = trimPlaces(places)
  assert.equal(Object.keys(kept).length, VIDEO_PLACES)
  assert.equal('f/0' in kept, false)
  assert.equal('f/' + (VIDEO_PLACES + 2) in kept, true)
})

test('"continue watching" is the latest video still in progress', () => {
  const videos = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const places: VideoPlaces = {
    'f/a': { time: 500, duration: 3000, at: 5 },
    'f/b': { time: 2990, duration: 3000, at: 9 },
    'f/c': { time: 600, duration: 3000, at: 7 },
    'g/a': { time: 500, duration: 3000, at: 99 },
  }
  const target = continueTarget(places, 'f', videos)
  assert.equal(target?.video.id, 'c')
  assert.equal(target?.index, 2)
  assert.equal(continueTarget(places, 'none', videos), undefined)
  assert.equal(clockText(65), '1:05')
  assert.equal(clockText(3725), '1:02:05')
})
