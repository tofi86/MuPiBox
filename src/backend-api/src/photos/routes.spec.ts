import assert from 'node:assert'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import express, { Router } from 'express'
import request from 'supertest'
import { CSRF_HEADER, issueSession, SESSION_COOKIE } from '../eltern/auth'
import { localNetworkOnly } from '../eltern/middleware'
import { warmQueueLength } from './images'
import { registerPhotoAppRoutes, registerPhotoRoutes } from './routes'
import { type PhotoEntry, type PhotoSource, PhotoSourceOffline } from './source'

const name = (p: string) => p.split('/').pop() ?? ''
const dir = (p: string, modified?: string): PhotoEntry => ({ name: name(p), path: p, isdir: true, modified })
const file = (p: string, version?: string): PhotoEntry => ({ name: name(p), path: p, isdir: false, version })

// the NAS of the tests: a tree, and a switch that takes it away
class FakeSource implements PhotoSource {
  offline: 'no_session' | 'unreachable' | undefined
  fetched: string[] = []
  constructor(readonly tree: Record<string, PhotoEntry[]>) {}
  async list(folder: string): Promise<PhotoEntry[]> {
    if (this.offline) throw new PhotoSourceOffline(this.offline)
    return this.tree[folder] ?? []
  }
  async fetchToTemp(p: string): Promise<string | undefined> {
    if (this.offline) throw new PhotoSourceOffline(this.offline)
    this.fetched.push(p)
    const entries = this.tree[path.posix.dirname(p)] ?? []
    return entries.some((e) => e.path === p) ? p : undefined
  }
}

const tree = {
  '/photos/Familie 2026': [
    dir('/photos/Familie 2026/Zoo', 'Sat, 05 Sep 2026 10:00:00 GMT'),
    file('/photos/Familie 2026/IMG_loose_1.jpg', 'p1'),
  ],
  '/photos/Familie 2026/Zoo': [
    file('/photos/Familie 2026/Zoo/IMG_0002.jpg', 'z2'),
    file('/photos/Familie 2026/Zoo/IMG_0001.jpg', 'z1'),
  ],
  '/photos/Urlaub': [dir('/photos/Urlaub/Meer')],
  '/photos/Urlaub/Meer': [file('/photos/Urlaub/Meer/a.jpg', 'm1')],
}

async function build(cfg: { photos?: { folders?: unknown } }) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'mupibox-photos-'))
  const source = new FakeSource(tree)
  const app = express()
  app.use(express.json())
  const made: string[] = []
  const photoRoutes = registerPhotoRoutes(app, {
    source,
    roots: () => (cfg.photos?.folders as { path: string; name: string }[] | undefined) ?? [],
    // (no PIL here: the "thumbnail" is a file with the size in it, made from what the source hands out)
    thumbnail: async (src, size, seed, fetchSource) => {
      const fetched = fetchSource ? await fetchSource() : src
      if (!fetched) return undefined
      const target = path.join(tmp, `${seed.replace(/[^a-z0-9]/gi, '_')}-${size}.jpg`)
      await writeFile(target, `thumb ${size}`)
      made.push(target)
      return target
    },
    sendThumbnail: async (res, file, cache) => {
      res.setHeader('Content-Type', 'image/jpeg')
      res.setHeader('Cache-Control', cache === 'immutable' ? 'public, max-age=31536000, immutable' : 'no-cache')
      res.send(path.basename(file))
    },
    uiScale: () => 1,
    cacheDir: tmp,
  })
  const router = Router()
  router.use(localNetworkOnly)
  let nasLoggedIn = true
  registerPhotoAppRoutes(router, {
    source,
    getMupiboxConfig: () => cfg as never,
    updateMupiboxConfig: async (mutate) => {
      const copy = JSON.parse(JSON.stringify(cfg))
      if (mutate(copy) !== false) Object.assign(cfg, copy)
    },
    nasState: async () => ({ address: 'nas.test:5005', loggedIn: nasLoggedIn }),
    albumsChanged: photoRoutes.albumsChanged,
  })
  app.use('/api/app', router)
  const { sessionId, csrf } = issueSession('127.0.0.1')
  const auth = { Cookie: `${SESSION_COOKIE}=${sessionId}`, [CSRF_HEADER]: csrf }
  return { app, source, cfg, auth, made, setNas: (v: boolean) => (nasLoggedIn = v) }
}

