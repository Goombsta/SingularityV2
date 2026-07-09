export type HelpSetupType = 'xtream' | 'm3u'

export interface HelpHandoff {
  setupType?: HelpSetupType
  settingsTab?: 'playlists' | 'epg'
  openEpgForm?: boolean
}

export interface GuideStep {
  id: string
  title: string
  body: string
  example?: string
  route?: string
  anchor?: string
  handoff?: HelpHandoff
  waitForPath?: string
}

export interface HelpTopic {
  id: string
  title: string
  description: string
  steps: GuideStep[]
}

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: 'xtream-setup',
    title: 'Add an Xtream playlist',
    description: 'Enter the server, username, and password supplied by your provider.',
    steps: [
      {
        id: 'xtream-form',
        title: 'Enter your Xtream details',
        body: 'Use the separate Server URL, Username, and Password values supplied by your provider. Singularity never fills, reads, or displays these values for you.',
        example: 'Server URL: https://iptv.example.com:8080\nUsername: your_username\nPassword: your_password',
        route: '/settings',
        anchor: 'playlist-setup-form',
        handoff: { setupType: 'xtream', settingsTab: 'playlists' },
      },
      {
        id: 'xtream-connect',
        title: 'Connect when the details are correct',
        body: 'Choose Add/Connect yourself. If your provider gives you a complete playlist URL instead, use the M3U guide rather than placing it in the Xtream server field.',
        anchor: 'playlist-connect',
      },
    ],
  },
  {
    id: 'm3u-setup',
    title: 'Add an M3U playlist',
    description: 'Add the complete M3U or M3U8 URL supplied by your provider.',
    steps: [
      {
        id: 'm3u-form',
        title: 'Paste the complete M3U URL',
        body: 'Use the full URL exactly as supplied. It may end in .m3u/.m3u8 or be a provider URL that creates the playlist for your account.',
        example: 'https://iptv.example.com/get.php?username=your_username&password=your_password&type=m3u_plus',
        route: '/settings',
        anchor: 'playlist-setup-form',
        handoff: { setupType: 'm3u', settingsTab: 'playlists' },
      },
      {
        id: 'm3u-connect',
        title: 'Add the playlist',
        body: 'Give the playlist a recognizable name and choose Add/Connect yourself. The assistant does not submit the form.',
        anchor: 'playlist-connect',
      },
    ],
  },
  {
    id: 'playlist-management',
    title: 'Manage playlists and EPG sources',
    description: 'Add or remove playlists and attach XMLTV EPG sources safely.',
    steps: [
      {
        id: 'remove-playlist',
        title: 'Remove a playlist manually',
        body: 'Open the playlist actions and choose Remove only for the playlist you no longer want. This guide never removes a playlist for you.',
        route: '/settings',
        anchor: 'playlist-remove',
        handoff: { settingsTab: 'playlists' },
      },
      {
        id: 'add-epg',
        title: 'Add an XMLTV EPG source',
        body: 'Give the source a name, then add the XMLTV URL supplied by your provider. EPG data supplies guide listings; it does not replace a playlist.',
        example: 'https://iptv.example.com/epg.xml',
        route: '/settings',
        anchor: 'epg-source-form',
        handoff: { settingsTab: 'epg', openEpgForm: true },
      },
      {
        id: 'remove-epg',
        title: 'Remove an EPG source manually',
        body: 'Use Remove beside an EPG source only when you no longer want its listings. Removing an EPG source does not remove your playlist.',
        anchor: 'epg-remove',
      },
    ],
  },
  {
    id: 'app-navigation',
    title: 'Navigate Singularity',
    description: 'Learn the Home screen, global navigation, and the purpose of each section.',
    steps: [
      {
        id: 'sidebar',
        title: 'Use the sidebar to move around',
        body: 'Home, Search, Live TV, EPG Guide, Multiview, Movies, Series, My List, Settings, and Help stay available from the shared sidebar.',
        route: '/',
        anchor: 'app-sidebar',
      },
      {
        id: 'home',
        title: 'Start from Home',
        body: 'Home groups recently available and featured content. Choose an item to open its details or use the sidebar to move to a dedicated section.',
        anchor: 'home-navigation',
      },
    ],
  },
  {
    id: 'live-tv',
    title: 'Use Live TV',
    description: 'Browse categories, search channels, favorite channels, and inspect playback statistics.',
    steps: [
      {
        id: 'live-categories',
        title: 'Browse categories or all channels',
        body: 'Choose ALL to search every channel, or select a category first to narrow the channel list.',
        route: '/live',
        anchor: 'live-categories',
      },
      {
        id: 'live-search',
        title: 'Search the current channel view',
        body: 'The channel search respects the selected category. Select ALL before searching when you want to search the full playlist.',
        anchor: 'live-search',
      },
      {
        id: 'live-favorite',
        title: 'Favorite a channel',
        body: 'Use the heart on a channel to add or remove it from your favorites. Favorites are available later in Live TV and My List.',
        anchor: 'live-favorite',
      },
      {
        id: 'live-tech-stats',
        title: 'Inspect Live TV technical stats',
        body: 'Open Tech Stats during playback to see resolution, bitrate, buffer health, and dropped frames. These values help diagnose stream quality issues.',
        anchor: 'live-tech-stats',
      },
    ],
  },
  {
    id: 'movies',
    title: 'Browse and play movies',
    description: 'Search movies, open details, play, and save favorites.',
    steps: [
      {
        id: 'movie-search',
        title: 'Search movies',
        body: 'Use the Movies search field to filter the current movie catalog, then select a result to open its details.',
        route: '/vod',
        anchor: 'movie-search',
      },
      {
        id: 'movie-details',
        title: 'Use movie details',
        body: 'The details view shows the description and available actions. Choose Play to open the fullscreen player, or use the heart to add the movie to My List.',
        anchor: 'movie-details',
      },
    ],
  },
  {
    id: 'series',
    title: 'Browse and play series',
    description: 'Search series, open show details, choose an episode, and save favorites.',
    steps: [
      {
        id: 'series-search',
        title: 'Search series',
        body: 'Use the Series search field to filter the catalog, then select a show to view its details and episodes.',
        route: '/series',
        anchor: 'series-search',
      },
      {
        id: 'series-details',
        title: 'Play an episode or favorite the series',
        body: 'In the details view, choose an episode to play it. Use the heart to add or remove the series from My List.',
        anchor: 'series-details',
      },
    ],
  },
  {
    id: 'multiview',
    title: 'Use Multiview',
    description: 'Choose a layout, select a panel, and assign a channel to it.',
    steps: [
      {
        id: 'multiview-layouts',
        title: 'Choose a layout',
        body: 'Scroll through the layout choices and select the arrangement that fits the number of streams you want to watch.',
        route: '/multiview',
        anchor: 'multiview-layouts',
      },
      {
        id: 'multiview-panel',
        title: 'Select a panel and channel',
        body: 'Choose a panel, then use its channel picker to browse categories or search and assign a channel. Repeat for each panel.',
        anchor: 'multiview-channel-picker',
      },
    ],
  },
  {
    id: 'epg-guide',
    title: 'Explore the EPG Guide',
    description: 'Filter the guide, browse programs, and open a fullscreen stream.',
    steps: [
      {
        id: 'epg-filters',
        title: 'Filter guide channels',
        body: 'Pick a playlist, select ALL or a category, and use search to narrow the channel list before browsing the timeline.',
        route: '/epg',
        anchor: 'epg-filters',
      },
      {
        id: 'epg-grid',
        title: 'Read the timeline and preview programs',
        body: 'Select a program to open its preview. The preview explains the current program and can open the channel in fullscreen.',
        anchor: 'epg-grid',
      },
    ],
  },
  {
    id: 'player-controls',
    title: 'Player language, subtitles, and stats',
    description: 'Open a movie or episode, then learn the fullscreen player controls.',
    steps: [
      {
        id: 'start-player',
        title: 'Open the fullscreen player',
        body: 'Choose a movie or series episode and select Play. The guide will stay open and continue when the fullscreen player opens.',
        route: '/vod',
        anchor: 'movie-details',
      },
      {
        id: 'tracks',
        title: 'Choose language and subtitles',
        body: 'Open Audio & Subtitles to choose an audio language, enable or disable subtitle tracks, and adjust subtitle size when tracks are available.',
        anchor: 'player-tracks',
        waitForPath: '/player',
      },
      {
        id: 'player-tech-stats',
        title: 'Inspect fullscreen player stats',
        body: 'Open Tech Stats to review playback details such as resolution, bitrate, buffer state, and dropped frames.',
        anchor: 'player-tech-stats',
        waitForPath: '/player',
      },
    ],
  },
]

export function getHelpTopic(id: string) {
  return HELP_TOPICS.find((topic) => topic.id === id)
}
