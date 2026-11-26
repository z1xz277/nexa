export function matchesGlob(value: string, pattern: string): boolean {
  if (pattern.length > 256) throw new Error('Glob pattern is too long.')
  if (value.length > 4096) return false
  let patternIndex = 0
  let valueIndex = 0
  let starIndex = -1
  let starMatch = 0
  let starAny = false

  while (valueIndex < value.length) {
    if (patternIndex < pattern.length) {
      const token = pattern[patternIndex]
      if (token === '*') {
        starAny = pattern[patternIndex + 1] === '*'
        while (pattern[patternIndex] === '*') patternIndex++
        starIndex = patternIndex - 1
        starMatch = valueIndex
        continue
      }
      if (token === '?' || token.toLowerCase() === value[valueIndex].toLowerCase()) {
        patternIndex++
        valueIndex++
        continue
      }
    }
    if (starIndex >= 0 && (starAny || value[starMatch] !== '/')) {
      valueIndex = ++starMatch
      patternIndex = starIndex + 1
      continue
    }
    return false
  }

  while (patternIndex < pattern.length && pattern[patternIndex] === '*') patternIndex++
  return patternIndex === pattern.length
}
