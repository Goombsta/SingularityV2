export const FIXED_CATEGORIES = [
  'Trending Now',
  'Action & Adventure',
  'Drama',
  'Comedy',
  'Crime',
  'Sci-Fi & Fantasy',
  'Family & Kids',
  'Reality',
  'Mystery',
  'Documentary',
  'War & Politics',
  'Animation',
  'Anime',
] as const

export type FixedCategory = typeof FIXED_CATEGORIES[number]

/**
 * Normalize a raw genre/group-title string before keyword matching.
 * Strips region codes (|US|, |CA|), language prefixes (EN -, US -),
 * years (2024, 2025), quality markers (HD, 4K, FHD), and decorators.
 *
 * Examples:
 *   "|US| ACTION HD"         → "action"
 *   "EN - Action & Adventure 2026" → "action & adventure"
 *   "US - Romance"           → "romance"
 *   "CA - Drama 2025"        → "drama"
 *   "|4K| Sci-Fi"            → "sci-fi"
 */
function normalizeGenreString(raw: string): string {
  return raw
    .toLowerCase()
    // Strip leading pipe-delimited region codes: |US|, |CA|, |4K|, |PPV| etc (with optional trailing decorators)
    .replace(/^\|?[a-z0-9]{0,6}\|\s*[-◈★\s]*/u, '')
    // Strip language/region prefix: "EN - ", "US - ", "CA - ", "FR -"
    .replace(/^[a-z]{2,3}\s*[-:]\s*/u, '')
    // Strip remaining leading punctuation or decorators
    .replace(/^[◈★\-\s]+/, '')
    // Strip years
    .replace(/\b(19|20)\d{2}\b/g, '')
    // Strip quality markers
    .replace(/\b(hd|fhd|4k|uhd|sd|eng|dubbed|sub|subbed|hevc|avc|x265|x264)\b/gi, '')
    // Strip trailing punctuation and collapse whitespace
    .replace(/[_\-]+$/, '')
    .trim()
    .replace(/\s{2,}/g, ' ')
}

// Evaluated in order — first match wins
const GENRE_RULES: { category: FixedCategory; keywords: string[] }[] = [
  {
    category: 'Anime',
    keywords: ['anime', 'アニメ', 'manga', 'shonen', 'shojo', 'seinen', 'isekai'],
  },
  {
    category: 'Animation',
    keywords: ['animation', 'animated', 'cartoon', 'animat', 'cgi', 'stop motion', 'claymation', 'pixar', 'dreamworks'],
  },
  {
    category: 'Family & Kids',
    keywords: [
      'family', 'famille', 'kids', 'children', 'child', 'junior',
      'baby', 'preschool', 'toddler', 'nursery', 'tween',
    ],
  },
  {
    category: 'Sci-Fi & Fantasy',
    keywords: [
      'sci-fi', 'scifi', 'science fiction', 'fantasy', 'supernatural', 'paranormal',
      'space', 'futur', 'time travel', 'dystopian', 'post-apocalyptic', 'post apocalyptic',
      'alien', 'aliens', 'cyberpunk', 'robots', 'robot', 'steampunk', 'alternate history',
      'mythology', 'mytholog',
    ],
  },
  {
    category: 'Action & Adventure',
    keywords: [
      'action', 'adventure', 'superhero', 'kung fu', 'spy', 'espionage',
      'martial arts', 'swashbuckler', 'survival', 'disaster', 'heist movie',
      'chase', 'bounty',
    ],
  },
  {
    category: 'Crime',
    keywords: [
      'crime', 'gangster', 'noir', 'detective', 'police', 'cop', 'murder',
      'forensic', 'investigation', 'heist', 'mob', 'organized crime', 'true crime',
      'serial killer', 'mafia', 'cartel', 'drug',
    ],
  },
  {
    category: 'Mystery',
    keywords: [
      'mystery', 'horror', 'suspense', 'psychological', 'ghost', 'zombie',
      'slasher', 'occult', 'gothic', 'psychological thriller', 'dark', 'paranoia',
      'whodunit', 'haunted',
    ],
  },
  {
    category: 'Comedy',
    keywords: [
      'comedy', 'sitcom', 'stand-up', 'stand up', 'standup', 'humor', 'humour',
      'comedi', 'comédie', 'satire', 'satir', 'parody', 'skit', 'mockumentary',
      'sketch', 'spoof', 'farce',
    ],
  },
  {
    category: 'Reality',
    keywords: [
      'reality', 'game show', 'gameshow', 'game-show', 'talk show', 'talk-show',
      'dating', 'competition', 'contest', 'survivor', 'unscripted', 'variety',
      'award', 'awards', 'cooking show', 'makeover', 'renovation',
    ],
  },
  {
    category: 'Documentary',
    keywords: [
      'documentary', 'docuseries', 'biography', 'biopic', 'history', 'historical',
      'nature', 'wildlife', 'sport', 'sports', 'travel', 'food', 'cooking',
      'music', 'concert', 'science', 'education', 'investigative', 'true crime doc',
      'short film', 'news', 'journalism', 'current affairs', 'wildlife',
    ],
  },
  {
    category: 'War & Politics',
    keywords: [
      'war', 'military', 'politic', 'army', 'soldier', 'battle', 'vietnam',
      'wwii', 'world war', 'spy', 'propaganda', 'espionage', 'cold war',
      'revolution', 'combat', 'naval',
    ],
  },
  {
    category: 'Drama',
    keywords: [
      'drama', 'romance', 'romantic', 'biographical', 'musical', 'mini-series',
      'miniseries', 'melodrama', 'legal', 'medical', 'hospital', 'period',
      'telenovela', 'soap', 'western', 'anthology', 'prestige', 'limited series',
      'coming of age', 'teen', 'school', 'family drama',
    ],
  },
]

