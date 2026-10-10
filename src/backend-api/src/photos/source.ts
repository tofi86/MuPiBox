// Fotos (the photo viewer of the display): where the pictures come from. Today that is the NAS over WebDAV -
// server.ts wraps its folder listing and its download into this shape. An SMB share later is another object with
// the same two calls; the albums, the routes and the display do not change for it.

/** One entry of a folder listing: the shape of server.ts NasFileEntry, so a WebDAV listing passes through as it is. */
export interface PhotoEntry {
  name: string
  path: string
  isdir: boolean
  /** ETag or last-modified date of the NAS: changes when the file changes (part of the picture's cache key) */
  version?: string
  /** last-modified date (an HTTP date), for the order of the albums */
  modified?: string
  additional?: { size?: number }
}

/** The source cannot be asked right now: not signed in (nothing remembered), or it does not answer. */
export class PhotoSourceOffline extends Error {
  constructor(readonly reason: 'no_session' | 'unreachable') {
    super(`photo source offline: ${reason}`)
    this.name = 'PhotoSourceOffline'
  }
}

export interface PhotoSource {
  /** The children of a folder, one level. [] for a folder that is gone or not readable; throws PhotoSourceOffline. */
  list(folder: string): Promise<PhotoEntry[]>
  /**
   * The picture as a temporary file that keeps the picture's extension (the caller deletes it); undefined when it
   * cannot be read. Throws PhotoSourceOffline when the source is away.
   */
  fetchToTemp(path: string): Promise<string | undefined>
}
