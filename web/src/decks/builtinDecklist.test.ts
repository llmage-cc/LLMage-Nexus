// Transform + committed-asset guard for the built-in deck corpus.
//
// The asset (`src/data/bundledDecks.generated.json`, ~5.5 MB) is read via fs +
// JSON.parse instead of `import`: a static import would make tsc/vitest parse
// it as a typed module on every build. Assertions are structural + sampled —
// this pins the corpus counts and the parser contract, it is not a data dump.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildBundledDecksFile,
  expandBundledCard,
  parseBuiltinDeckList,
  type BundledDecksFile,
  type BuiltinCorpus,
} from './builtinDecklist'
import { parseDck, exportDck } from './parseDck'
import { normalizeDeckCard } from './deckNormalize'
import type { Deck, DeckCard } from '../lobby/decks'

const HERE = path.dirname(fileURLToPath(import.meta.url))

function resolveDataDir(): string {
  const candidates = [HERE, path.join(process.cwd(), 'src', 'data'), path.join(process.cwd(), 'web', 'src', 'data')]
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'bundledDecks.generated.json'))) return dir
  }
  throw new Error('bundledDecks.generated.json not found from ' + HERE)
}

const ASSET_PATH = path.join(resolveDataDir(), 'bundledDecks.generated.json')

describe('parseBuiltinDeckList — corpus decklist grammar', () => {
  it('splits a plain-name (mtgtop8 majors) deck into main + sideboard', () => {
    const text = [
      'NAME:Monastery Miracles (Claudio Bonanni)',
      'AUTHOR:Claudio Bonanni',
      '4 Brainstorm',
      '4 Sensei\'s Divining Top',
      'SB: 2 Pyroblast',
      'SB: 1 Wear // Tear',
    ].join('\n')
    const { cards, sideboard } = parseBuiltinDeckList(text)
    expect(cards).toEqual([[4, 'Brainstorm'], [4, "Sensei's Divining Top"]])
    // Plain names keep no printing: the proxy resolves them by name.
    expect(sideboard).toEqual([[2, 'Pyroblast'], [1, 'Wear // Tear']])
  })

  it('keeps the [SET:NUM] printing of a sample deck line', () => {
    const { cards } = parseBuiltinDeckList('1 [TMP:15] Cloudchaser Eagle\n2 [7ED:350] Underground River')
    expect(cards).toEqual([
      [1, 'Cloudchaser Eagle', 'TMP', '15'],
      [2, 'Underground River', '7ED', '350'],
    ])
  })

  it('canonicalises a basic-land name in any locale', () => {
    const { cards } = parseBuiltinDeckList('4 llanura\n2 Montaña\n1 [DMU:281] Forest')
    expect(cards).toEqual([[4, 'Plains'], [2, 'Mountain'], [1, 'Forest', 'DMU', '281']])
  })

  it('ignores headers, comments and blank lines', () => {
    const { cards, sideboard } = parseBuiltinDeckList('# comment\n\nNAME:x\nAUTHOR:y\nnot a card line\n3 Island')
    expect(cards).toEqual([[3, 'Island']])
    expect(sideboard).toEqual([])
  })
})

describe('transform round-trips through the client .dck parser', () => {
  const roundTrip = (text: string): Deck => {
    const once = parseDck(text)
    expect(once).not.toBeNull()
    const twice = parseDck(exportDck(once as Deck))
    expect(twice).not.toBeNull()
    return twice as Deck
  }

  it('round-trips a plain-name deck (no [SET:NUM])', () => {
    const text = 'NAME:Burn\n4 Lightning Bolt\n20 Mountain\nSB: 2 Pyroblast'
    const deck = roundTrip(text)
    expect(deck.name).toBe('Burn')
    expect(deck.cards.map((c) => [c.cardName, c.amount])).toEqual([
      ['Lightning Bolt', 4],
      // Basic lands get their client-side preset printing on the way through.
      ['Mountain', 20],
    ])
    expect(deck.cards.find((c) => c.cardName === 'Mountain')?.setCode).toBe('DMU')
    expect(deck.sideboard.map((c) => c.cardName)).toEqual(['Pyroblast'])
  })

  it('round-trips a [SET:NUM] deck', () => {
    const deck = roundTrip('NAME:Sample\n1 [TMP:15] Cloudchaser Eagle\nSB: 2 [4ED:218] Red Elemental Blast')
    expect(deck.cards).toEqual([{ cardName: 'Cloudchaser Eagle', setCode: 'TMP', cardNumber: '15', amount: 1 }])
    expect(deck.sideboard).toEqual([{ cardName: 'Red Elemental Blast', setCode: '4ED', cardNumber: '218', amount: 2 }])
  })

  it('agrees with the client parser card-for-card (no drift)', () => {
    const text = 'NAME:Mix\n4 Brainstorm\n1 [TMP:15] Cloudchaser Eagle\n20 Island\nSB: 2 Pyroblast'
    const built = parseBuiltinDeckList(text)
    const client = parseDck(text) as Deck
    // The build-time transform keeps plain names/printings; the client parser and
    // the runtime loader both run normalizeDeckCard (basic-land preset fill), so
    // apply it here to compare like-for-like.
    expect(built.cards.map(expandBundledCard).map(normalizeDeckCard)).toEqual(client.cards)
    expect(built.sideboard.map(expandBundledCard).map(normalizeDeckCard)).toEqual(client.sideboard)
  })
})

