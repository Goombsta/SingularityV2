export type PlaylistType = 'xtream' | 'm3u' | 'stalker'

export interface Playlist {
  id: string
  name: string
  type: PlaylistType
  url: string
  username?: string
  password?: string
  mac?: string
  expiry?: string
}

export interface Channel {
  id: string
  name: string
  stream_url: string
  logo?: string
  group_title?: string
  epg_channel_id?: string
  playlist_id: string
  stream_id?: number
}

export interface VodItem {
  id: string
  name: string
  stream_url: string
  poster?: string
  backdrop?: string
  plot?: string
  year?: string
  rating?: string
  genre?: string
  duration?: number
  playlist_id: string
  stream_id?: number
  container_extension?: string
}

export interface Series {
  id: string
  name: string
  poster?: string
  backdrop?: string
  plot?: string
  year?: string
  rating?: string
  genre?: string
  playlist_id: string
  series_id?: number
}

export interface Episode {
  id: string
  episode_num: number
  season: number
  title: string
  stream_url: string
  plot?: string
  duration?: number
  poster?: string
  container_extension?: string
}

export interface SeriesInfo {
  series: Series
  seasons: Record<string, Episode[]>
}

export interface EpgProgram {
  channel_id: string
  title: string
  start: string
  stop: string
  description?: string
  icon?: string
  category?: string
}

export interface EpgSource {
  id: string
  url: string
  name: string
}

export interface FavoriteItem {
  id: string
  name: string
  type: 'channel' | 'vod' | 'series'
  poster?: string
  playlist_id: string
  stream_url?: string   // stored for channels so Favorites work across playlists
}

export type MultiviewLayout = '2v' | '2h' | '3' | '4'

export interface PlayerState {
  url: string
  title: string
  live?: boolean      // true = IPTV live stream, false/undefined = VOD file
  channelId?: string
  playlistId?: string
  returnTo?: string   // route to navigate to on back (e.g. '/epg')
  resumeKey?: string  // stable content identity key; undefined for live TV
}

export interface ResumeEntry {
  key: string
  position_sec: number
  duration_sec: number
  title: string
  poster_url: string | null
  stream_url: string
  updated_at: number  // unix seconds
}
