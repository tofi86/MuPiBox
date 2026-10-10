import { HttpClient } from '@angular/common/http'
import { Injectable, inject, signal } from '@angular/core'
import {
  catchError,
  EMPTY,
  filter,
  interval,
  map,
  type Observable,
  of,
  retry,
  type Subscription,
  startWith,
  switchMap,
  tap,
  timer,
} from 'rxjs'
import { environment } from '../../environments/environment'

/** An album on the photos tab: a photo folder the parents chose in the app, or one of its subfolders. */
export interface PhotoAlbum {
  id: string
  name: string
  count: number
  /** the cover's address on the display's own origin (/api/photos/image?…&size=thumb), null for an empty album */
  cover: string | null
  modified?: string
}

export interface Photo {
  name: string
  path: string
  version: string
  /** the picture for the screen (/api/photos/image?…&size=screen&v=…) */
  src: string
}

export interface PhotoAlbumDetail {
  id: string
  name: string
  photos: Photo[]
}

// The photos the parents chose in the app (Bibliothek › Fotos): the albums for the start page's photos tab and the
// pictures of one album for the viewer. The backend reads them from the NAS; the display never talks to the NAS.
@Injectable({ providedIn: 'root' })
export class PhotosService {
  private readonly http = inject(HttpClient)
  private readonly apiUrl = environment.backend.apiUrl
  /** The albums could not be loaded (NAS offline, backend not answering): the start page shows the "not reachable" card. */
  public readonly unavailable = signal(false)

  /**
   * The albums of all photo folders. The NAS may just be waking up (503), so a failed request is tried twice more
   * 5 s apart; then the list is empty and `unavailable` is set - the start page asks again every 30 s from there.
   */
  public albums(): Observable<PhotoAlbum[]> {
    return this.http.get<{ albums?: PhotoAlbum[] }>(`${this.apiUrl}/photos/albums`).pipe(
      map((response) => response?.albums ?? []),
      retry({ count: 2, delay: () => timer(5000) }),
      tap(() => this.unavailable.set(false)),
      catchError(() => {
        this.unavailable.set(true)
        return of([] as PhotoAlbum[])
      }),
    )
  }

  /** One album with its pictures in order; errors (400, 403, 503) reach the caller. */
  public album(id: string): Observable<PhotoAlbumDetail> {
    return this.http.get<PhotoAlbumDetail>(`${this.apiUrl}/photos/album`, { params: { id } })
  }

  /**
   * Tells the box that someone is looking at photos, now and then every minute while `stillActive` says so (the
   * viewer: touched within the last minutes): the idle shutdown counts a box that does not play as idle, touches do
   * not reset it. Sent from anywhere; the backend ignores it unless it comes from the box itself, and a failed post
   * is nobody's problem (the next one comes in a minute).
   */
  public keepAlive(stillActive: () => boolean = () => true): Subscription {
    // (startWith, not timer(0, …): the first post goes out at once, before the viewer's page has even settled)
    return interval(60_000)
      .pipe(
        startWith(0),
        filter(() => stillActive()),
        switchMap(() => this.http.post(`${this.apiUrl}/activity`, null).pipe(catchError(() => EMPTY))),
      )
      .subscribe()
  }
}
