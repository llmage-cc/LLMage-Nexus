import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { Dispatch, SetStateAction } from 'react'
import { ADVANCED_DECK, DEFAULT_DECK, PRESET_DEFAULT_DECK_NAME, deckRef, type Deck } from '../decks'
import { setBundledCorpusForTests } from '../../decks/bundledDecks'
import { useDeckChoices } from './useDeckChoices'
import type { SeatConfig } from './constants'

// The wizard's DEFAULT SIM/global deck is the
// curated REAL bundled corpus deck ('Boros Burn'), never
// DEFAULT_DECK ('Mage Web bolt', the e2e lands deck); the bundled list head is
// only the fallback while the corpus is absent/disabled. DEFAULT_DECK itself is
// untouched (the e2e harness still selects decks by name).

beforeEach(() => {
  const ls = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => ls.get(k) ?? null,
    setItem: (k: string, v: string) => { ls.set(k, v) },
    removeItem: (k: string) => { ls.delete(k) },
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

/** The corpus deck, injected through the test seam (as the loader would build it). */
const BURN: Deck = {
  id: 'majors:Modern/16525_Grand_Prix_Birmingham_2017/1__Boros_Burn_by_loic_le_briand.txt',
  name: PRESET_DEFAULT_DECK_NAME,
  cards: [{ cardName: 'Lightning Bolt', setCode: '', cardNumber: '', amount: 4 }],
  sideboard: [],
}

/** The `bundledDecks.generated.json` entry shape (compact tuples) for fetch-stubbed loads. */
const BURN_ENTRY = {
  id: BURN.id,
  name: PRESET_DEFAULT_DECK_NAME,
  format: 'Modern',
  group: 'majors',
  source: 'majors',
  cards: [[4, 'Lightning Bolt'], [56, 'Mountain']],
  sideboard: [],
}
const MANIFEST = { decks: 1, majors: 1, sample: 0, byFormat: { Modern: 1 }, byGroup: { majors: 1 } }

async function renderChoices(storeDeck: Deck | null = null) {
  const setSeatConfigs = vi.fn() as unknown as Dispatch<SetStateAction<SeatConfig[]>>
  const hook = renderHook(() => useDeckChoices(storeDeck, setSeatConfigs))
  await act(async () => {}) // flush mount effects
  return { ...hook, setSeatConfigs: setSeatConfigs as unknown as ReturnType<typeof vi.fn> }
}

/** Opens the wizard BEFORE the lazy corpus answers (fetch parked), like a first paint does. */
async function renderBeforeCorpusLands(release: { open: (file: unknown) => void }) {
  // Response-like: `loadBundledCorpus` reads `res.ok` then `res.json()`.
  vi.stubGlobal('fetch', vi.fn(() => new Promise((res) => { release.open = (file) => res({ ok: true, json: async () => file }) })))
  const h = await renderChoices()
  expect(h.result.current.simDeck?.name).toBe(DEFAULT_DECK.name) // still the fallback
  return h
}

describe('useDeckChoices — default SIM deck is the real preset deck', () => {
  it('simDeck defaults to the Boros Burn corpus deck, never the e2e lands deck', async () => {
    setBundledCorpusForTests([BURN])
    const h = await renderChoices()
    expect(h.result.current.simDeck).toBe(BURN) // identity: the same corpus object
    expect(h.result.current.simDeck?.name).toBe(PRESET_DEFAULT_DECK_NAME)
    expect(h.result.current.simDeck?.name).not.toBe(DEFAULT_DECK.name)
    // MY deck still defaults to the bundled list head
    expect(h.result.current.myDeck?.name).toBe(DEFAULT_DECK.name)
    // the global default is not a per-seat stamp (the seat-fill effect lives in the form)
    expect(h.setSeatConfigs).not.toHaveBeenCalled()
  })

  it('simDeck falls back to the bundled list head while the corpus is absent', async () => {
    // corpus stays unloaded (the setup file resets the seam before every test)
    const h = await renderChoices()
    expect(h.result.current.availableDecks[0]?.name).toBe(DEFAULT_DECK.name)
    expect(h.result.current.simDeck?.name).toBe(DEFAULT_DECK.name)
    expect(h.result.current.simDeck?.name).not.toBe(PRESET_DEFAULT_DECK_NAME)
  })

  it('simDeck falls back when the bundled corpus is disabled (VITE_BUNDLED_DECKS=0)', async () => {
    setBundledCorpusForTests([BURN])
    vi.stubEnv('VITE_BUNDLED_DECKS', '0')
    const h = await renderChoices()
    // With the built-in decks off the whole list is empty: no fallback deck exists
    // and simDeck stays unset — submit then goes down the existing no-deck error
    // path (`create_err_no_deck`) instead of seating any harness deck.
    expect(h.result.current.availableDecks).toHaveLength(0)
    expect(h.result.current.simDeck).toBeNull()
  })

  it('re-derives the default when the corpus lands mid-session (wizard opened first)', async () => {
    const release: { open: (file: unknown) => void } = { open: () => {} }
    const h = await renderBeforeCorpusLands(release)
    expect(release.open).toBeInstanceOf(Function)

    await act(async () => {
      release.open({ generated: '', source: '', manifest: MANIFEST, decks: [BURN_ENTRY] })
    })
    await waitFor(() => {
      // the still-un-touched default is re-derived to the corpus preset deck
      expect(h.result.current.simDeck?.name).toBe(PRESET_DEFAULT_DECK_NAME)
      expect(h.result.current.simDeck?.name).not.toBe(DEFAULT_DECK.name)
    })
    // the hook itself never stamps seats (the global default is not a per-seat write)
    expect(h.setSeatConfigs).not.toHaveBeenCalled()
  })

  it('never overrides the user sim choice when the corpus lands mid-session', async () => {
    const release: { open: (file: unknown) => void } = { open: () => {} }
    const h = await renderBeforeCorpusLands(release)

    await act(async () => { h.result.current.selectGlobalSimDeck(deckRef(ADVANCED_DECK)) })
    expect(h.result.current.simDeck?.name).toBe(ADVANCED_DECK.name)

    await act(async () => {
      release.open({ generated: '', source: '', manifest: MANIFEST, decks: [BURN_ENTRY] })
    })
    await waitFor(() => {
      expect(h.result.current.availableDecks.some((d) => d.name === PRESET_DEFAULT_DECK_NAME)).toBe(true)
    })
    // the user's choice survived the corpus arrival (no re-derive over touched state)
    expect(h.result.current.simDeck?.name).toBe(ADVANCED_DECK.name)
  })
})