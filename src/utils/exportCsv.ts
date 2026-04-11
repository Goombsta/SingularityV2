import type { VodItem, Series } from '../types'
import { groupByPlaylistCategories } from './genreMap'

export function exportCategoriesToCsv(
  vods: VodItem[],
  series: Series[],
  onProgress?: (pct: number) => void,
): void {
  const rows: string[] = ['Type,Category,Title']

  const vodCats = groupByPlaylistCategories(vods)
  const seriesCats = groupByPlaylistCategories(series)
  const totalItems = vods.length + series.length || 1
  let done = 0

  for (const [cat, items] of vodCats) {
    for (const item of items) {
      rows.push(`Movies,${csvEscape(cat)},${csvEscape(item.name)}`)
      done++
      onProgress?.(Math.round((done / totalItems) * 90))
    }
  }

  for (const [cat, items] of seriesCats) {
    for (const item of items) {
      rows.push(`Series,${csvEscape(cat)},${csvEscape(item.name)}`)
      done++
      onProgress?.(Math.round((done / totalItems) * 90))
    }
  }

  onProgress?.(95)
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `singularity-categories-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
  onProgress?.(100)
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}
