import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cdnUrl,
  foldName,
  hasBackFace,
  loadImageIndex,
  lookupCardUuid,
  lookupPrinting,
  lookupTokenArt,
  resolveArtUrl,
  resolveCardRefImage,
  resolveKeyImage,
  setImageIndexForTests,
  type ScryfallImageIndex,
} from './offlineIndex'

const UUID_A = '435589bb-27c6-4a6d-9d63-394d5092b9d8'
const UUID_B = '11bf83bb-c95b-4b4f-9a56-ce7a1816307a'
const UUID_C = 'b27dc0bd-ba46-4a5c-9559-7c11eb4ec37b'
const UUID_T = '720f3e68-84c0-462e-a0d1-90236ccc494a'

function makeIndex(): ScryfallImageIndex {
  return {
    cards: {
      'Lightning Bolt': UUID_A,
      'Adewale, Breaker of Chains': UUID_B, // fold target check via foldName below
      'Delver of Secrets': UUID_B,
    },
    backs: new Set(['Delver of Secrets']),
    printings: {
      'm10/146': [UUID_A, 'Lightning Bolt'],
      'isd/51': [UUID_B, 'Delver of Secrets'],
      'tgrn/4': [UUID_C, 'Goblin'],
    },
    tokenArts: {
      Goblin: [{ id: UUID_C, set: 'tgrn', num: '4', released: '2018-10-05' }],
      'Ral, Izzet Viceroy Emblem': [
        { id: UUID_T, set: 'tgrn', num: '7', released: null },
        { id: UUID_T, set: 'tgrn', num: '7', released: null },
      ],
    },
  }
}