describe('display routes', () => {
  it('answers no albums without chosen folders', async () => {
    const { app } = await build({})
    const res = await request(app).get('/api/photos/albums').expect(200)
    assert.deepEqual(res.body, { albums: [], stale: false })
  })

  it('lists the albums with their cover addresses, newest first', async () => {
    const { app } = await build({ photos: { folders: [{ path: '/photos/Familie 2026', name: 'Familie' }] } })
    const res = await request(app).get('/api/photos/albums').expect(200)
    assert.equal(res.body.stale, false)
    assert.deepEqual(
      res.body.albums.map((a: { id: string; cover: string }) => [a.id, a.cover]),
      [
        [
          'nas:/photos/Familie 2026/Zoo',
          '/api/photos/image?path=%2Fphotos%2FFamilie%202026%2FZoo%2FIMG_0001.jpg&size=thumb&v=z1',
        ],
        [
          'nas:/photos/Familie 2026',
          '/api/photos/image?path=%2Fphotos%2FFamilie%202026%2FIMG_loose_1.jpg&size=thumb&v=p1',
        ],
      ],
    )
    assert.equal(res.headers['cache-control'], 'no-store')
  })

  it('answers 503 while the NAS is away, and the albums of before as stale once it had them', async () => {
    const { app, source } = await build({ photos: { folders: [{ path: '/photos/Familie 2026', name: 'Familie' }] } })
    source.offline = 'unreachable'
    const first = await request(app).get('/api/photos/albums').expect(503)
    assert.equal(first.headers['retry-after'], '15')
    assert.deepEqual(first.body, { albums: [], error: 'offline' })
    source.offline = undefined
    await request(app).get('/api/photos/albums').expect(200)
    source.offline = 'unreachable'
    const stale = await request(app).get('/api/photos/albums').expect(200)
    assert.equal(stale.body.stale, true)
    assert.equal(stale.body.albums.length, 2)
  })

  it('hands out one album with its pictures in order and warms the first ones', async () => {
    const { app } = await build({ photos: { folders: [{ path: '/photos/Familie 2026', name: 'Familie' }] } })
    const res = await request(app).get('/api/photos/album').query({ id: 'nas:/photos/Familie 2026/Zoo' }).expect(200)
    assert.equal(res.body.name, 'Zoo')
    assert.equal(res.body.count, 2)
    assert.equal(res.body.truncated, false)
    assert.deepEqual(
      res.body.photos.map((p: { name: string; version: string; src: string }) => [p.name, p.version, p.src]),
      [
        [
          'IMG_0001.jpg',
          'z1',
          '/api/photos/image?path=%2Fphotos%2FFamilie%202026%2FZoo%2FIMG_0001.jpg&size=screen&v=z1',
        ],
        [
          'IMG_0002.jpg',
          'z2',
          '/api/photos/image?path=%2Fphotos%2FFamilie%202026%2FZoo%2FIMG_0002.jpg&size=screen&v=z2',
        ],
      ],
    )
    // the album of the pictures lying in the chosen folder carries the parents' name
    const loose = await request(app).get('/api/photos/album').query({ id: 'nas:/photos/Familie 2026' }).expect(200)
    assert.equal(loose.body.name, 'Familie')
    assert.equal(loose.body.photos.length, 1)
    // (the warming queue drains in the background; by now it is empty or short)
    assert.ok(warmQueueLength() <= 4)
  })

  it('refuses albums and pictures outside the chosen folders', async () => {
    const { app } = await build({ photos: { folders: [{ path: '/photos/Familie 2026', name: 'Familie' }] } })
    await request(app).get('/api/photos/album').query({ id: 'nas:/photos/Urlaub/Meer' }).expect(403)
    await request(app).get('/api/photos/album').query({ id: 'nas:/photos/Familie 2026/Zoo/Tag 1' }).expect(403)
    await request(app).get('/api/photos/album').query({ id: 'photos' }).expect(400)
    await request(app).get('/api/photos/image').query({ path: '/photos/Urlaub/Meer/a.jpg', size: 'thumb' }).expect(403)
    await request(app)
      .get('/api/photos/image')
      .query({ path: '/photos/Familie 2026/Zoo/notes.pdf', size: 'thumb' })
      .expect(403)
    await request(app)
      .get('/api/photos/image')
      .query({ path: '/photos/Familie 2026/Zoo/IMG_0001.jpg', size: 'huge' })
      .expect(400)
  })

  it('serves a picture, kept for a year when the address carries the version', async () => {
    const { app, source } = await build({ photos: { folders: [{ path: '/photos/Familie 2026', name: 'Familie' }] } })
    const kept = await request(app)
      .get('/api/photos/image')
      .query({ path: '/photos/Familie 2026/Zoo/IMG_0001.jpg', size: 'screen', v: 'z1' })
      .expect(200)
    assert.match(kept.headers['content-type'], /^image\/jpeg/)
    assert.equal(kept.headers['cache-control'], 'public, max-age=31536000, immutable')
    assert.match(String(kept.body), /-1600\.jpg$/)
    const fresh = await request(app)
      .get('/api/photos/image')
      .query({ path: '/photos/Familie 2026/Zoo/IMG_0001.jpg', size: 'thumb' })
      .expect(200)
    assert.equal(fresh.headers['cache-control'], 'no-cache')
    assert.match(String(fresh.body), /-400\.jpg$/)
    // a picture that is not there: 404; while the NAS is away: 503
    await request(app)
      .get('/api/photos/image')
      .query({ path: '/photos/Familie 2026/Zoo/IMG_0009.jpg', size: 'thumb', v: 'x' })
      .expect(404)
    source.offline = 'unreachable'
    await request(app)
      .get('/api/photos/image')
      .query({ path: '/photos/Familie 2026/Zoo/IMG_0009.jpg', size: 'thumb', v: 'y' })
      .expect(503)
  })
})

