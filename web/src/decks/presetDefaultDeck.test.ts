// Pinning test: the curated preset default deck ('Boros Burn', GP
// Birmingham 2017 winner) comes from the bundled mtgtop8 corpus AND passes the
// SAME deck-validation shape the picker flow uses (`requestDeckValidation` →
// `fetchDeckIssues` → `validateDeck` on the wire). The wire is stubbed at the
// gateway (never a live proxy): the empty report = the deck has no issues.
import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setGateway } from '../net/commands'
import type { Gateway } from '../net/Gateway'
import type { DeckValidationResult } from '../net/types'
import { PRESET_DEFAULT_DECK_NAME } from '../lobby/decks'
import { requestDeckValidation } from '../lobby/DeckIssuesDialog'
import { expandBundledCard, type BundledDecksFile } from './builtinDecklist'
import { normalizeDeckCards, prepareDeckForXMage } from './deckNormalize'

// Read the committed asset DIRECTLY (same loader the bundledDecks tests use)
// and transform the entry through the SAME code path `decks/bundledDecks.ts`
// runs at runtime — no lazy fetch, no proxy.
const HERE = path.dirname(fileURLToPath(import.meta.url))

function resolveAsset(): string {
  const candidates = [HERE, path.join(process.cwd(), 'src', 'data'), path.join(process.cwd(), 'web', 'src', 'data')]
  for (const dir of candidates) {
    const p = path.join(dir, 'bundledDecks.generated.json')
    if (fs.existsSync(p)) return p
  }
  throw new Error('bundledDecks.generated.json not found from ' + HERE)
}

const asset = JSON.parse(fs.readFileSync(resolveAsset(), 'utf8')) as BundledDecksFile
const entry = asset.decks.find((d) => d.name === PRESET_DEFAULT_DECK_NAME)

function presetDeckForTest() {
  if (!entry) throw new Error(`corpus asset has no '${PRESET_DEFAULT_DECK_NAME}' entry — the curated deck drifted`)
  return {
    id: entry.id,
    name: entry.name,
    cards: normalizeDeckCards(entry.cards.map(expandBundledCard)),
    sideboard: normalizeDeckCards(entry.sideboard.map(expandBundledCard)),
  }
}

afterEach(() => {
  setGateway(null)
  vi.restoreAllMocks()
})

describe('PRESET_DEFAULT_DECK_NAME ships deck-valid (mocked wire, no proxy)', () => {
  it('the committed corpus carries exactly one such deck, full 60-card main + sideboard', () => {
    const matches = asset.decks.filter((d) => d.name === PRESET_DEFAULT_DECK_NAME)
    expect(matches).toHaveLength(1)
    const deck = presetDeckForTest()
    expect(deck.name).toBe(PRESET_DEFAULT_DECK_NAME)
    expect(deck.cards.reduce((n, c) => n + c.amount, 0)).toBe(60)
    expect(deck.sideboard.reduce((n, c) => n + c.amount, 0)).toBe(15)
    // aggro-ish: plenty of 4-ofs (creatures + cheap spells), not a lands wall
    expect(deck.cards.filter((c) => c.amount === 4).length).toBeGreaterThanOrEqual(8)
  })

  it('requestDeckValidation accepts the assembled+prepared deck (empty issues report)', async () => {
    const deck = presetDeckForTest()
    const prepared = prepareDeckForXMage(deck, 'Constructed - Modern', 'Two Player Duel')
    const report: DeckValidationResult = { ready: true, missing: [], mismatches: [] }
    const send = vi.fn().mockResolvedValue({ ok: true, data: report })
    setGateway({ send } as unknown as Gateway)

    await expect(requestDeckValidation(prepared)).resolves.toBe(prepared)
    expect(send).toHaveBeenCalledOnce()
    const [action, payload] = send.mock.calls[0] as [string, { deck: { name: string; cards: unknown[]; sideboard: unknown[] } }]
    expect(action).toBe('validateDeck')
    // the deck that reached the wire IS the curated deck (name + main + sideboard)
    expect(payload.deck.name).toBe(PRESET_DEFAULT_DECK_NAME)
    expect(payload.deck.cards).toHaveLength(prepared.cards.length)
    expect(payload.deck.sideboard).toHaveLength(prepared.sideboard.length)
  })

  it('a flagged deck still opens the repair dialog (the gate is real, not a rubber stamp)', async () => {
    const deck = presetDeckForTest()
    const report: DeckValidationResult = {
      ready: true,
      missing: [{ cardName: 'Goblin Guide', setCode: 'ZEN', cardNumber: '125', amount: 4, reason: 'UNIMPLEMENTED', suggestions: [] }],
      mismatches: [],
    }
    const send = vi.fn().mockResolvedValue({ ok: true, data: report })
    setGateway({ send } as unknown as Gateway)
    // no user to answer the modal: the promise stays pending, never resolves ok
    let settled = false
    void requestDeckValidation(deck).then(() => { settled = true })
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(settled).toBe(false)
    expect(send).toHaveBeenCalledOnce()
  })
})