describe('buildBundledDecksFile', () => {
  const corpus: BuiltinCorpus = {
    generated: '2026-01-01T00:00:00Z',
    counts: { majors: 1, sample: 1 },
    decks: [
      { id: 'majors:A', source: 'majors', format: 'Legacy', group: 'Legacy', name: 'A', text: 'NAME:A\n4 Brainstorm' },
      { id: 'sample:B', source: 'sample', format: 'Sample', group: '1998', name: 'B', text: '1 [TMP:15] Cloudchaser Eagle' },
    ],
  }

  it('records the deck count and the per-format breakdown', () => {
    const file = buildBundledDecksFile(corpus)
    expect(file.manifest).toMatchObject({ decks: 2, majors: 1, sample: 1 })
    expect(file.manifest.byFormat).toEqual({ Legacy: 1, Sample: 1 })
    expect(file.manifest.byGroup).toEqual({ Legacy: 1, 1998: 1 })
    expect(file.decks.map((d) => d.id)).toEqual(['majors:A', 'sample:B'])
    expect(file.decks[0]).not.toHaveProperty('text')
  })

  it('throws on a duplicate deck id instead of shipping an unaddressable deck', () => {
    const dupe: BuiltinCorpus = { decks: [...corpus.decks, { ...corpus.decks[0] }] }
    expect(() => buildBundledDecksFile(dupe)).toThrow(/duplicate bundled deck id/)
  })
})

describe('bundledDecks.generated.json (committed asset)', () => {
  const file = JSON.parse(fs.readFileSync(ASSET_PATH, 'utf8')) as BundledDecksFile

  it('is the full validated corpus (5,013 decks: 3,841 majors + 1,172 sample)', () => {
    expect(file.manifest.decks).toBe(5013)
    expect(file.manifest.majors).toBe(3841)
    expect(file.manifest.sample).toBe(1172)
    expect(file.decks).toHaveLength(file.manifest.decks)
    expect(Object.values(file.manifest.byFormat).reduce((s, n) => s + n, 0)).toBe(5013)
  })

  it('has a stable, unique id per deck and no duplicated `text` payload', () => {
    const ids = new Set(file.decks.map((d) => d.id))
    expect(ids.size).toBe(file.decks.length)
    expect(file.decks.every((d) => !('text' in d))).toBe(true)
  })

  it('carries Deck-shaped cards/sideboard that expand to DeckCard', () => {
    const deck = file.decks[0]
    expect(deck.name).toBeTruthy()
    expect(Array.isArray(deck.cards)).toBe(true)
    expect(Array.isArray(deck.sideboard)).toBe(true)
    const card: DeckCard = expandBundledCard(deck.cards[0])
    expect(typeof card.cardName).toBe('string')
    expect(card.cardName.length).toBeGreaterThan(0)
    expect(typeof card.setCode).toBe('string')
    expect(typeof card.cardNumber).toBe('string')
    expect(card.amount).toBeGreaterThan(0)
    // A majors deck ships plain names (proxy-resolved, empty printing).
    const plain = file.decks.find((d) => d.source === 'majors')!
    expect(plain.cards.every((c) => c.length === 2)).toBe(true)
    // A sample deck ships bracketed printings.
    const sample = file.decks.find((d) => d.source === 'sample')!
    expect(sample.cards.some((c) => c.length === 4)).toBe(true)
  })

  it('stays under the size bound (lazy asset, ~5.5 MB raw)', () => {
    const bytes = fs.statSync(ASSET_PATH).size
    expect(bytes).toBeLessThan(8_000_000)
  })
})