describe('offlineIndex', () => {
  beforeEach(() => {
    setImageIndexForTests(makeIndex())
  })
  afterEach(() => {
    setImageIndexForTests(null)
    vi.restoreAllMocks()
  })

  it('builds CDN urls from a uuid (front and back, all sizes)', () => {
    expect(cdnUrl(UUID_A, 'normal')).toBe(`https://cards.scryfall.io/normal/front/4/3/${UUID_A}.jpg`)
    expect(cdnUrl(UUID_A, 'small', true)).toBe(`https://cards.scryfall.io/small/back/4/3/${UUID_A}.jpg`)
    expect(cdnUrl(UUID_A, 'art_crop')).toBe(`https://cards.scryfall.io/art_crop/front/4/3/${UUID_A}.jpg`)
  })

  it('folds accents the same way the builder does', () => {
    expect(foldName('Adéwalé, Breaker of Chains')).toBe('Adewale, Breaker of Chains')
    expect(foldName('Plain Name')).toBe('Plain Name')
  })

  it('looks up a card by exact and folded name', () => {
    expect(lookupCardUuid(makeIndex(), 'Lightning Bolt')).toBe(UUID_A)
    expect(lookupCardUuid(makeIndex(), 'Adéwalé, Breaker of Chains')).toBe(UUID_B)
    expect(lookupCardUuid(makeIndex(), 'Nothing')).toBeNull()
  })

  it('knows which names have a back face', () => {
    expect(hasBackFace(makeIndex(), 'Delver of Secrets')).toBe(true)
    expect(hasBackFace(makeIndex(), 'Lightning Bolt')).toBe(false)
  })

  it('looks up printings case-insensitively', () => {
    expect(lookupPrinting(makeIndex(), 'M10', '146')).toEqual({ uuid: UUID_A, name: 'Lightning Bolt' })
    expect(lookupPrinting(makeIndex(), 'm10', '146')).toEqual({ uuid: UUID_A, name: 'Lightning Bolt' })
    expect(lookupPrinting(makeIndex(), '', '146')).toBeNull()
    expect(lookupPrinting(makeIndex(), 'M10', '')).toBeNull()
  })

  it('prefers the engine set for token art and falls back to the first art', () => {
    const art = lookupTokenArt(makeIndex(), 'Goblin Token', 'tgrn')
    expect(art).toEqual({ uuid: UUID_C, name: 'Goblin' })
    const anySet = lookupTokenArt(makeIndex(), 'Goblin')
    expect(anySet?.uuid).toBe(UUID_C)
    expect(lookupTokenArt(makeIndex(), 'Soldier')).toBeNull()
  })

  describe('resolveKeyImage', () => {
    it('named: keys resolve and apply the back face only for DFCs', () => {
      expect(resolveKeyImage(makeIndex(), 'named:Lightning Bolt')).toEqual({
        url: `https://cards.scryfall.io/normal/front/4/3/${UUID_A}.jpg`,
        name: 'Lightning Bolt',
      })
      expect(resolveKeyImage(makeIndex(), 'named:Delver of Secrets#back')).toEqual({
        url: `https://cards.scryfall.io/normal/back/1/1/${UUID_B}.jpg`,
        name: 'Delver of Secrets',
      })
      expect(resolveKeyImage(makeIndex(), 'named:Nothing')).toBeNull()
    })

    it('SET/num keys resolve via the printing map (back face for DFCs)', () => {
      expect(resolveKeyImage(makeIndex(), 'M10/146')?.url).toBe(`https://cards.scryfall.io/normal/front/4/3/${UUID_A}.jpg`)
      expect(resolveKeyImage(makeIndex(), 'ISD/51#back')?.url).toBe(`https://cards.scryfall.io/normal/back/1/1/${UUID_B}.jpg`)
      expect(resolveKeyImage(makeIndex(), 'UZZ/1')).toBeNull()
    })

    it('t-set keys resolve via the printing map first', () => {
      expect(resolveKeyImage(makeIndex(), 'tgrn/4')?.url).toBe(`https://cards.scryfall.io/normal/front/b/2/${UUID_C}.jpg`)
    })

    it('falls back to the token art table for t-sets the printing map lacks (case-insensitive slug)', () => {
      expect(resolveKeyImage(makeIndex(), 'tzzz/goblin')).toEqual({
        url: `https://cards.scryfall.io/normal/front/b/2/${UUID_C}.jpg`,
        name: 'Goblin',
      })
      expect(resolveKeyImage(makeIndex(), 'tzzz/soldier')).toBeNull()
    })

    it('requests the size it is asked for', () => {
      expect(resolveKeyImage(makeIndex(), 'M10/146', 'small')?.url).toContain('/small/')
      expect(resolveKeyImage(makeIndex(), 'M10/146', 'art_crop')?.url).toContain('/art_crop/')
    })
  })

  describe('resolveCardRefImage', () => {
    it('prefers the printing, then the exact/folded name', () => {
      expect(resolveCardRefImage(makeIndex(), { cardName: 'Lightning Bolt', setCode: 'M10', cardNumber: '146' }))
        .toBe(`https://cards.scryfall.io/art_crop/front/4/3/${UUID_A}.jpg`)
      expect(resolveCardRefImage(makeIndex(), { cardName: 'Lightning Bolt', setCode: 'ZZZ', cardNumber: '1' }))
        .toBe(`https://cards.scryfall.io/art_crop/front/4/3/${UUID_A}.jpg`)
      expect(resolveCardRefImage(makeIndex(), { cardName: 'Adéwalé, Breaker of Chains' }))
        .toBe(`https://cards.scryfall.io/art_crop/front/1/1/${UUID_B}.jpg`)
      expect(resolveCardRefImage(makeIndex(), { cardName: 'Nothing' })).toBeNull()
      expect(resolveCardRefImage(makeIndex(), {})).toBeNull()
    })
  })

  it('resolveArtUrl awaits the index and never throws', async () => {
    await expect(resolveArtUrl({ cardName: 'Lightning Bolt' })).resolves.toBe(`https://cards.scryfall.io/art_crop/front/4/3/${UUID_A}.jpg`)
    setImageIndexForTests(null)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    await expect(resolveArtUrl({ cardName: 'Lightning Bolt' })).resolves.toBeNull()
  })
})

describe('loadImageIndex', () => {
  afterEach(() => {
    setImageIndexForTests(null)
    vi.restoreAllMocks()
  })

  it('fetches the three assets once and caches the parsed index', async () => {
    setImageIndexForTests(null)
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        url.includes('cards')
          ? { cards: { X: UUID_A }, backs: [] }
          : url.includes('printings')
            ? { printings: {} }
            : { tokens: {} },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const first = await loadImageIndex()
    const second = await loadImageIndex()
    expect(second).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(first.cards.X).toBe(UUID_A)
    expect(first.backs.has('X')).toBe(false)
  })

  it('retries after a failed load instead of caching the failure', async () => {
    setImageIndexForTests(null)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    await expect(loadImageIndex()).rejects.toThrow()
    await expect(loadImageIndex()).resolves.toBeTruthy()
  })
})