// ── Region / version utilities ────────────────────────────────────────────────

/**
 * Extract a region/language code from an item name.
 * Handles "|US| Title", "EN - Title", "UK - Title", "FR - Title" etc.
 * Returns the code (uppercase) or 'Default' if not found.
 */
export function extractRegion(name: string): string {
  const pipeMatch = name.match(/^\|([A-Z]{2,4})\|/)
  if (pipeMatch) return pipeMatch[1]
  // Match "FR-4k", "EN - ", "ES: " — no space required after separator
  const dashMatch = name.match(/^([A-Z]{2,3})\s*[-:]/)
  if (dashMatch) return dashMatch[1]
  return 'Default'
}

// Known quality/encoding tokens that can appear as a leading or trailing artifact
const QUALITY_TOKEN = /^(4K|HD|FHD|UHD|SD|MULTI|HEVC|AVC|X265|X264|H264|H265|SDR|HDR|REMUX)\s+/i
const QUALITY_TRAILING = /\s+(HD|FHD|4K|UHD|SD|BluRay|WEB-DL|WEBRip|DVDRip|REMUX|HEVC|HDR|SDR)\b.*$/i

/**
 * Strip region prefix, years, and quality markers from a name to get the base title.
 * Examples:
 *   "FR-4k Extraction 2 - 2023"  → "Extraction 2"
 *   "ES - Extraction 2(2023)"    → "Extraction 2"
 *   "EN - Extraction 2"          → "Extraction 2"
 *   "|US| Movie Title 4K"        → "Movie Title"
 */
export function extractBaseTitle(name: string): string {
  return name
    // Strip |US| style pipe prefix
    .replace(/^\|[A-Z0-9]{2,6}\|\s*[-◈★\s]*/u, '')
    // Strip "EN - ", "FR-", "ES: " region prefix (no space required after separator)
    .replace(/^[A-Z]{2,3}\s*[-:]\s*/u, '')
    // Strip any remaining leading quality token: "4k ", "HD ", "FHD " left after region strip
    .replace(QUALITY_TOKEN, '')
    // Strip parenthetical years: (2024), (2024-)
    .replace(/\s*\(\d{4}[-–]?\d*\)/g, '')
    // Strip bracket tags: [4K], [HD], [EN], [MULTI]
    .replace(/\s*\[[^\]]{1,10}\]/g, '')
    // Strip year suffix and everything after: " - 2023", " 2023"
    .replace(/\s*[-–]?\s*(19|20)\d{2}\b.*$/, '')
    // Strip trailing quality (requires leading space — avoids stripping from position 0)
    .replace(QUALITY_TRAILING, '')
    // Strip trailing standalone region code: " EN", " FR", " US"
    .replace(/\s+[A-Z]{2,3}$/, '')
    .trim()
}

export type VersionedItem<T> = T & {
  _region: string
  _versions: Array<T & { _region: string }>
}

/**
 * Group items that share the same base title into a single card with multiple versions.
 * EN version is preferred as the primary. Regions like EN, ES, UK, FR are extracted
 * from name prefixes ("EN - Title", "|US| Title").
 */
export function deduplicateItems<T extends { name: string }>(items: T[]): VersionedItem<T>[] {
  const groups = new Map<string, Array<T & { _region: string }>>()

  for (const item of items) {
    const base = extractBaseTitle(item.name).toLowerCase().trim()
    const key = base || item.name.toLowerCase()
    const region = extractRegion(item.name)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push({ ...item, _region: region })
  }

  const result: VersionedItem<T>[] = []
  for (const versions of groups.values()) {
    // Prefer EN as primary, then Default, then first available
    const primary =
      versions.find((v) => v._region === 'EN') ??
      versions.find((v) => v._region === 'Default') ??
      versions[0]
    result.push({ ...primary, _versions: versions })
  }
  return result
}

// ── Genre / skip utilities ────────────────────────────────────────────────────

// Generic/umbrella terms that carry no genre signal — skip them so item name can be tried
const GENRE_SKIP = new Set([
  'movies', 'movie', 'films', 'film', 'video', 'videos', 'vod',
  'series', 'tv', 'television', 'shows', 'show', 'channel', 'channels',
  'en', 'us', 'ca', 'uk', 'au', 'fr', 'de', 'es', 'pt', 'it',
  'general', 'other', 'misc', 'uncategorized', 'all',
])

