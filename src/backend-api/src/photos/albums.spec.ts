import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  albumId,
  albumPath,
  derivePhotoAlbums,
  MAX_PHOTO_ROOTS,
  photoPathAllowed,
  photoRootsOf,
  sortPhotos,
} from './albums'
import { type PhotoEntry, PhotoSourceOffline } from './source'

const name = (p: string) => p.split('/').pop() ?? ''
const dir = (path: string, modified?: string): PhotoEntry => ({ name: name(path), path, isdir: true, modified })
const file = (path: string, version?: string, modified?: string): PhotoEntry => ({
  name: name(path),
  path,
  isdir: false,
  version,
  modified,
})

// a NAS in a Map: a folder that is not in it is one the NAS does not answer for
function fakeNas(tree: Record<string, PhotoEntry[]>) {
  const calls: string[] = []
  const list = async (folder: string) => {
    calls.push(folder)
    const entries = tree[folder]
    if (entries === undefined) throw new PhotoSourceOffline('unreachable')
    return entries
  }
  return { list, calls }
}

const familie = {
  '/photos/Familie 2026': [
    dir('/photos/Familie 2026/Zoo', 'Sat, 05 Sep 2026 10:00:00 GMT'),
    dir('/photos/Familie 2026/Oma 70', 'Sun, 02 Aug 2026 10:00:00 GMT'),
    dir('/photos/Familie 2026/Leer'),
    dir('/photos/Familie 2026/@eaDir'),
    file('/photos/Familie 2026/IMG_loose_2.png', 'p2'),
    file('/photos/Familie 2026/IMG_loose_1.jpg', 'p1', 'Mon, 01 Jun 2026 10:00:00 GMT'),
    file('/photos/Familie 2026/notes.txt'),
  ],
  '/photos/Familie 2026/Zoo': [
    file('/photos/Familie 2026/Zoo/IMG_0010.jpg', 'z10'),
    file('/photos/Familie 2026/Zoo/IMG_0002.heic', 'z2'),
    file('/photos/Familie 2026/Zoo/IMG_0001.jpg', 'z1'),
    file('/photos/Familie 2026/Zoo/._IMG_0001.jpg'),
    file('/photos/Familie 2026/Zoo/video.mp4'),
  ],
  '/photos/Familie 2026/Oma 70': [file('/photos/Familie 2026/Oma 70/IMG_0101.jpg', 'o1')],
  '/photos/Familie 2026/Leer': [],
}

describe('photoRootsOf', () => {
  it('reads the chosen folders, well-formed and each once', () => {
    assert.deepEqual(photoRootsOf(undefined), [])
    assert.deepEqual(photoRootsOf({ photos: { folders: 'x' } }), [])
    const roots = photoRootsOf({
      photos: {
        folders: [
          { path: '/photos/Familie 2026/', name: '  Familie ' },
          { path: 'photos/Familie 2026' },
          { path: '/' },
          { path: '/a/../b' },
          'junk',
          { path: '/photos/Urlaub' },
        ],
      },
    })
    assert.deepEqual(roots, [
      { path: '/photos/Familie 2026', name: 'Familie' },
      { path: '/photos/Urlaub', name: 'Urlaub' },
    ])
  })

  it('keeps at most the first twenty', () => {
    const folders = Array.from({ length: 25 }, (_, i) => ({ path: `/p/${i}` }))
    assert.equal(photoRootsOf({ photos: { folders } }).length, MAX_PHOTO_ROOTS)
  })
})

