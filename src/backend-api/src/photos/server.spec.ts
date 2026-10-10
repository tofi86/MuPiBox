// Fotos end to end through the real server: the display's flag, the activity ping of the viewer, and the NAS adapter
// of server.ts - a WebDAV answered by nock, from the login to a look into a folder of the parents' app. In a file of
// its own: server.spec.ts stops at its old rssfeed assertion (an uncaught exception ends the process).
import assert from 'node:assert'
import { describe, it } from 'node:test'
import nock from 'nock'
import request from 'supertest'
import { CSRF_HEADER, issueSession, SESSION_COOKIE } from '../eltern/auth'
import { app } from '../server'

describe('photos', () => {
  const dav = (hrefs: { href: string; dir?: boolean; etag?: string }[]) =>
    `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">${hrefs
      .map(
        (h) =>
          `<D:response><D:href>${h.href}</D:href><D:propstat><D:prop><D:resourcetype>${h.dir ? '<D:collection/>' : ''}</D:resourcetype>${
            h.etag ? `<D:getetag>"${h.etag}"</D:getetag>` : ''
          }<D:getlastmodified>Sat, 05 Sep 2026 10:00:00 GMT</D:getlastmodified></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`,
      )
      .join('')}</D:multistatus>`

  it('tells the display that there is no photos tab without chosen folders', async () => {
    const res = await request(app).get('/api/data-version').expect(200)
    assert.equal(res.body.photosTab, false)
  })

  it('takes the activity ping of the display', async () => {
    await request(app).post('/api/activity').expect(204)
  })

  it('signs in to a WebDAV NAS and looks into a folder for the parents', async () => {
    nock('http://nas.test:5005')
      .intercept('/', 'PROPFIND')
      .reply(
        207,
        dav([
          { href: '/', dir: true },
          { href: '/photos/', dir: true },
        ]),
      )
      .intercept('/photos/', 'PROPFIND')
      .reply(
        207,
        dav([
          { href: '/photos/', dir: true },
          { href: '/photos/Zoo/', dir: true },
          { href: '/photos/IMG_1.jpg', etag: 'p1' },
        ]),
      )
      .intercept('/photos/Zoo/', 'PROPFIND')
      .reply(
        207,
        dav([
          { href: '/photos/Zoo/', dir: true },
          { href: '/photos/Zoo/IMG_0002.jpg', etag: 'z2' },
          { href: '/photos/Zoo/IMG_0001.jpg', etag: 'z1' },
        ]),
      )
    const login = await request(app)
      .post('/api/nas/login')
      .send({ address: 'nas.test:5005', https: false, account: 'mupibox', password: 'mupibox', rememberMe: false })
      .expect(200)
    assert.equal(login.body.success, true, JSON.stringify(login.body))
    const { sessionId, csrf } = issueSession('127.0.0.1')
    const peek = await request(app)
      .get('/api/app/photos/peek')
      .query({ path: '/photos' })
      .set('Cookie', `${SESSION_COOKIE}=${sessionId}`)
      .set(CSRF_HEADER, csrf)
      .expect(200)
    assert.deepEqual(peek.body, {
      path: '/photos',
      name: 'photos',
      subfolders: 1,
      images: 1,
      skipped: 0,
      albums: [
        { name: 'Zoo', path: '/photos/Zoo', count: 2 },
        { name: 'photos', path: '/photos', count: 1 },
      ],
    })
  })
})
