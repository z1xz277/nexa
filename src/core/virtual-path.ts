export function resolveVirtualPath(rel: string): { abs: string; inside: boolean } {
  const normalized = rel.replace(/\\/g, '/')
  const absolute = normalized.startsWith('/') || /^[a-z]:\//i.test(normalized)
  const parts: string[] = []
  let inside = !absolute && !normalized.includes('\0')
  for (const part of normalized.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) {
        inside = false
        break
      }
      parts.pop()
    } else {
      parts.push(part)
    }
  }
  const abs = `/${parts.join('/')}`
  return { abs, inside }
}
