import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { fakeAsync, TestBed, tick } from '@angular/core/testing'

import { type PhotoAlbum, PhotosService } from './photos.service'

describe('PhotosService', () => {
  const api = 'http://localhost:8200/api'
  const offline = { status: 503, statusText: 'Service Unavailable' }
  let service: PhotosService
  let http: HttpTestingController

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptorsFromDi()), provideHttpClientTesting()],
    })
    service = TestBed.inject(PhotosService)
    http = TestBed.inject(HttpTestingController)
  })

  afterEach(() => http.verify())

  it('loads the albums', () => {
    const zoo: PhotoAlbum = {
      id: 'nas:/photos/Zoo',
      name: 'Zoo',
      count: 12,
      cover: '/api/photos/image?path=x',
      modified: '',
    }
    let albums: PhotoAlbum[] | undefined
    service.albums().subscribe((list) => {
      albums = list
    })
    http.expectOne(`${api}/photos/albums`).flush({ albums: [zoo], stale: false })
    expect(albums).toEqual([zoo])
    expect(service.unavailable()).toBeFalse()
  })

  it('tries twice more 5 s apart, then gives an empty list and marks the photos unavailable', fakeAsync(() => {
    let albums: PhotoAlbum[] | undefined
    service.albums().subscribe((list) => {
      albums = list
    })
    http.expectOne(`${api}/photos/albums`).flush({ albums: [], error: 'offline' }, offline)
    expect(albums).toBeUndefined()
    tick(5000)
    http.expectOne(`${api}/photos/albums`).flush({ albums: [], error: 'offline' }, offline)
    tick(5000)
    http.expectOne(`${api}/photos/albums`).flush({ albums: [], error: 'offline' }, offline)
    expect(albums).toEqual([])
    expect(service.unavailable()).toBeTrue()
  }))

  it('asks for one album by its id', () => {
    let name: string | undefined
    service.album('a1').subscribe((album) => {
      name = album.name
    })
    http.expectOne(`${api}/photos/album?id=a1`).flush({ id: 'a1', name: 'Zoo', photos: [] })
    expect(name).toBe('Zoo')
  })

  it('keepAlive posts the activity at once and every minute until it is unsubscribed', fakeAsync(() => {
    const activity = { method: 'POST', url: `${api}/activity` }
    const keepAlive = service.keepAlive()
    http.expectOne(activity).flush(null, { status: 204, statusText: 'No Content' })
    tick(60_000)
    http.expectOne(activity).flush(null, { status: 204, statusText: 'No Content' })
    keepAlive.unsubscribe()
    tick(60_000)
    http.expectNone(activity)
  }))

  it('keepAlive goes on after a failed post', fakeAsync(() => {
    const activity = { method: 'POST', url: `${api}/activity` }
    const keepAlive = service.keepAlive()
    http.expectOne(activity).flush({ error: 'forbidden' }, { status: 403, statusText: 'Forbidden' })
    tick(60_000)
    http.expectOne(activity).flush(null, { status: 204, statusText: 'No Content' })
    keepAlive.unsubscribe()
  }))
})