describe("the parents' routes", () => {
  it('wants a session', async () => {
    const { app } = await build({})
    await request(app).get('/api/app/photos/config').expect(401)
  })

  it('tells the chosen folders and the NAS login', async () => {
    const { app, auth, setNas } = await build({
      photos: { folders: [{ path: '/photos/Familie 2026', name: 'Familie' }] },
    })
    const res = await request(app).get('/api/app/photos/config').set(auth).expect(200)
    assert.deepEqual(res.body, {
      folders: [{ path: '/photos/Familie 2026', name: 'Familie' }],
      maxFolders: 20,
      nasAddress: 'nas.test:5005',
      nasConnected: true,
    })
    setNas(false)
    const off = await request(app).get('/api/app/photos/config').set(auth).expect(200)
    assert.equal(off.body.nasConnected, false)
  })

  it('adds and removes folders, and refuses doubles, nested ones and junk', async () => {
    const { app, auth, cfg } = await build({})
    const post = (body: object) => request(app).post('/api/app/photos/folders').set(auth).send(body)
    let res = await post({ add: { path: '/photos/Familie 2026/' } }).expect(200)
    assert.deepEqual(res.body.folders, [{ path: '/photos/Familie 2026', name: 'Familie 2026' }])
    assert.deepEqual(cfg.photos, { folders: [{ path: '/photos/Familie 2026', name: 'Familie 2026' }] })
    res = await post({ add: { path: '/photos/Familie 2026' } }).expect(400)
    assert.equal(res.body.error, 'exists')
    res = await post({ add: { path: '/photos/Familie 2026/Zoo' } }).expect(400)
    assert.equal(res.body.error, 'nested')
    res = await post({ add: { path: '/photos' } }).expect(400)
    assert.equal(res.body.error, 'nested')
    res = await post({ add: { path: '/' } }).expect(400)
    assert.equal(res.body.error, 'invalid_path')
    res = await post({ add: 'junk' }).expect(400)
    assert.equal(res.body.error, 'invalid_path')
    res = await post({ add: { path: '/photos/Urlaub', name: 'Am Meer' } }).expect(200)
    assert.equal(res.body.folders.length, 2)
    res = await post({ remove: '/photos/Familie 2026' }).expect(200)
    assert.deepEqual(res.body.folders, [{ path: '/photos/Urlaub', name: 'Am Meer' }])
    res = await post({ items: [{ path: '/a' }, { path: '/a/b' }] }).expect(400)
    assert.equal(res.body.error, 'nested')
    res = await post({ items: Array.from({ length: 21 }, (_, i) => ({ path: `/p${i}` })) }).expect(400)
    assert.equal(res.body.error, 'too_many')
    res = await post({ items: [{ path: '/x' }, { path: '/y' }] }).expect(200)
    assert.deepEqual(
      res.body.folders.map((f: { path: string }) => f.path),
      ['/x', '/y'],
    )
    // without the CSRF header nothing changes
    await request(app).post('/api/app/photos/folders').set('Cookie', auth.Cookie).send({ remove: '/x' }).expect(403)
  })

  it('looks into a folder: what would become albums', async () => {
    const { app, auth, source } = await build({})
    const res = await request(app)
      .get('/api/app/photos/peek')
      .query({ path: '/photos/Familie 2026' })
      .set(auth)
      .expect(200)
    assert.deepEqual(res.body, {
      path: '/photos/Familie 2026',
      name: 'Familie 2026',
      subfolders: 1,
      images: 1,
      skipped: 0,
      albums: [
        { name: 'Zoo', path: '/photos/Familie 2026/Zoo', count: 2 },
        { name: 'Familie 2026', path: '/photos/Familie 2026', count: 1 },
      ],
    })
    await request(app).get('/api/app/photos/peek').query({ path: '/' }).set(auth).expect(400)
    source.offline = 'no_session'
    const noLogin = await request(app).get('/api/app/photos/peek').query({ path: '/photos' }).set(auth).expect(401)
    assert.equal(noLogin.body.error, 'not_logged_in')
    source.offline = 'unreachable'
    const away = await request(app).get('/api/app/photos/peek').query({ path: '/photos' }).set(auth).expect(502)
    assert.equal(away.body.error, 'nas_unreachable')
  })
})
