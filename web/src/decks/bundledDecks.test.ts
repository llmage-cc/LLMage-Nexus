// Lazy loader contract for the bundled deck corpus.
//
// The asset is 5.5 MB of JSON: it must never be fetched or parsed on the
// synchronous login path (the offline-image-index lesson). These tests pin that
// contract, the one-shot caching, the retry-on-failure behavior and the deck
// expansion (basic lands filled client-side).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  bundledCorpusDecks,
  bundledCorpusLoaded,
  bundledCorpusManifest,
  bundledDecksAssetUrl,
  loadBundledCorpus,
  setBundledCorpusForTests,
} from './bundledDecks'
import type { BundledDecksFile } from './builtinDecklist'

const HERE = path.dirname(fileURLToPath(import.meta.url))

function resolveAsset(): string {
  const candidates = [HERE, path.join(process.cwd(), 'src', 'data'), path.join(process.cwd(), 'web', 'src', 'data')]
  for (const dir of candidates) {
    const p = path.join(dir, 'bundledDecks.generated.json')
    if (fs.existsSync(p)) return p
  }
  throw new Error('bundledDecks.generated.json not found from ' + HERE)
}

const ASSET = JSON.parse(fs.readFileSync(resolveAsset(), 'utf8')) as BundledDecksFile

const okResponse = (file: BundledDecksFile) => ({ ok: true, json: async () => file }) as unknown as Response

describe('bundledDecks lazy loader', () => {
  beforeEach(() => {
    // test-setup already reset the singleton, but be explicit for this file.
    setBundledCorpusForTests(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('is lazy: importing the module does not fetch, and the sync view is empty', async () => {
    vi.resetModules()
    const notFetch = vi.fn(() => new Promise<never>(() => {}))
    vi.stubGlobal('fetch', notFetch as never)
    const mod = await import('./bundledDecks')
    expect(notFetch).not.toHaveBeenCalled()
    expect(mod.bundledCorpusLoaded()).toBe(false)
    expect(mod.bundledCorpusDecks()).toEqual([])
    expect(mod.bundledCorpusManifest()).toBeNull()
  })

  it('loads the committed asset once and caches it for the session', async () => {
    const fetchSpy = vi.fn(async (_url: unknown) => okResponse(ASSET))
    vi.stubGlobal('fetch', fetchSpy as never)

    // Before the first load the URL getter is empty (the asset URL is only
    // resolved inside the loader — the old static `?url` import made this
    // module un-importable from plain Node, killing the 44 e2e specs that
    // reach it via fixtures/deck-names.ts).
    expect(bundledDecksAssetUrl()).toBe('')

    const first = await loadBundledCorpus()
    const second = await loadBundledCorpus()

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    // The pin: the single fetch went to the loader-resolved asset URL (still
    // the committed `bundledDecks.generated.json`), and it is now cached —
    // the getter returns what the fetch was called with.
    const fetchedUrl = String(fetchSpy.mock.calls[0][0])
    expect(fetchedUrl).toMatch(/bundledDecks\.generated\.json/)
    expect(bundledDecksAssetUrl()).toBe(fetchedUrl)
    expect(fetchSpy).toHaveBeenCalledWith(bundledDecksAssetUrl())
    expect(first).toBe(second) // the same parsed array, not a re-parse
    expect(first).toHaveLength(5013)
    expect(bundledCorpusLoaded()).toBe(true)
    expect(bundledCorpusDecks()).toHaveLength(5013)
    expect(bundledCorpusManifest()?.decks).toBe(5013)
    expect(bundledCorpusManifest()?.majors).toBe(3841)
  })

  it('expands the tuples and fills basic-land printings client-side', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse(ASSET)) as never)
    const decks = await loadBundledCorpus()
    const withMountain = decks.find((d) => d.cards.some((c) => c.cardName === 'Mountain'))
    expect(withMountain).toBeDefined()
    const mountain = withMountain!.cards.find((c) => c.cardName === 'Mountain')!
    // normalizeDeckCard fills the preset printing of a plain basic land.
    expect(mountain.setCode).not.toBe('')
    expect(mountain.cardNumber).not.toBe('')
    // Every corpus id survives the load (the loader re-orders the list into the
    // old picker's library order, so the head is Legacy's first deck A–Z).
    expect(new Set(decks.map((d) => d.id)).size).toBe(ASSET.decks.length)
    expect(decks[0].id).toBe('majors:Legacy/2779_Grand_Prix_Atlanta/5-8__1_Land_Belcher_by_Gerardo_Fedon.txt')
  })

  it('does not cache a failed load: the next call retries', async () => {
    const rejecting = vi.fn(async () => ({ ok: false, status: 500 }) as unknown as Response)
    vi.stubGlobal('fetch', rejecting as never)
    await expect(loadBundledCorpus()).rejects.toThrow(/bundled decks asset failed/)
    expect(bundledCorpusLoaded()).toBe(false)

    vi.stubGlobal('fetch', vi.fn(async () => okResponse(ASSET)) as never)
    await expect(loadBundledCorpus()).resolves.toHaveLength(5013)
  })

  it('exposes a test seam that overrides the loaded corpus', () => {
    setBundledCorpusForTests([{ id: 'x', name: 'X', cards: [], sideboard: [] }], {
      decks: 1, majors: 0, sample: 0, byFormat: { Freeform: 1 }, byGroup: { Freeform: 1 },
    })
    expect(bundledCorpusDecks()).toHaveLength(1)
    expect(bundledCorpusLoaded()).toBe(true)
  })
})

describe('bundled decks asset perf guard', () => {
  it('stays under the size bound (5.5 MB raw, well below the object-shape 14.6 MB)', () => {
    const bytes = fs.statSync(resolveAsset()).size
    expect(bytes).toBeGreaterThan(0)
    expect(bytes).toBeLessThan(8_000_000)
  })

  it('kept the compact tuple encoding (no per-card object keys)', () => {
    // A tuple is [amount, name(, set, num)] — no `cardName`/`amount` string keys
    // inflating every one of the ~190k card entries.
    expect(ASSET.decks[0].cards[0].length).toBeGreaterThanOrEqual(2)
    expect(JSON.stringify(ASSET.decks[0].cards[0])).not.toContain('cardName')
  })
})
