import { describe, expect, it } from 'vitest'
import { HELP_TOPICS, getHelpTopic } from './helpContent'

describe('Help Center curriculum', () => {
  it('covers every requested setup and navigation topic', () => {
    expect(HELP_TOPICS.map((topic) => topic.id)).toEqual(expect.arrayContaining([
      'xtream-setup',
      'm3u-setup',
      'playlist-management',
      'app-navigation',
      'live-tv',
      'movies',
      'series',
      'multiview',
      'epg-guide',
      'player-controls',
    ]))
  })

  it('uses only generic provider examples and never carries user credentials', () => {
    const examples = HELP_TOPICS.flatMap((topic) => topic.steps.map((step) => step.example).filter(Boolean))
    expect(examples.join('\n')).toContain('iptv.example.com')
    expect(examples.join('\n')).toContain('your_username')
    expect(examples.join('\n')).toContain('your_password')
    expect(JSON.stringify(HELP_TOPICS)).not.toMatch(/api[_-]?key|bearer|token/i)
  })

  it('keeps removal guides explanatory and does not model destructive actions', () => {
    const management = getHelpTopic('playlist-management')
    expect(management?.steps.map((step) => step.id)).toEqual(['remove-playlist', 'add-epg', 'remove-epg'])
    expect(JSON.stringify(management)).toMatch(/never removes a playlist/i)
    expect(JSON.stringify(management)).not.toMatch(/removePlaylist\(|removeSource\(/)
  })
})