/** Map a raw genre string to one of the 14 fixed categories. */
export function mapGenre(raw: string | undefined): FixedCategory | null {
  if (!raw) return null
  const normalized = normalizeGenreString(raw)
  if (!normalized) return null
  // Skip generic umbrella terms — no useful signal
  if (GENRE_SKIP.has(normalized)) return null
  for (const { category, keywords } of GENRE_RULES) {
    if (keywords.some((k) => normalized.includes(k))) return category
  }
  return null
}

/**
 * Group items using the Excel-defined category map (sheet name → titles).
 * Category order follows the Excel sheet order. Items not found in the map
 * are collected in an 'Other' bucket appended at the end (hidden if empty).
 * The trendingRow (already built by the caller) is always prepended first.
 */
export function groupByExcelCategories<T extends { name?: string }>(
  items: T[],
  categoryOrder: string[],
  titleMap: Record<string, string>,
  trendingRow: [string, T[]],
): [string, T[]][] {
  const buckets = new Map<string, T[]>()
  for (const cat of categoryOrder) buckets.set(cat, [])

  const other: T[] = []
  for (const item of items) {
    const raw = item.name ?? ''
    const base = extractBaseTitle(raw) || raw
    // Try exact base-title match, then progressively shorter suffix-stripped keys
    const key = base.toLowerCase().replace(/\s*[-–]\s*(19|20)\d{2}\s*$/, '').replace(/\s*\(\d{4}[-–]?\d*\)\s*$/, '').trim()
    const cat = titleMap[key]
    if (cat && buckets.has(cat)) {
      buckets.get(cat)!.push(item)
    } else {
      other.push(item)
    }
  }

  const rows: [string, T[]][] = [trendingRow]
  for (const cat of categoryOrder) {
    const arr = buckets.get(cat)!
    if (arr.length > 0) rows.push([cat, arr] as [string, T[]])
  }
  if (other.length > 0) rows.push(['Other', other] as [string, T[]])
  return rows
}

/**
 * Group items by the raw category/genre string from the playlist (group-title / category_name).
 * Preserves the provider's category order (insertion order — first seen wins position).
 * Trending Now row is always first.
 */
export function groupByPlaylistCategories<T extends { genre?: string; rating?: string; year?: string }>(
  items: T[]
): [string, T[]][] {
  const trending = [...items]
    .filter((i) => i.rating && parseFloat(i.rating) > 0)
    .sort((a, b) => parseFloat(b.rating || '0') - parseFloat(a.rating || '0'))
    .slice(0, 30)

  // Map preserves insertion order — first occurrence of a category sets its position
  const buckets = new Map<string, T[]>()
  for (const item of items) {
    const cat = item.genre?.trim() || 'Other'
    if (!buckets.has(cat)) buckets.set(cat, [])
    buckets.get(cat)!.push(item)
  }

  return [['Trending Now', trending], ...[...buckets.entries()]]
    .filter(([, arr]) => arr.length > 0)
}

/**
 * Group items into the 14 fixed categories.
 * "Trending Now" = top-rated items (by rating desc, top 30).
 * Items that don't match any keyword → Drama (catch-all).
 * Categories with 0 items are hidden.
 */
export function groupByFixedCategories<T extends { genre?: string; name?: string; rating?: string; year?: string }>(
  items: T[]
): [FixedCategory, T[]][] {
  // Newest-first within each category
  const sorted = [...items].sort((a, b) => parseInt(b.year || '0') - parseInt(a.year || '0'))

  // Trending = top 30 by rating desc
  const trending = [...items]
    .filter((i) => i.rating && parseFloat(i.rating) > 0)
    .sort((a, b) => parseFloat(b.rating || '0') - parseFloat(a.rating || '0'))
    .slice(0, 30)

  const buckets = new Map<FixedCategory, T[]>()
  FIXED_CATEGORIES.forEach((c) => buckets.set(c, []))
  buckets.set('Trending Now', trending)

  const animeKeywords = GENRE_RULES[0].keywords // Anime is always first rule

  sorted.forEach((item) => {
    // Anime is sticky: if anime keywords appear in EITHER genre or name, always → Anime
    const genreNorm = normalizeGenreString(item.genre ?? '')
    const nameNorm = normalizeGenreString(item.name ?? '')
    const isAnime = animeKeywords.some((k) => genreNorm.includes(k) || nameNorm.includes(k))

    const cat = isAnime
      ? 'Anime'
      : (mapGenre(item.genre) ?? mapGenre(item.name) ?? 'Drama')

    if (cat !== 'Trending Now') {
      buckets.get(cat)!.push(item)
    }
  })

  return FIXED_CATEGORIES
    .map((cat) => [cat, buckets.get(cat)!] as [FixedCategory, T[]])
    .filter(([, items]) => items.length > 0)
}