describe('derivePhotoAlbums', () => {
  it('makes an album of every subfolder with pictures and one of the pictures lying in the folder', async () => {
    const nas = fakeNas(familie)
    const albums = await derivePhotoAlbums([{ path: '/photos/Familie 2026', name: 'Familie' }], nas.list)
    assert.deepEqual(
      albums.map((a) => [a.id, a.name, a.count, a.cover?.path, a.cover?.version]),
      [
        ['nas:/photos/Familie 2026/Zoo', 'Zoo', 3, '/photos/Familie 2026/Zoo/IMG_0001.jpg', 'z1'],
        ['nas:/photos/Familie 2026/Oma 70', 'Oma 70', 1, '/photos/Familie 2026/Oma 70/IMG_0101.jpg', 'o1'],
        ['nas:/photos/Familie 2026', 'Familie', 2, '/photos/Familie 2026/IMG_loose_1.jpg', 'p1'],
      ],
    )
    assert.equal(albums[0].modified, '2026-09-05T10:00:00.000Z')
    // (the loose pictures: the newest picture's date)
    assert.equal(albums[2].modified, '2026-06-01T10:00:00.000Z')
    assert.ok(albums.every((a) => a.root === '/photos/Familie 2026'))
  })

  it('lists the folder and each real subfolder once', async () => {
    const nas = fakeNas(familie)
    await derivePhotoAlbums([{ path: '/photos/Familie 2026', name: 'Familie' }], nas.list)
    assert.deepEqual(nas.calls.sort(), [
      '/photos/Familie 2026',
      '/photos/Familie 2026/Leer',
      '/photos/Familie 2026/Oma 70',
      '/photos/Familie 2026/Zoo',
    ])
  })

  it('puts albums without a date after the dated ones, newest names first, and gives a folder without pictures no album', async () => {
    const nas = fakeNas({
      '/p': [dir('/p/2019'), dir('/p/2025'), dir('/p/Dated', 'Wed, 01 Jan 2020 00:00:00 GMT'), dir('/p/Nichts')],
      '/p/2019': [file('/p/2019/a.jpg')],
      '/p/2025': [file('/p/2025/a.jpg')],
      '/p/Dated': [file('/p/Dated/a.jpg')],
      '/p/Nichts': [file('/p/Nichts/readme.txt')],
    })
    const albums = await derivePhotoAlbums([{ path: '/p', name: 'p' }], nas.list)
    assert.deepEqual(
      albums.map((a) => a.name),
      ['Dated', '2025', '2019'],
    )
  })

  it('cuts a folder with too many subfolders at the newest names', async () => {
    const nas = fakeNas({
      '/p': [dir('/p/2019'), dir('/p/2025'), dir('/p/2021')],
      '/p/2019': [file('/p/2019/a.jpg')],
      '/p/2025': [file('/p/2025/a.jpg')],
      '/p/2021': [file('/p/2021/a.jpg')],
    })
    const albums = await derivePhotoAlbums([{ path: '/p', name: 'p' }], nas.list, 2)
    assert.deepEqual(
      albums.map((a) => a.name),
      ['2025', '2021'],
    )
  })

  it('passes a source that is away through', async () => {
    const nas = fakeNas({ '/p': [dir('/p/gone')] })
    await assert.rejects(derivePhotoAlbums([{ path: '/p', name: 'p' }], nas.list), PhotoSourceOffline)
  })
})

describe('sortPhotos', () => {
  it('orders by name with numbers as numbers', () => {
    const sorted = sortPhotos([{ name: 'IMG_10.jpg' }, { name: 'img_2.jpg' }, { name: 'IMG_1.jpg' }])
    assert.deepEqual(
      sorted.map((p) => p.name),
      ['IMG_1.jpg', 'img_2.jpg', 'IMG_10.jpg'],
    )
  })
})

describe('photoPathAllowed', () => {
  const roots = [{ path: '/photos/Familie 2026', name: 'Familie' }]
  it('allows the chosen folder, its albums and their pictures', () => {
    assert.ok(photoPathAllowed(roots, '/photos/Familie 2026'))
    assert.ok(photoPathAllowed(roots, '/photos/Familie 2026/IMG_loose_1.jpg'))
    assert.ok(photoPathAllowed(roots, 'photos/Familie 2026/Zoo/IMG_0001.jpg'))
  })
  it('refuses everything else', () => {
    assert.equal(photoPathAllowed(roots, '/photos/Familie 2026x/a.jpg'), undefined)
    assert.equal(photoPathAllowed(roots, '/photos/Urlaub/a.jpg'), undefined)
    assert.equal(photoPathAllowed(roots, '/photos/Familie 2026/Zoo/Tag 1/a.jpg'), undefined)
    assert.equal(photoPathAllowed(roots, '/photos/Familie 2026/../Privat/a.jpg'), undefined)
    assert.equal(photoPathAllowed([], '/photos/Familie 2026'), undefined)
  })
})

describe('album ids', () => {
  it('name the source and come back as the path', () => {
    assert.equal(albumId('photos/Familie 2026/Zoo/'), 'nas:/photos/Familie 2026/Zoo')
    assert.equal(albumPath('nas:/photos/Familie 2026/Zoo'), '/photos/Familie 2026/Zoo')
    assert.equal(albumPath('smb:/photos'), undefined)
    assert.equal(albumPath('nas:/'), undefined)
    assert.equal(albumPath('nas:/a/../b'), undefined)
  })
})
