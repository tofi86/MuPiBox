// Fotos: the albums of the photo viewer, from the folders the parents chose (photos.folders in mupiboxconfig.json).
// Pure: the listing comes in as a function, so this runs against the WebDAV NAS today, an SMB share later and a Map
// in the tests. One level, as parents sort by hand ("Familie 2026/Zoo"): every subfolder of a chosen folder is an
// album named after it, pictures lying in the chosen folder itself are one album named after that folder.

import type { PhotoEntry } from './source'

export const PHOTO_EXTENSIONS = ['.jpg', '.jpeg', '.jfif', '.png', '.webp', '.heic', '.heif']
export const MAX_PHOTO_ROOTS = 20
// a chosen folder with hundreds of subfolders (a whole year by day) is not an error, but the display gets the
// newest 200 of them
export const MAX_ALBUMS_PER_ROOT = 200
export const MAX_PHOTOS_PER_ALBUM = 2000
// listings in flight at once (one PROPFIND per album): a NAS over a slow link choked on a burst of them
export const LIST_CONCURRENCY = 4
const MAX_ROOT_NAME = 60

/** A folder the parents chose ("root"): its subfolders are albums. */
export interface PhotoRoot {
  path: string
  /** the name on the display for the pictures lying directly in it (the folder's name unless the parents set one) */
  name: string
}

export interface PhotoAlbum {
  id: string
  name: string
  /** the chosen folder this album belongs to */
  root: string
  path: string
  count: number
  cover: { path: string; version?: string } | null
  /** when the folder changed last (ISO), null when the source does not say */
  modified: string | null
}

export type ListFolder = (folder: string) => Promise<PhotoEntry[]>

export function pathParts(p: string): string[] | undefined {
  const parts = p.split('/').filter(Boolean)
  return parts.some((part) => part === '..' || part === '.') ? undefined : parts
}

export function normalizePath(p: string): string {
  return `/${(pathParts(p) ?? []).join('/')}`
}

export function lastSegment(p: string): string {
  const parts = pathParts(p)
  return parts?.length ? parts[parts.length - 1] : ''
}

/** The chosen folders, well-formed and each once (a config without the section, or with junk in it: none). */
export function photoRootsOf(cfg: unknown): PhotoRoot[] {
  const list = (cfg as { photos?: { folders?: unknown } } | undefined)?.photos?.folders
  const out: PhotoRoot[] = []
  for (const v of Array.isArray(list) ? list : []) {
    const f = v as { path?: unknown; name?: unknown } | null
    if (!f || typeof f !== 'object' || typeof f.path !== 'string') continue
    const parts = pathParts(f.path)
    // (the NAS itself is no photo folder)
    if (!parts || parts.length === 0) continue
    const path = `/${parts.join('/')}`
    if (out.some((o) => o.path === path)) continue
    const own = typeof f.name === 'string' ? f.name.trim().slice(0, MAX_ROOT_NAME) : ''
    out.push({ path, name: own || parts[parts.length - 1] })
    if (out.length >= MAX_PHOTO_ROOTS) break
  }
  return out
}

export function isPhotoFile(name: string): boolean {
  const lower = name.toLowerCase()
  return PHOTO_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

/** Hidden files ("._IMG_0001.jpg" of macOS, ".DS_Store"), DSM's "@eaDir" thumbnails, recycle bin and snapshots */
export function isSystemEntry(name: string): boolean {
  return name.startsWith('.') || name.startsWith('@') || name === '#recycle' || name === '#snapshot'
}

// the id of an album names its source, so an SMB share can have "smb:" ids next to these one day
const ID_PREFIX = 'nas:'

export function albumId(path: string): string {
  return `${ID_PREFIX}${normalizePath(path)}`
}

export function albumPath(id: string): string | undefined {
  if (typeof id !== 'string' || !id.startsWith(ID_PREFIX)) return undefined
  const parts = pathParts(id.slice(ID_PREFIX.length))
  return parts?.length ? `/${parts.join('/')}` : undefined
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** In the order they were taken: phones name their pictures by time (IMG_0001, 20260801_101512) */
export function sortPhotos<T extends { name: string }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => collator.compare(a.name, b.name))
}

