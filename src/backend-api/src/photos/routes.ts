// Fotos: the routes of the photo viewer. For the display (no login, like the NAS music - only inside the folders the
// parents chose) the albums, one album's pictures and the pictures themselves; for the parents' app the chosen
// folders and a look into a folder before it is chosen. The albums are kept in memory and in cache/photo-albums.json,
// so the tab is there right after a start while the NAS still wakes its disks (marked stale then).

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Express, Response, Router } from 'express'
import { requireCsrf, requireSession } from '../eltern/middleware'
import type { MupiboxConfig } from '../models/mupibox-config.model'
import {
  albumPath,
  derivePhotoAlbums,
  isPhotoFile,
  lastSegment,
  MAX_PHOTO_ROOTS,
  MAX_PHOTOS_PER_ALBUM,
  normalizePath,
  type PhotoAlbum,
  type PhotoRoot,
  pathParts,
  photoPathAllowed,
  photoRootsOf,
  photosOf,
  subfoldersOf,
} from './albums'
import { limitFetches, type PhotoImageDeps, type PhotoSize, photoImage, type ThumbnailFn, warmPhotos } from './images'
import { type PhotoSource, PhotoSourceOffline } from './source'

export interface PhotoDeps {
  source: PhotoSource
  roots: () => PhotoRoot[]
  thumbnail: ThumbnailFn
  sendThumbnail: (res: Response, file: string, cache?: 'no-cache' | 'immutable') => Promise<void>
  uiScale: () => number
  /** the folder of the server's caches (cache/ below its working directory) */
  cacheDir: string
}

export interface PhotoRoutes {
  /** the chosen folders changed: the kept albums are dropped */
  albumsChanged: () => void
}

