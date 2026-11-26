export function displayContextLabel(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return 'Tool-capable model'
  if (value >= 1000000) return `${(value / 1000000).toFixed(value % 1000000 === 0 ? 0 : 1)}M context`
  return `${Math.round(value / 1000)}k context`
}

export function displayModelLabel(value: string): string {
  const label = value
    .replace(/[—–]/g, '-')
    .replace(/\s*:?\s*\bfree\b/gi, '')
    .replace(/\(\s*\)|\[\s*\]/g, '')
    .replace(/\s*[:,;-]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
  return label || 'Model'
}
