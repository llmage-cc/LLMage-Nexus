import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  bundledDecks,
  bundledDecksEnabled,
  DECKS,
  DEFAULT_DECK,
  findPresetDefaultDeck,
  getAllAvailableDecks,
  getAllAvailableDecksAsync,
  presetDefaultDeck,
  PRESET_DEFAULT_DECK_NAME,
  type Deck,
} from './decks'
import { setBundledCorpusForTests } from '../decks/bundledDecks'

// `bundledDecks()` gates the shipped precons on the VITE_BUNDLED_DECKS build flag
// (default ON, so a production `npm run build` ships them; un-gated from the DEV-only
// check that used to make a prod artifact start with no decks at all).

describe('bundledDecks', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('ships the built-in decks by default (unset flag)', () => {
    expect(bundledDecksEnabled()).toBe(true)
    expect(bundledDecks()).toEqual(DECKS)
    expect(bundledDecks().length).toBeGreaterThan(0)
  })

  it('keeps them on when the flag is explicitly truthy, even in a production build', () => {
    // A production build has DEV=false; the decks must not be tied to DEV any more.
    vi.stubEnv('DEV', false)
    vi.stubEnv('PROD', true)
    vi.stubEnv('VITE_BUNDLED_DECKS', '1')
    expect(bundledDecksEnabled()).toBe(true)
    expect(bundledDecks()).toEqual(DECKS)

    vi.stubEnv('VITE_BUNDLED_DECKS', 'true')
    expect(bundledDecks()).toEqual(DECKS)
  })

  it('drops them when the flag turns them off', () => {
    vi.stubEnv('VITE_BUNDLED_DECKS', '0')
    expect(bundledDecksEnabled()).toBe(false)
    expect(bundledDecks()).toEqual([])

    vi.stubEnv('VITE_BUNDLED_DECKS', 'false')
    expect(bundledDecks()).toEqual([])
  })

  it('treats a blank flag as the default (on)', () => {
    vi.stubEnv('VITE_BUNDLED_DECKS', '')
    expect(bundledDecks()).toEqual(DECKS)
  })
})

describe('getAllAvailableDecks precon entries', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('includes the precon: entries for the built-in decks when on', () => {
    const decks = getAllAvailableDecks()
    const precons = decks.filter((d) => d.id?.startsWith('precon:'))
    expect(precons.map((d) => d.name).sort()).toEqual(DECKS.map((d) => d.name).sort())
  })

  it('has no precon: entries when the flag is off', () => {
    vi.stubEnv('VITE_BUNDLED_DECKS', '0')
    const decks = getAllAvailableDecks()
    expect(decks.filter((d) => d.id?.startsWith('precon:'))).toEqual([])
  })
})

describe('preset default deck (real bundled corpus deck, not the e2e lands deck)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('resolves by name FROM the bundled corpus (not DEFAULT_DECK, not a copy in decks.ts)', () => {
    const corpus: Deck = {
      id: 'majors:Modern/16525_Grand_Prix_Birmingham_2017/1__Boros_Burn_by_loic_le_briand.txt',
      name: PRESET_DEFAULT_DECK_NAME,
      cards: [{ cardName: 'Lightning Bolt', setCode: '', cardNumber: '', amount: 4 }],
      sideboard: [{ cardName: 'Path to Exile', setCode: '', cardNumber: '', amount: 2 }],
    }
    setBundledCorpusForTests([corpus])
    const found = findPresetDefaultDeck()
    expect(found).toBe(corpus) // identity: the SAME bundled object, not a re-declaration
    expect(found).not.toBe(DEFAULT_DECK)
    expect(presetDefaultDeck()).toBe(corpus)
  })

  it('finds the first bundled entry when several share the curated name', () => {
    const first: Deck = { ...DEFAULT_DECK, name: PRESET_DEFAULT_DECK_NAME, id: 'x1' }
    const second: Deck = { ...DEFAULT_DECK, name: PRESET_DEFAULT_DECK_NAME, id: 'x2' }
    setBundledCorpusForTests([first, second])
    expect(findPresetDefaultDeck()).toBe(first)
  })

  it('is absent before the corpus load lands or with the flag off, and presetDefaultDeck() fails fast', () => {
    setBundledCorpusForTests(null)
    expect(findPresetDefaultDeck()).toBeUndefined()
    expect(() => presetDefaultDeck()).toThrow(/Boros Burn/)

    vi.stubEnv('VITE_BUNDLED_DECKS', '0')
    setBundledCorpusForTests([{ ...DEFAULT_DECK, name: PRESET_DEFAULT_DECK_NAME }])
    expect(findPresetDefaultDeck()).toBeUndefined()
  })

  it('the curated name differs from every hardcoded sample deck (the e2e lands deck stays out of the preset)', () => {
    expect(DECKS.some((d) => d.name === PRESET_DEFAULT_DECK_NAME)).toBe(false)
    expect(PRESET_DEFAULT_DECK_NAME).not.toBe(DEFAULT_DECK.name)
  })

  // The Create-Table wizard's DEFAULT SIM deck consumes this resolver — the
  // pins below are what its default/fallback selection relies on.
  it('the resolved corpus deck is part of getAllAvailableDecks() (the wizard can resolve its stable ref)', () => {
    const corpus: Deck = {
      id: 'majors:Modern/16525_Grand_Prix_Birmingham_2017/1__Boros_Burn_by_loic_le_briand.txt',
      name: PRESET_DEFAULT_DECK_NAME,
      cards: [{ cardName: 'Lightning Bolt', setCode: '', cardNumber: '', amount: 4 }],
      sideboard: [],
    }
    setBundledCorpusForTests([corpus])
    const found = findPresetDefaultDeck()
    expect(found).toBeDefined()
    const listed = getAllAvailableDecks().find((d) => d.id === found!.id)
    expect(listed).toBeDefined() // in the picker's list → deckRef(resolved) resolves in the form
    expect(listed!.name).toBe(PRESET_DEFAULT_DECK_NAME)
    expect(listed!.cards.reduce((s, c) => s + c.amount, 0)).toBeGreaterThan(0)
  })

  it('absence semantics the wizard fallback relies on (undefined → bundled-list head, never a throw)', () => {
    // corpus not loaded (the setup file resets the seam) → undefined, and the
    // wizard's defaultSimDeck falls back to getAllAvailableDecks()[0] = DECKS[0]
    setBundledCorpusForTests(null)
    expect(findPresetDefaultDeck()).toBeUndefined()
    expect(getAllAvailableDecks()[0]?.name).toBe(DEFAULT_DECK.name)
  })
})

