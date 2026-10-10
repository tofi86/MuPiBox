// Fotos: the pictures as the display needs them - a small one for the album tile and one that fills the screen -
// made once from the original (3-12 MB from a phone) with the thumbnail cache of server.ts and kept on the SD.

import type { PhotoSource } from './source'

// the tile grows with a larger display (ui-scale.ts, like the covers); the screen picture stays 1600 px on its long
// side: sharp at 2x zoom on 800 px, a 12 MP phone picture becomes ~300 KB, a Pi 3 decodes it in a fraction of a second
export const PHOTO_SIZES = { thumb: 400, screen: 1600 } as const
export type PhotoSize = keyof typeof PHOTO_SIZES

/** server.ts getThumbnail */
export type ThumbnailFn = (
  src: string,
  size: number,
  seed: string,
  fetchSource?: () => Promise<string | undefined>,
) => Promise<string | undefined>

export interface PhotoImageDeps {
  source: PhotoSource
  thumbnail: ThumbnailFn
  uiScale: () => number
}

/**
 * The source with its downloads two at a time, in the order they were asked for: the display asks for the picture on
 * the screen first and for the ones after it later, and over a slow line (photos in a cloud) eight downloads at once
 * made the first one wait for all of them. Listings are not held back.
 */
export function limitFetches(source: PhotoSource, limit = 2): PhotoSource {
  let running = 0
  const waiting: (() => void)[] = []
  return {
    list: (folder) => source.list(folder),
    async fetchToTemp(filePath) {
      if (running >= limit) await new Promise<void>((resolve) => waiting.push(resolve))
      running++
      try {
        return await source.fetchToTemp(filePath)
      } finally {
        running--
        waiting.shift()?.()
      }
    },
  }
}

export function photoSizePx(size: PhotoSize, scale: number): number {
  return size === 'thumb' ? Math.round(PHOTO_SIZES.thumb * Math.max(1, scale)) : PHOTO_SIZES.screen
}

export function isHeif(filePath: string): boolean {
  return /\.(heic|heif)$/i.test(filePath)
}

// a picture that took longer than this is noted in the log (the download from a cloud, the decode on a small Pi)
const SLOW_PHOTO_MS = 8000

/** The picture in that size (made now if needed), undefined when it cannot be read or converted. */
export async function photoImage(
  deps: PhotoImageDeps,
  filePath: string,
  size: PhotoSize,
  version?: string,
): Promise<string | undefined> {
  const started = Date.now()
  const result = await photoImageNow(deps, filePath, size, version)
  const took = Date.now() - started
  if (took > SLOW_PHOTO_MS) {
    console.log(
      `${new Date().toLocaleString()}: [MuPiBox-Server] photo ${filePath} (${size}) took ${Math.round(took / 1000)} s${result ? '' : ' and failed'}`,
    )
  }
  return result
}

async function photoImageNow(
  deps: PhotoImageDeps,
  filePath: string,
  size: PhotoSize,
  version?: string,
): Promise<string | undefined> {
  // (without a version from the NAS the picture is made again once a day, as the covers are)
  const seed = `photo|${filePath}|${version ?? Math.floor(Date.now() / 86400000)}`
  const fetchSource = () => deps.source.fetchToTemp(filePath)
  const px = photoSizePx(size, deps.uiScale())
  if (!isHeif(filePath)) return deps.thumbnail(`photo:${filePath}`, px, seed, fetchSource)
  // HEIC: the decode is the expensive part (pillow-heif or heif-convert, see getThumbnail) - the screen picture is made first and
  // the small one from that JPEG, so a picture is decoded once
  const screen = await deps.thumbnail(`photo:${filePath}`, PHOTO_SIZES.screen, seed, fetchSource)
  if (!screen || size === 'screen') return screen
  return deps.thumbnail(screen, px, seed)
}

// Pictures made ahead of the finger: one worker, so the second thumbnail slot of server.ts stays free for what is
// asked for right now; a short queue, as a swipe in another direction makes the rest pointless.
const WARM_MAX = 12
const warmQueue: { key: string; run: () => Promise<unknown> }[] = []
let warmRunning = false

export function warmPhotos(
  deps: PhotoImageDeps,
  photos: { path: string; version?: string }[],
  size: PhotoSize = 'screen',
  replace = false,
): void {
  if (replace) warmQueue.length = 0
  for (const p of photos) {
    const key = `${p.path}|${size}`
    if (warmQueue.some((job) => job.key === key)) continue
    if (warmQueue.length >= WARM_MAX) break
    warmQueue.push({ key, run: () => photoImage(deps, p.path, size, p.version) })
  }
  if (!warmRunning) void pump()
}

async function pump(): Promise<void> {
  warmRunning = true
  try {
    for (let job = warmQueue.shift(); job; job = warmQueue.shift()) {
      await job.run().catch(() => undefined)
    }
  } finally {
    warmRunning = false
  }
}

/** (tests) */
export function warmQueueLength(): number {
  return warmQueue.length
}
