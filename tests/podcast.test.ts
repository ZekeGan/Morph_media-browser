import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  listenState,
  trimStore,
  PODCAST_EPISODES,
  PODCAST_FOLDERS,
  type PodcastStore,
} from '../src/media/podcast'

test('an episode is new, started after five seconds, finished with under a minute left (R-390)', () => {
  assert.equal(listenState(undefined), 'new')
  assert.equal(listenState({ time: 3, duration: 1800, at: 1 }), 'new')
  assert.equal(listenState({ time: 600, duration: 1800, at: 1 }), 'partial')
  assert.equal(listenState({ time: 1750, duration: 1800, at: 1 }), 'done')
  assert.equal(listenState({ time: 1800, duration: 1800, at: 1 }), 'done')
  // Without a known length it can only be started.
  assert.equal(listenState({ time: 600, duration: 0, at: 1 }), 'partial')
})

test('the podcast store keeps the newest folders and the most recently heard episodes', () => {
  const store: PodcastStore = {
    folders: Array.from({ length: PODCAST_FOLDERS + 3 }, (_, i) => 'f' + i),
    episodes: Object.fromEntries(
      Array.from({ length: PODCAST_EPISODES + 2 }, (_, i) => [
        'e' + i,
        { time: 1, duration: 2, at: i },
      ])
    ),
  }
  const trimmed = trimStore(store)
  assert.equal(trimmed.folders.length, PODCAST_FOLDERS)
  assert.equal(trimmed.folders[0], 'f3', 'the oldest folders go')
  assert.equal(Object.keys(trimmed.episodes).length, PODCAST_EPISODES)
  assert.equal(trimmed.episodes.e0, undefined, 'the least recently heard episodes go')
  assert.ok(trimmed.episodes['e' + (PODCAST_EPISODES + 1)])
})
