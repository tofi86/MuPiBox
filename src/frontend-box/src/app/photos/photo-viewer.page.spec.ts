import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing'
import { ActivatedRoute, convertToParamMap } from '@angular/router'

import { PhotoViewerPage } from './photo-viewer.page'
import type { Photo } from './photos.service'

describe('PhotoViewerPage', () => {
  const albumUrl = 'http://localhost:8200/api/photos/album?id=a1'
  // (data addresses: a real /api/photos/image path would make the browser ask the test server for it)
  const photo = (n: number): Photo => ({
    name: `IMG_${n}.jpg`,
    path: `/photos/Zoo/IMG_${n}.jpg`,
    version: 'v',
    src: `data:image/gif;base64,R0lGODlhAQABAAAAACw=#${n}`,
  })
  const album = (count: number) => ({
    id: 'a1',
    name: 'Zoo',
    path: '/photos/Zoo',
    count,
    truncated: false,
    photos: Array.from({ length: count }, (_, i) => photo(i + 1)),
  })
  let component: PhotoViewerPage
  let fixture: ComponentFixture<PhotoViewerPage>
  let httpClient: HttpTestingController

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PhotoViewerPage],
      providers: [
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'a1' }) } } },
      ],
    }).compileComponents()

    httpClient = TestBed.inject(HttpTestingController)

    fixture = TestBed.createComponent(PhotoViewerPage)
    component = fixture.componentInstance
    fixture.detectChanges()
  })

  it('creates, fetches the album of the route and shows its name with the counter', () => {
    expect(component).toBeTruthy()
    expect((component as any).title()).toBe('Photos')
    httpClient.expectOne(albumUrl).flush(album(3))
    expect((component as any).title()).toBe('Zoo')
    expect((component as any).counter()).toBe('1 / 3')
    expect((component as any).isLoading()).toBeFalse()
    expect((component as any).unavailable()).toBeFalse()
  })

  it('moves the counter at once and the picture window once the swiper settled', fakeAsync(() => {
    httpClient.expectOne(albumUrl).flush(album(8))
    expect((component as any).inWindow(0)).toBeTrue()
    expect((component as any).inWindow(2)).toBeTrue()
    expect((component as any).inWindow(3)).toBeFalse()

    ;(component as any).onSlideChange({ target: { swiper: { activeIndex: 5 } } } as unknown as Event)
    expect((component as any).counter()).toBe('6 / 8')
    // (a fast run through the album: the window waits for the swiper to settle)
    expect((component as any).inWindow(2)).toBeTrue()
    tick(300)
    expect((component as any).inWindow(2)).toBeFalse()
    expect((component as any).inWindow(3)).toBeTrue()
    expect((component as any).inWindow(7)).toBeTrue()
  }))

  it('asks for a failed picture again after a pause, and at once on a tap', fakeAsync(() => {
    httpClient.expectOne(albumUrl).flush(album(3))
    const photo = (component as any).list()[0] as Photo
    ;(component as any).onError(photo)
    expect((component as any).failed().has(photo.path)).toBeTrue()
    tick(4000)
    expect((component as any).failed().has(photo.path)).toBeFalse()
    ;(component as any).onError(photo)
    ;(component as any).retry(photo, true)
    expect((component as any).failed().has(photo.path)).toBeFalse()
    tick(10_000)
  }))

  it('ignores a slide event without a swiper', () => {
    httpClient.expectOne(albumUrl).flush(album(3))
    ;(component as any).onSlideChange({ target: {} } as unknown as Event)
    expect((component as any).counter()).toBe('1 / 3')
  })

  it('shows the "not reachable" card when the box answers 503', () => {
    httpClient.expectOne(albumUrl).flush({ error: 'offline' }, { status: 503, statusText: 'Service Unavailable' })
    expect((component as any).unavailable()).toBeTrue()
    expect((component as any).isLoading()).toBeFalse()
    expect((component as any).list()).toBeUndefined()
  })

  it('keeps the box awake while the page is on the screen', () => {
    httpClient.expectOne(albumUrl).flush(album(1))
    component.ionViewDidEnter()
    httpClient
      .expectOne({ method: 'POST', url: 'http://localhost:8200/api/activity' })
      .flush(null, { status: 204, statusText: 'No Content' })
    component.ionViewWillLeave()
    httpClient.expectNone({ method: 'POST', url: 'http://localhost:8200/api/activity' })
  })
})
