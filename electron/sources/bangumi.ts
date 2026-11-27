import { KEY_MAYBE_NSFW } from '../../shared/keys'

import { SourceError } from '../metadata-common'
import { type Adapter, clean } from './site'

export const bangumi: Adapter = async (site) => {
  const id = site.match(/^\/subject\/([1-9]\d{0,11})\/?$/)[1]
  // The optional personal token opens NSFW entries, which answer 404 without it (R-286).
  const data = await site
    .json(
      'https://api.bgm.tv/v0/subjects/' + id,
      undefined,
      site.keys.token ? { headers: { Authorization: 'Bearer ' + site.keys.token } } : {}
    )
    .catch((error) => {
      if (!site.keys.token && error instanceof SourceError && error.kind === 'notFound') {
        throw new Error(KEY_MAYBE_NSFW)
      }
      throw error
    })
  if (String(data.id) !== id) throw new SourceError('notFound')
  site.text('TITLE_ORIGINAL', data.name)
  site.text('DESCRIPTION', data.summary)
  site.text('RELEASE_DATE', data.date)
  site.number('EPISODE_COUNT', data.total_episodes)
  site.list(
    'TAGS',
    data.tags?.map((tag: { name?: unknown }) => tag?.name)
  )
  return {
    // R-381: name_cn is the Chinese title and name the original (Japanese); the first preferred language that has one wins.
    title: clean(
      site.languages
        .map((language) =>
          language.startsWith('zh') ? data.name_cn : language === 'ja' ? data.name : undefined
        )
        .find((value) => typeof value === 'string' && value.trim()) ||
        data.name_cn ||
        data.name
    ),
    canonical: 'https://bgm.tv/subject/' + id,
    image: data.images?.medium,
  }
}
