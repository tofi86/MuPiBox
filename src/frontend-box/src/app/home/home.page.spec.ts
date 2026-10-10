import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { ComponentFixture, TestBed } from '@angular/core/testing'

import { HomePage } from './home.page'

describe('HomePage', () => {
  let component: HomePage
  let fixture: ComponentFixture<HomePage>
  let httpClient: HttpTestingController

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HomePage],
      providers: [provideHttpClient(withInterceptorsFromDi()), provideHttpClientTesting()],
    }).compileComponents()

    httpClient = TestBed.inject(HttpTestingController)

    fixture = TestBed.createComponent(HomePage)
    component = fixture.componentInstance
    fixture.detectChanges()
  })

  it('should create', () => {
    httpClient.expectOne('http://localhost:8200/api/sonos')
    expect(component).toBeTruthy()
  })

  // the photos tab: only once the parents chose a photo folder (data-version says so; older backends never do)
  it('shows the four tabs when data-version knows no photos tab', () => {
    httpClient.expectOne('http://localhost:8200/api/data-version').flush({ version: '1', local: '1', nasTab: true })
    expect((component as any).visibleCategories().map((c: { key: string }) => c.key)).toEqual([
      'audiobook',
      'music',
      'nas',
      'other',
    ])
    expect((component as any).fiveTabs()).toBeFalse()
  })

  it('adds the photos tab last when the parents chose photo folders', () => {
    httpClient
      .expectOne('http://localhost:8200/api/data-version')
      .flush({ version: '1', local: '1', nasTab: true, photosTab: true })
    expect((component as any).visibleCategories().map((c: { key: string }) => c.key)).toEqual([
      'audiobook',
      'music',
      'nas',
      'other',
      'photos',
    ])
    expect((component as any).fiveTabs()).toBeTrue()
  })
})
