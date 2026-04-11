import type { VodItem, Series } from '../types'
import { groupByPlaylistCategories } from './genreMap'

export function exportCategoriesToCsv(vods: VodItem[], series: Series[]): void {
  const rows: string[] = ['Type,Category,Title']

  for (const [cat, items] of groupByPlaylistCategories(vods)) {
    for (const item of items) {
      rows.push(`Movies,${csvEscape(cat)},${csvEscape(item.name)}`)
    }
  }

  for (const [cat, items] of groupByPlaylistCategories(series)) {
    for (const item of items) {
      rows.push(`Series,${csvEscape(cat)},${csvEscape(item.name)}`)
    }
  }

  const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `singularity-categories-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}
