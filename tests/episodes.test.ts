import { test } from 'node:test'
import assert from 'node:assert/strict'
import { episodeLabel, matchEpisodes, parseEpisodeList, parseEpisodeName } from '../shared/episodes'

const ep = (name: string) => parseEpisodeName(name)

test('episode lists parse the TMDB lines and ignore the rest', () => {
  assert.deepEqual(
    parseEpisodeList(['S01E01 Pilot', 'S01E02', 's02e10 The  End ', 'nonsense', 3, 'S01E01 Again']),
    [
      { season: 1, episode: 1, title: 'Pilot' },
      { season: 1, episode: 2 },
      { season: 2, episode: 10, title: 'The  End' },
    ]
  )
  assert.deepEqual(parseEpisodeList('S01E01 x'), [])
  assert.deepEqual(parseEpisodeList(undefined), [])
})

test('labels show season, episode and title', () => {
  assert.equal(episodeLabel({ season: 1, episode: 2, title: 'Title' }), 'S01E02 · Title')
  assert.equal(episodeLabel({ episode: 12 }), 'E12')
})

test('season and episode markers in file names', () => {
  assert.deepEqual(ep('Show.S01E02.1080p.WEB-DL.x264.mkv'), { season: 1, episode: 2 })
  assert.deepEqual(ep('show s1e2.mp4'), { season: 1, episode: 2 })
  assert.deepEqual(ep('Show S02.E10 [720p].mkv'), { season: 2, episode: 10 })
  assert.deepEqual(ep('Show - S03E104 - Title.mkv'), { season: 3, episode: 104 })
})

test('Chinese and Japanese episode markers', () => {
  assert.deepEqual(ep('作品 第02話.mp4'), { season: undefined, episode: 2 })
  assert.deepEqual(ep('作品 第2集.mp4'), { season: undefined, episode: 2 })
  assert.deepEqual(ep('作品 第 2 话 标题.mkv'), { season: undefined, episode: 2 })
  assert.deepEqual(ep('作品 第二話.mkv'), { season: undefined, episode: 2 })
  assert.deepEqual(ep('作品 第十二話.mkv'), { season: undefined, episode: 12 })
  assert.deepEqual(ep('作品 第２期 第０３話.mkv'), { season: undefined, episode: 3 })
  assert.deepEqual(ep('作品 第2季 第05集.mkv'), { season: 2, episode: 5 })
  assert.deepEqual(ep('作品 05話.mkv'), { season: undefined, episode: 5 })
})

test('fansub patterns', () => {
  assert.deepEqual(ep('[Group] Title - 05 [1080p][ABCD1234].mkv'), {
    season: undefined,
    episode: 5,
  })
  assert.deepEqual(ep('[Group] Title - 05v2 (BD 1920x1080 x264 FLAC).mkv'), {
    season: undefined,
    episode: 5,
  })
  assert.deepEqual(ep('[Group][Title][12][1080P][CHS].mp4'), { season: undefined, episode: 12 })
  assert.deepEqual(ep('【Group】Title【07】[1080p].mp4'), { season: undefined, episode: 7 })
  assert.deepEqual(ep('[Group] Title EP02 [720p].mkv'), { season: undefined, episode: 2 })
  assert.deepEqual(ep('Title E02.mkv'), { season: undefined, episode: 2 })
  assert.deepEqual(ep('Title Episode 3.mkv'), { season: undefined, episode: 3 })
  assert.deepEqual(ep('Title 1x02.mkv'), { season: undefined, episode: 2 })
  assert.deepEqual(ep('Title Season 2 - 04.mkv'), { season: 2, episode: 4 })
  assert.deepEqual(ep('Title S2 - 04 [1080p].mkv'), { season: 2, episode: 4 })
  assert.deepEqual(ep('02.mkv'), { season: undefined, episode: 2 })
  assert.deepEqual(ep('02 - Title.mkv'), { season: undefined, episode: 2 })
})

test('resolutions, codecs, years and hashes are not episodes', () => {
  for (const name of [
    'Movie 1080p.mkv',
    'Movie.720p.x264.mkv',
    'Movie [1080].mkv',
    'Movie - 2019.mkv',
    'Movie (2019) [BD].mkv',
    'Movie [ABCD1234].mkv',
    'Movie [12345678].mkv',
    'Movie H.264 AAC 5.1.mkv',
    'Movie 1920x1080.mkv',
    'Movie E-AC3 2.0.mkv',
    '2001 A Space Odyssey.mkv',
    'First.mp4',
    'Laputa Castle in the Sky [BD x264 720p AAC Sub(Chs,Cht,Jap,Eng,Fre,Kor,Fin,Rom,Cze)].mkv',
  ])
    assert.equal(ep(name), undefined, name)
})

test('names that say two things are ambiguous', () => {
  assert.equal(ep('Show S01E01E02.mkv'), undefined)
  assert.equal(ep('Show S01E01-E03.mkv'), undefined)
  assert.equal(ep('Show S01E01 S01E02.mkv'), undefined)
  assert.equal(ep('Show Season 1 Season 2 - 03.mkv'), undefined)
  assert.equal(ep('Show [01][02].mkv'), undefined)
})

const list = parseEpisodeList(['S01E01 A', 'S01E02 B', 'S01E03 C'])
const files = (...names: string[]) => names.map((name, i) => ({ id: 'f' + i, name }))

test('files are matched to the list; a single-season list needs no season in the name', () => {
  const result = matchEpisodes(files('[G] T - 02 [1080p].mkv', 'T S01E03.mkv', '第01話.mp4'), list)
  assert.deepEqual(
    result.matches.map((m) => [m.id, m.season, m.episode, m.title]),
    [
      ['f0', 1, 2, 'B'],
      ['f1', 1, 3, 'C'],
      ['f2', 1, 1, 'A'],
    ]
  )
  assert.deepEqual(result.skipped, [])
})

test('unmatched files say why and nothing is guessed', () => {
  const result = matchEpisodes(
    files('Extras.mkv', 'T - 09.mkv', 'T S02E01.mkv', 'T - 01.mkv', 'T [01].mkv'),
    list
  )
  assert.deepEqual(
    result.skipped.map((s) => [s.id, s.reason]),
    [
      ['f0', 'none'],
      ['f1', 'missing'],
      ['f2', 'missing'],
      ['f3', 'duplicate'],
      ['f4', 'duplicate'],
    ]
  )
  assert.deepEqual(result.matches, [])
})

test('with several seasons a name without a season is not matched', () => {
  const two = parseEpisodeList(['S01E01 A', 'S01E02 B', 'S02E01 C'])
  const result = matchEpisodes(files('T - 01.mkv', 'T S02E01.mkv', 'T Season 1 - 02.mkv'), two)
  assert.deepEqual(
    result.matches.map((m) => [m.id, m.season, m.episode]),
    [
      ['f1', 2, 1],
      ['f2', 1, 2],
    ]
  )
  assert.deepEqual(result.skipped, [{ id: 'f0', name: 'T - 01.mkv', reason: 'season' }])
})

test('an empty list matches nothing', () => {
  assert.deepEqual(matchEpisodes(files('T S01E01.mkv'), []).matches, [])
})
