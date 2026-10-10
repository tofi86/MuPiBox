import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
} from '@angular/core'
import { ActivatedRoute } from '@angular/router'
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonRouterOutlet,
  IonTitle,
  IonToolbar,
  NavController,
} from '@ionic/angular/standalone'
import { addIcons } from 'ionicons'
import { arrowBackOutline } from 'ionicons/icons'
import type { Subscription } from 'rxjs'

import { DisplayTextsService } from '../display-texts.service'
import { KmStatusGroupComponent } from '../km-header/km-status-group.component'
import { LoadingComponent } from '../loading/loading.component'
import { MediaUnavailableComponent } from '../media-unavailable/media-unavailable.component'
import { NowPlayingPillComponent } from '../now-playing-pill/now-playing-pill.component'
import { StatusComponent } from '../status/status.component'
import { KmThemeService } from '../theme/km-theme.service'
import { type Photo, type PhotoAlbumDetail, PhotosService } from './photos.service'

// The pictures of one album (photos tab of the start page) full screen: swipe through them, double-tap or pinch
// to zoom, back. A plain swiper-container with Swiper's zoom module (part of the bundle main.ts registers), not
// the cover swiper: one picture per slide, no scrollbar, no coverflow. The header keeps its bar - a pinch is a
// two-finger move and would fold it away otherwise (HeaderVisibilityService leaves this page out).
@Component({
  selector: 'app-photo-viewer',
  templateUrl: './photo-viewer.page.html',
  styleUrls: ['./photo-viewer.page.scss'],
  imports: [
    StatusComponent,
    KmStatusGroupComponent,
    NowPlayingPillComponent,
    LoadingComponent,
    MediaUnavailableComponent,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonButton,
    IonIcon,
    IonTitle,
    IonContent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhotoViewerPage {
  // Only the slides this close to the current one carry an <img>; the others are empty placeholders. An album of
  // 2000 pictures at screen size would otherwise be decoded into memory as a whole on the Pi.
  private static readonly WINDOW = 2
  // Pictures this far away are fetched into the browser's cache ahead of the window, so a quick swipe finds them.
  private static readonly PRELOAD = 3
  // The window follows a swipe only once the swiper has settled: a fast run through the album must not ask the box
  // for every picture passed on the way (each one a download from the NAS, from a cloud maybe).
  private static readonly SETTLE_MS = 300
  // The box is kept awake this long after the last touch in the viewer; a picture a child walked away from then
  // leaves the idle shutdown to its work.
  private static readonly KEEP_AWAKE_AFTER_TOUCH_MS = 5 * 60_000
  // A picture the box could not deliver (a download that took too long, a NAS that was busy) is asked for again a
  // few times, with a growing pause; a tap on the broken card asks at once.
  private static readonly RETRY_AFTER_MS = 4000
  private static readonly MAX_RETRIES = 5
  // While the album could not be loaded (NAS offline) it is asked for again every 30 s.
  private static readonly RETRY_MS = 30_000

  protected readonly km = inject(KmThemeService).isKm
  protected readonly r2 = inject(KmThemeService).roundTwo
  protected readonly displayTexts = inject(DisplayTextsService)
  private readonly photos = inject(PhotosService)
  private readonly route = inject(ActivatedRoute)
  private readonly navController = inject(NavController)
  // (whether there is a page to go back to: none after the page was loaded afresh here)
  private readonly outlet = inject(IonRouterOutlet, { optional: true })

  protected readonly album = signal<PhotoAlbumDetail | undefined>(undefined)
  protected readonly list = signal<Photo[] | undefined>(undefined)
  protected readonly index = signal(0)
  // the slide the picture window is built around: the index once the swiper has settled (SETTLE_MS)
  protected readonly windowIndex = signal(0)
  protected readonly isLoading = signal(false)
  protected readonly unavailable = signal(false)
  // the pictures (by path) that are on the screen already, and those the box could not deliver (404, 503)
  protected readonly loaded = signal(new Set<string>())
  protected readonly failed = signal(new Set<string>())
  private readonly reloadTick = signal(0)
  private readonly preloaded = new Set<string>()
  private readonly attempts = new Map<string, number>()
  private readonly retryTimers = new Set<number>()
  private settleTimer: number | undefined
  private lastTouch = Date.now()
  private keepAlive: Subscription | undefined

  protected readonly title = computed(() => this.album()?.name ?? this.displayTexts.text('photosTitle'))
  protected readonly counter = computed(() => {
    const total = this.list()?.length ?? 0
    return total === 0 ? '' : `${this.index() + 1} / ${total}`
  })

  constructor() {
    addIcons({ arrowBackOutline })
    // From the URL, not from navigation state: a reload of the display (the parents saved a setting in the app)
    // lands on this page afresh and must still find its album.
    const id = this.route.snapshot.paramMap.get('id')

    effect((onCleanup) => {
      this.reloadTick()
      if (!id) return
      this.isLoading.set(true)
      const request = this.photos.album(id).subscribe({
        next: (album) => {
          this.album.set(album)
          this.list.set(Array.isArray(album?.photos) ? album.photos : [])
          this.index.set(0)
          this.windowIndex.set(0)
          this.unavailable.set(false)
          this.isLoading.set(false)
          this.preloadNear(0)
        },
        error: () => {
          this.isLoading.set(false)
          this.unavailable.set(true)
        },
      })
      onCleanup(() => request.unsubscribe())
    })

    effect((onCleanup) => {
      if (!this.unavailable()) return
      const timer = window.setInterval(() => this.reloadTick.update((n) => n + 1), PhotoViewerPage.RETRY_MS)
      onCleanup(() => window.clearInterval(timer))
    })

    inject(DestroyRef).onDestroy(() => {
      this.stopKeepAlive()
      window.clearTimeout(this.settleTimer)
      for (const timer of this.retryTimers) window.clearTimeout(timer)
    })
  }

  // The box must not shut down for idleness while someone leafs through the pictures (the player is silent, touches
  // do not count): the backend is told every minute, as long as the page is on the screen and was touched within
  // the last KEEP_AWAKE_AFTER_TOUCH_MS.
  public ionViewDidEnter(): void {
    this.stopKeepAlive()
    this.lastTouch = Date.now()
    this.keepAlive = this.photos.keepAlive(
      () => Date.now() - this.lastTouch < PhotoViewerPage.KEEP_AWAKE_AFTER_TOUCH_MS,
    )
  }

  /** A finger on the page: a swipe, a tap, a pinch. */
  protected touched(): void {
    this.lastTouch = Date.now()
  }

  public ionViewWillLeave(): void {
    this.stopKeepAlive()
  }

  private stopKeepAlive(): void {
    this.keepAlive?.unsubscribe()
    this.keepAlive = undefined
  }

  /** Whether slide `i` carries its picture (see WINDOW). */
  protected inWindow(i: number): boolean {
    return Math.abs(i - this.windowIndex()) <= PhotoViewerPage.WINDOW
  }

  protected onSlideChange(event: Event): void {
    const swiper = (event.target as unknown as { swiper?: { activeIndex?: number } })?.swiper
    if (!swiper || typeof swiper.activeIndex !== 'number') return
    this.index.set(swiper.activeIndex)
    this.touched()
    window.clearTimeout(this.settleTimer)
    this.settleTimer = window.setTimeout(() => {
      this.windowIndex.set(this.index())
      this.preloadNear(this.index())
    }, PhotoViewerPage.SETTLE_MS)
  }

  // The pictures just outside the window are fetched ahead, once per address, as the cover lists do it
  // (SwiperComponent.preloadCoversNear); the ones inside it are <img> elements and load on their own.
  private preloadNear(index: number): void {
    const list = this.list()
    if (!list) return
    for (let i = index - PhotoViewerPage.PRELOAD; i <= index + PhotoViewerPage.PRELOAD; i++) {
      if (Math.abs(i - index) <= PhotoViewerPage.WINDOW) continue
      const src = list[i]?.src
      if (!src || this.preloaded.has(src)) continue
      this.preloaded.add(src)
      const img = new Image()
      img.src = src
    }
  }

  protected onLoad(photo: Photo): void {
    this.loaded.update((paths) => new Set(paths).add(photo.path))
  }

  protected onError(photo: Photo): void {
    const tries = (this.attempts.get(photo.path) ?? 0) + 1
    this.attempts.set(photo.path, tries)
    this.failed.update((paths) => new Set(paths).add(photo.path))
    if (tries > PhotoViewerPage.MAX_RETRIES) return
    const timer = window.setTimeout(() => {
      this.retryTimers.delete(timer)
      this.retry(photo)
    }, PhotoViewerPage.RETRY_AFTER_MS * tries)
    this.retryTimers.add(timer)
  }

  /** Asks the box for a failed picture again (fresh: as if for the first time - a tap on the broken card). */
  protected retry(photo: Photo, fresh = false): void {
    if (fresh) this.attempts.delete(photo.path)
    this.failed.update((paths) => {
      const next = new Set(paths)
      next.delete(photo.path)
      return next
    })
  }

  protected goBack(): void {
    if (this.outlet?.canGoBack()) {
      void this.navController.pop()
    } else {
      // Loaded afresh on this album (a reload of the display): no page before it - pop() would do nothing. Back to
      // the start page, on the photos tab as soon as the poll has brought it (HomePage.startCategory).
      void this.navController.navigateRoot('/home', { animationDirection: 'back', state: { category: 'photos' } })
    }
  }
}
