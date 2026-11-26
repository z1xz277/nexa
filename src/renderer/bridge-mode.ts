export function isBrowserPreview(location: {
  dev: boolean
  hostname: string
  port: string
}): boolean {
  return location.dev &&
    (location.hostname === 'localhost' || location.hostname === '127.0.0.1') &&
    location.port === '5173'
}