describe('bundled corpus wiring (lazy 5,013-deck asset)', () => {
  const corpusDeck = (id: string, name: string): Deck => ({
    id,
    name,
    cards: [{ cardName: 'Brainstorm', setCode: '', cardNumber: '', amount: 4 }],
    sideboard: [],
  })

  // Node 26 exposes an experimental bare `localStorage` that is unusable here; the
  // repo convention (see storage.idb.test.ts) is to stub a Map-backed one.
  const lsMap = new Map<string, string>()
  const fakeLS = {
    getItem: (k: string) => lsMap.get(k) ?? null,
    setItem: (k: string, v: string) => { lsMap.set(k, v) },
    removeItem: (k: string) => { lsMap.delete(k) },
    clear: () => { lsMap.clear() },
    key: () => null,
    length: 0,
  }

  beforeEach(() => {
    lsMap.clear()
    vi.stubGlobal('localStorage', fakeLS)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    setBundledCorpusForTests(null)
  })

  it('merges the corpus into bundledDecks() and getAllAvailableDecks() with its stable id', () => {
    setBundledCorpusForTests([corpusDeck('majors:Legacy/x', 'Monastery Miracles')])
    const bundled = bundledDecks()
    expect(bundled.length).toBe(DECKS.length + 1)
    expect(bundled.some((d) => d.name === 'Monastery Miracles')).toBe(true)
    const entry = getAllAvailableDecks().find((d) => d.name === 'Monastery Miracles')
    expect(entry?.id).toBe('majors:Legacy/x')
  })

  it('drops the corpus too when the bundled-decks flag is off', () => {
    vi.stubEnv('VITE_BUNDLED_DECKS', '0')
    setBundledCorpusForTests([corpusDeck('majors:Legacy/x', 'Monastery Miracles')])
    expect(bundledDecks()).toEqual([])
    expect(getAllAvailableDecks().some((d) => d.name === 'Monastery Miracles')).toBe(false)
  })

  it('a user v2 deck with the same name does not shadow the corpus deck', () => {
    setBundledCorpusForTests([corpusDeck('majors:Legacy/x', 'Netdeck')])
    fakeLS.setItem(
      'mage_decks_v2',
      JSON.stringify([{ name: 'Netdeck', cards: [], sideboard: [] }]),
    )
    const matches = getAllAvailableDecks().filter((d) => d.name === 'Netdeck')
    // Both survive: the bundled precon (its own id) and the user's deck (v2:).
    expect(matches.map((d) => d.id).sort()).toEqual(['majors:Legacy/x', 'v2:Netdeck'])
  })

  it('getAllAvailableDecksAsync() awaits the corpus load before returning', async () => {
    const file = {
      generated: 'x',
      source: 'builtin-decks.sh',
      manifest: { decks: 1, majors: 1, sample: 0, byFormat: { Legacy: 1 }, byGroup: { Legacy: 1 } },
      decks: [{ id: 'majors:x', name: 'Fetched Deck', format: 'Legacy', group: 'Legacy', source: 'majors', cards: [[4, 'Brainstorm']], sideboard: [] }],
    }
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => file })) as never)
    const all = await getAllAvailableDecksAsync()
    expect(all.some((d) => d.id === 'majors:x' && d.name === 'Fetched Deck')).toBe(true)
  })
})