interface AlbumMemo {
  rootsKey: string
  albums: PhotoAlbum[]
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

export function imageUrl(filePath: string, size: PhotoSize, version?: string): string {
  const v = version ? `&v=${encodeURIComponent(version)}` : ''
  return `/api/photos/image?path=${encodeURIComponent(filePath)}&size=${size}${v}`
}

function albumJson(album: PhotoAlbum) {
  return { ...album, cover: album.cover ? imageUrl(album.cover.path, 'thumb', album.cover.version) : null }
}

function offline(res: Response, body?: object): void {
  res.setHeader('Retry-After', '15')
  res.setHeader('Cache-Control', 'no-store')
  if (body) res.status(503).json(body)
  else res.status(503).end()
}

export function registerPhotoRoutes(app: Express, deps: PhotoDeps): PhotoRoutes {
  const imageDeps: PhotoImageDeps = {
    source: limitFetches(deps.source),
    thumbnail: deps.thumbnail,
    uiScale: deps.uiScale,
  }
  const memoFile = path.join(deps.cacheDir, 'photo-albums.json')
  let memo: AlbumMemo | undefined
  let inflight: Promise<PhotoAlbum[]> | undefined
  let saveTimer: NodeJS.Timeout | undefined
  const rootsKey = (roots: PhotoRoot[]) => JSON.stringify(roots)

  void readFile(memoFile, 'utf8')
    .then((text) => {
      const kept = JSON.parse(text) as AlbumMemo
      if (!memo && kept && typeof kept.rootsKey === 'string' && Array.isArray(kept.albums)) memo = kept
    })
    .catch(() => undefined)

  // written at most once a minute (SD card), atomically - as the NAS folder index of server.ts
  const saveSoon = () => {
    if (saveTimer) return
    saveTimer = setTimeout(() => {
      saveTimer = undefined
      void (async () => {
        try {
          await mkdir(deps.cacheDir, { recursive: true })
          const tmp = `${memoFile}.tmp`
          await writeFile(tmp, JSON.stringify(memo ?? { rootsKey: '', albums: [] }))
          await rename(tmp, memoFile)
        } catch (error) {
          console.warn(`${new Date().toLocaleString()}: [MuPiBox-Server] saving the photo albums failed: ${error}`)
        }
      })()
    }, 60 * 1000)
    saveTimer.unref()
  }

  // the albums now; while the source is away the ones kept from before (stale), if the chosen folders are the same
  async function loadAlbums(): Promise<{ albums: PhotoAlbum[]; stale: boolean }> {
    const roots = deps.roots()
    if (!roots.length) return { albums: [], stale: false }
    const key = rootsKey(roots)
    if (!inflight) {
      // (requests at the same time - the display and the app - share one walk over the folders)
      inflight = derivePhotoAlbums(roots, (folder) => deps.source.list(folder)).finally(() => {
        inflight = undefined
      })
    }
    try {
      const albums = await inflight
      memo = { rootsKey: key, albums }
      saveSoon()
      return { albums, stale: false }
    } catch (error) {
      if (error instanceof PhotoSourceOffline && memo?.rootsKey === key) return { albums: memo.albums, stale: true }
      throw error
    }
  }

  // the pictures after this one, from the (kept) listing of its folder
  async function following(filePath: string, n: number): Promise<{ path: string; version?: string }[]> {
    try {
      const photos = photosOf(await deps.source.list(path.posix.dirname(filePath)))
      const at = photos.findIndex((p) => p.path === filePath)
      return at < 0 ? [] : photos.slice(at + 1, at + 1 + n)
    } catch {
      return []
    }
  }

  /** GET /api/photos/albums - {albums: [{id, name, root, path, count, cover, modified}], stale}; 503 while the NAS is away */
  app.get('/api/photos/albums', async (_req, res) => {
    try {
      const { albums, stale } = await loadAlbums()
      res.setHeader('Cache-Control', 'no-store')
      res.json({ albums: albums.map(albumJson), stale })
    } catch (error) {
      if (error instanceof PhotoSourceOffline) {
        offline(res, { albums: [], error: 'offline' })
        return
      }
      throw error
    }
  })

  /** GET /api/photos/album?id= - {id, name, path, count, truncated, photos: [{name, path, version, src}]} */
  app.get('/api/photos/album', async (req, res) => {
    const id = str(req.query.id)
    const folder = albumPath(id)
    if (!folder) {
      res.status(400).json({ error: 'invalid id' })
      return
    }
    const root = photoPathAllowed(deps.roots(), folder)
    // (an album is a chosen folder or one level below it)
    if (!root || (folder !== root.path && path.posix.dirname(folder) !== root.path)) {
      res.status(403).send('album outside the photo folders')
      return
    }
    try {
      const photos = photosOf(await deps.source.list(folder))
      const shown = photos.slice(0, MAX_PHOTOS_PER_ALBUM)
      res.setHeader('Cache-Control', 'no-store')
      res.json({
        id,
        name: folder === root.path ? root.name : lastSegment(folder),
        path: folder,
        count: photos.length,
        truncated: photos.length > shown.length,
        photos: shown.map((p) => ({
          name: p.name,
          path: p.path,
          version: p.version ?? '',
          src: imageUrl(p.path, 'screen', p.version),
        })),
      })
      // the first pictures are made now, so the first swipes do not wait
      warmPhotos(imageDeps, shown.slice(0, 4), 'screen', true)
    } catch (error) {
      if (error instanceof PhotoSourceOffline) {
        offline(res, { error: 'offline' })
        return
      }
      throw error
    }
  })

  /**
   * GET /api/photos/image?path=&size=thumb|screen&v= - the picture as a JPEG in that size. With v (the file's
   * version, from the album) kept by the browser for a year: a changed file has another address.
   */
  app.get('/api/photos/image', async (req, res) => {
    const raw = str(req.query.path)
    const size = req.query.size
    if (size !== 'thumb' && size !== 'screen') {
      res.status(400).send('size must be thumb or screen')
      return
    }
    const root = photoPathAllowed(deps.roots(), raw)
    if (!root || !isPhotoFile(raw)) {
      res.status(403).send('path outside the photo folders')
      return
    }
    const filePath = normalizePath(raw)
    const given = str(req.query.v)
    // (the display drops the request of a picture it swiped past: a download not started yet is skipped then)
    let gone = false
    res.on('close', () => {
      if (!res.writableFinished) gone = true
    })
    try {
      let version: string | undefined = given || undefined
      if (!version) {
        // (the display always sends the version; without one it is read from the folder's listing)
        const entries = await deps.source.list(path.posix.dirname(filePath))
        version = entries.find((e) => e.path === filePath)?.version
      }
      const file = await photoImage(imageDeps, filePath, size, version, () => gone)
      if (!file) {
        // not readable: gone on the NAS, or the NAS went away meanwhile - the cache does not tell the two apart,
        // the listing (kept a minute) throws for the second
        await deps.source.list(path.posix.dirname(filePath))
        res.setHeader('Cache-Control', 'no-store')
        res.status(404).end()
        return
      }
      await deps.sendThumbnail(res, file, given ? 'immutable' : 'no-cache')
      if (size === 'screen') warmPhotos(imageDeps, await following(filePath, 2), 'screen')
    } catch (error) {
      if (error instanceof PhotoSourceOffline) {
        offline(res)
        return
      }
      throw error
    }
  })

  return {
    albumsChanged: () => {
      memo = undefined
      saveSoon()
    },
  }
}

// --- the parents' app ---------------------------------------------------------------------------------------------

export interface PhotoAppDeps {
  source: PhotoSource
  getMupiboxConfig: () => MupiboxConfig | undefined
  // (server.ts updateMupiboxConfig: a mutation returning false skips the write)
  updateMupiboxConfig: (mutate: (cfg: Record<string, unknown>) => undefined | false) => Promise<void>
  /** the NAS login the pictures are read with (the NAS page's): its address and whether it works right now */
  nasState: () => Promise<{ address: string; loggedIn: boolean }>
  albumsChanged: () => void
}

// a look into a folder lists its subfolders too (count and cover of each album): a big one is cut here
const PEEK_MAX_ALBUMS = 60

function cleanRoot(v: unknown): PhotoRoot | undefined {
  return photoRootsOf({ photos: { folders: [v] } })[0]
}

function overlaps(a: string, b: string): boolean {
  return a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
}

export function registerPhotoAppRoutes(router: Router, deps: PhotoAppDeps): void {
  /** GET /api/app/photos/config - {folders: [{path, name}], maxFolders, nasAddress, nasConnected} */
  router.get('/photos/config', requireSession, async (_req, res) => {
    const nas = await deps.nasState()
    res.json({
      folders: photoRootsOf(deps.getMupiboxConfig()),
      maxFolders: MAX_PHOTO_ROOTS,
      nasAddress: nas.address,
      nasConnected: nas.loggedIn,
    })
  })

  /**
   * POST /api/app/photos/folders - a change of the chosen folders, made on the list as the box has it (another phone
   * may have changed it meanwhile):
   *   {add: {path, name?}}  chosen (at the end)   {remove: path}  taken off   {items: [{path, name?}]}  the whole list
   * 400 {error}: invalid_path, exists, nested (inside a chosen folder, or a chosen one lies inside it), too_many
   */
  router.post('/photos/folders', requireSession, requireCsrf, async (req, res) => {
    const body = (req.body as { add?: unknown; remove?: unknown; items?: unknown } | undefined) ?? {}
    const add = body.add !== undefined ? cleanRoot(body.add) : undefined
    const bad =
      (body.add !== undefined && !add) ||
      (body.remove !== undefined && typeof body.remove !== 'string') ||
      (body.items !== undefined && !Array.isArray(body.items))
    if (bad) {
      res.status(400).json({ error: 'invalid_path' })
      return
    }
    let error: string | undefined
    let result: PhotoRoot[] = []
    await deps.updateMupiboxConfig((cfg) => {
      let list = photoRootsOf(cfg)
      if (Array.isArray(body.items)) {
        if (body.items.length > MAX_PHOTO_ROOTS) {
          error = 'too_many'
          return false
        }
        list = photoRootsOf({ photos: { folders: body.items } })
        if (list.some((a) => list.some((b) => a !== b && overlaps(a.path, b.path)))) {
          error = 'nested'
          return false
        }
      }
      if (typeof body.remove === 'string') {
        const gone = normalizePath(body.remove)
        list = list.filter((r) => r.path !== gone)
      }
      if (add) {
        if (list.some((r) => r.path === add.path)) {
          error = 'exists'
          return false
        }
        if (list.some((r) => overlaps(r.path, add.path))) {
          error = 'nested'
          return false
        }
        if (list.length >= MAX_PHOTO_ROOTS) {
          error = 'too_many'
          return false
        }
        list = [...list, add]
      }
      result = list
      cfg.photos = { ...((cfg.photos as Record<string, unknown> | undefined) ?? {}), folders: list }
    })
    if (error) {
      res.status(400).json({ error })
      return
    }
    deps.albumsChanged()
    res.json({ folders: result })
  })

  /**
   * GET /api/app/photos/peek?path= - what a folder would become: {path, name, subfolders, images, skipped,
   * albums: [{name, path, count}]}; 401 not_logged_in, 502 nas_unreachable (as /api/nas/browse)
   */
  router.get('/photos/peek', requireSession, async (req, res) => {
    const parts = pathParts(str(req.query.path))
    if (!parts?.length) {
      res.status(400).json({ error: 'invalid_path' })
      return
    }
    const root: PhotoRoot = { path: `/${parts.join('/')}`, name: parts[parts.length - 1] }
    try {
      const entries = await deps.source.list(root.path)
      const subfolders = subfoldersOf(entries).length
      const albums = await derivePhotoAlbums([root], (folder) => deps.source.list(folder), PEEK_MAX_ALBUMS)
      res.json({
        path: root.path,
        name: root.name,
        subfolders,
        images: photosOf(entries).length,
        skipped: Math.max(0, subfolders - PEEK_MAX_ALBUMS),
        albums: albums.map((a) => ({ name: a.name, path: a.path, count: a.count })),
      })
    } catch (error) {
      if (error instanceof PhotoSourceOffline) {
        if (error.reason === 'no_session') res.status(401).json({ error: 'not_logged_in' })
        else res.status(502).json({ error: 'nas_unreachable' })
        return
      }
      throw error
    }
  })
}
