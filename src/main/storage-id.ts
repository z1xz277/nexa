import path from 'node:path'

export function isStorageId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(value)
}

export function storagePath(root: string, directory: string, id: string, extension: string): string {
  if (!isStorageId(id) || !/^[A-Za-z0-9_-]+$/.test(directory) || !/^\.[A-Za-z0-9]+$/.test(extension)) {
    throw new Error('Invalid storage id.')
  }
  return path.join(root, directory, `${id}${extension}`)
}
