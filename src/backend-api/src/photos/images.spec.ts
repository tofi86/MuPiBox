import assert from 'node:assert'
import { describe, it } from 'node:test'
import { limitFetches, photoSizePx } from './images'
import type { PhotoEntry, PhotoSource } from './source'

describe('limitFetches', () => {
  it('lets two downloads run at once and the rest wait in order', async () => {
    let running = 0
    let most = 0
    const order: string[] = []
    const resolvers: (() => void)[] = []
    const source: PhotoSource = {
      list: async (): Promise<PhotoEntry[]> => [],
      fetchToTemp: async (p) => {
        running++
        most = Math.max(most, running)
        order.push(p)
        await new Promise<void>((resolve) => resolvers.push(resolve))
        running--
        return p
      },
    }
    const limited = limitFetches(source, 2)
    const results = Promise.all(['a', 'b', 'c', 'd'].map((p) => limited.fetchToTemp(p)))
    await new Promise((r) => setImmediate(r))
    assert.deepEqual(order, ['a', 'b'])
    resolvers.shift()?.()
    await new Promise((r) => setImmediate(r))
    assert.deepEqual(order, ['a', 'b', 'c'])
    while (resolvers.length) resolvers.shift()?.()
    await new Promise((r) => setImmediate(r))
    while (resolvers.length) resolvers.shift()?.()
    assert.deepEqual(await results, ['a', 'b', 'c', 'd'])
    assert.equal(most, 2)
  })

  it('skips a download whose asker is gone', async () => {
    const fetched: string[] = []
    const source: PhotoSource = {
      list: async (): Promise<PhotoEntry[]> => [],
      fetchToTemp: async (p) => {
        fetched.push(p)
        return p
      },
    }
    const limited = limitFetches(source, 1)
    assert.equal(await limited.fetchToTemp('gone', () => true), undefined)
    assert.equal(await limited.fetchToTemp('here', () => false), 'here')
    assert.deepEqual(fetched, ['here'])
  })

  it('frees the slot when a download fails', async () => {
    const source: PhotoSource = {
      list: async (): Promise<PhotoEntry[]> => [],
      fetchToTemp: async (p) => {
        if (p === 'bad') throw new Error('gone')
        return p
      },
    }
    const limited = limitFetches(source, 1)
    await assert.rejects(limited.fetchToTemp('bad'))
    assert.equal(await limited.fetchToTemp('good'), 'good')
  })
})

describe('photoSizePx', () => {
  it('grows the tile with the display, never the screen picture', () => {
    assert.equal(photoSizePx('thumb', 1), 400)
    assert.equal(photoSizePx('thumb', 1.28), 512)
    assert.equal(photoSizePx('screen', 1.5), 1600)
  })
})