export function photosOf(entries: PhotoEntry[]): PhotoEntry[] {
  return sortPhotos(entries.filter((e) => !e.isdir && !isSystemEntry(e.name) && isPhotoFile(e.name)))
}

export function subfoldersOf(entries: PhotoEntry[]): PhotoEntry[] {
  return entries.filter((e) => e.isdir && !isSystemEntry(e.name))
}

/** Newest first: by the folder's date, albums without one after those with one, then by name backwards (years) */
export function sortAlbums(albums: PhotoAlbum[]): PhotoAlbum[] {
  return [...albums].sort((a, b) => {
    if (a.modified && b.modified && a.modified !== b.modified) return a.modified < b.modified ? 1 : -1
    if (Boolean(a.modified) !== Boolean(b.modified)) return a.modified ? -1 : 1
    return collator.compare(b.name, a.name)
  })
}

/** Runs fn over items with at most `limit` calls in flight at once (server.ts mapWithConcurrency). */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    for (let i = next++; i < items.length; i = next++) {
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

function isoDate(value: string | undefined): string | null {
  const ms = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

function newest(entries: PhotoEntry[]): string | null {
  let best: string | null = null
  for (const e of entries) {
    const iso = isoDate(e.modified)
    if (iso && (!best || iso > best)) best = iso
  }
  return best
}

function coverOf(photos: PhotoEntry[]): PhotoAlbum['cover'] {
  return photos.length ? { path: photos[0].path, version: photos[0].version } : null
}

/**
 * The albums of the chosen folders: one listing per folder and one per subfolder (count and cover), a subfolder
 * without pictures is no album. A source that is away throws PhotoSourceOffline through here.
 */
export async function derivePhotoAlbums(
  roots: PhotoRoot[],
  list: ListFolder,
  maxAlbumsPerRoot = MAX_ALBUMS_PER_ROOT,
): Promise<PhotoAlbum[]> {
  const perRoot = await mapLimit(roots, 2, async (root) => {
    const entries = await list(root.path)
    const albums: PhotoAlbum[] = []
    const loose = photosOf(entries)
    if (loose.length) {
      albums.push({
        id: albumId(root.path),
        name: root.name,
        root: root.path,
        path: root.path,
        count: loose.length,
        cover: coverOf(loose),
        modified: newest(loose),
      })
    }
    // (the newest names first when there are more than the display shows: "2026-09 ..." before "2019-03 ...")
    const subs = subfoldersOf(entries)
      .sort((a, b) => collator.compare(b.name, a.name))
      .slice(0, maxAlbumsPerRoot)
    const subAlbums = await mapLimit(subs, LIST_CONCURRENCY, async (sub) => {
      const photos = photosOf(await list(sub.path))
      if (!photos.length) return undefined
      return {
        id: albumId(sub.path),
        name: sub.name,
        root: root.path,
        path: sub.path,
        count: photos.length,
        cover: coverOf(photos),
        modified: isoDate(sub.modified) ?? newest(photos),
      } satisfies PhotoAlbum
    })
    for (const album of subAlbums) if (album) albums.push(album)
    return albums
  })
  return sortAlbums(perRoot.flat())
}

/**
 * The chosen folder a path belongs to, or undefined: the display gets only what the parents chose, and only the
 * one level below it (the album) and the pictures in there - the NAS login reads more than photos.
 */
export function photoPathAllowed(roots: PhotoRoot[], raw: string): PhotoRoot | undefined {
  const parts = pathParts(raw)
  if (!parts) return undefined
  const wanted = `/${parts.join('/')}`
  for (const root of roots) {
    if (wanted === root.path) return root
    if (wanted.startsWith(`${root.path}/`)) {
      const below = wanted.slice(root.path.length + 1).split('/').length
      return below <= 2 ? root : undefined
    }
  }
  return undefined
}
