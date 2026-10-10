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
  private static readonly PRELOAD = 4
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
  protected readonly isLoading = signal(false)
  protected readonly unavailable = signal(false)
  // the pictures (by path) that are on the screen already, and those the box could not deliver (404, 503)
  protected readonly loaded = signal(new Set<string>())
  protected readonly failed = signal(new Set<string>())
  private readonly reloadTick = signal(0)
  private readonly preloaded = new Set<string>()
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

    inject(DestroyRef).onDestroy(() => this.stopKeepAlive())
  }

  // The box must not shut down for idleness while the pictures are looked at (the player is silent, touches do
  // not count): the backend is told every minute as long as the page is on the screen.
  public ionViewDidEnter(): void {
    this.stopKeepAlive()
    this.keepAlive = this.photos.keepAlive()
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
    return Math.abs(i - this.index()) <= PhotoViewerPage.WINDOW
  }

  protected onSlideChange(event: Event): void {
    const swiper = (event.target as unknown as { swiper?: { activeIndex?: number } })?.swiper
    if (!swiper || typeof swiper.activeIndex !== 'number') return
    this.index.set(swiper.activeIndex)
    this.preloadNear(swiper.activeIndex)
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
    this.failed.update((paths) => new Set(paths).add(photo.path))
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
