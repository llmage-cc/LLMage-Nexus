// Built-in deck corpus transform (client-side, card-DB-free).
//
// The shipped corpus (`xmage/Mage.WebProxy/web/frontend/decks/builtin.json`,
// 5,013 decks = the mtgtop8 *majors* corpus + the XMage sample decks) stores
// each deck as a raw decklist in `text`. This module turns that into the nexus
// `Deck`-shaped cards/sideboard the webui renders.
//
// It is the single source of truth for the transform: the generator
// (`web/scripts/build-bundled-decks.mjs`) and the unit tests both import it, so
// the committed asset can never drift from the parser the tests assert on.
//
// The line grammar is the corpus grammar, not `.dck`:
//   NAME:<name> / AUTHOR:<author>     header (name/author already live in fields)
//   N [SET:NUM] CardName              sample decks (bracketed printing)
//   N CardName                        mtgtop8 majors (plain name, no printing)
//   SB: N CardName | SB: N [SET:NUM] CardName      sideboard
//
// A plain-name card keeps EMPTY setCode/cardNumber: the proxy resolves the
// printing by name server-side (`DeckJson.resolvePrinting`), and basic lands
// are filled in client-side by `deckNormalize.normalizeDeckCard`. So this is a
// purely textual transform — no card DB is needed at build time.

import type { DeckCard } from '../lobby/decks.ts'
import { normalizeBasicLandName } from './deckUtils.ts'

/**
 * Compact card encoding: `[amount, cardName]` for a plain-name (proxy-resolved)
 * card, `[amount, cardName, setCode, cardNumber]` when the source carried a
 * bracketed printing. Tuples keep the asset ~5.5 MB vs ~14.6 MB for the
 * `{cardName,setCode,cardNumber,amount}` object shape.
 */
export type BundledCardTuple = [number, string] | [number, string, string, string]

/** One corpus deck in the committed asset (the source `text` is baked away). */
export interface BundledDeckEntry {
  id: string
  name: string
  format: string
  group: string
  source: string
  cards: BundledCardTuple[]
  sideboard: BundledCardTuple[]
}

/** The committed counts, so a test can pin the corpus without re-parsing. */
export interface BundledDecksManifest {
  decks: number
  majors: number
  sample: number
  byFormat: Record<string, number>
  byGroup: Record<string, number>
}

export interface BundledDecksFile {
  generated: string
  source: string
  manifest: BundledDecksManifest
  decks: BundledDeckEntry[]
}

/** The source `builtin.json` deck record (only the fields the transform reads). */
export interface BuiltinCorpusDeck {
  id: string
  source: string
  format: string
  group: string
  subcategory?: string
  name: string
  author?: string
  text: string
}

export interface BuiltinCorpus {
  generated?: string
  counts?: { majors?: number; sample?: number }
  decks: BuiltinCorpusDeck[]
}

const HEADER_NAME = /^NAME:\s*(.*)$/
const HEADER_AUTHOR = /^AUTHOR:\s*(.*)$/
// Optional `SB: `, a count, then BOTH line shapes: an optional `[SET:NUM]` and
// the card name. (`parseDck`'s DCK_LINE requires the bracket; the corpus majors
// decks are plain-name, hence this variant.)
const DECK_LINE = /^(SB:\s*)?(\d+)\s+(?:\[([^:\]]+):([^\]]+)\]\s*)?(.+?)\s*$/

/**
 * Parse one corpus decklist into main + sideboard tuples. Returns empty arrays
 * for lines the grammar does not recognise (headers, blank lines, comments).
 */
export function parseBuiltinDeckList(text: string): { cards: BundledCardTuple[]; sideboard: BundledCardTuple[] } {
  const cards: BundledCardTuple[] = []
  const sideboard: BundledCardTuple[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    if (HEADER_NAME.test(line) || HEADER_AUTHOR.test(line)) continue
    const m = DECK_LINE.exec(line)
    if (!m) continue
    const amount = parseInt(m[2], 10) || 1
    const setCode = (m[3] ?? '').trim()
    const cardNumber = (m[4] ?? '').trim()
    const rawName = (m[5] ?? '').trim()
    if (!rawName) continue
    // Canonicalise basic-land names (the corpus already uses English names, so
    // this is normally a no-op, but it keeps the parser honest for any locale).
    const cardName = normalizeBasicLandName(rawName) || rawName
    const tuple: BundledCardTuple =
      setCode || cardNumber ? [amount, cardName, setCode, cardNumber] : [amount, cardName]
    if (m[1]) sideboard.push(tuple)
    else cards.push(tuple)
  }
  return { cards, sideboard }
}

/** Expand the compact tuple back to the deck card the UI works with. */
export function expandBundledCard(tuple: BundledCardTuple): DeckCard {
  return { cardName: tuple[1], setCode: tuple[2] ?? '', cardNumber: tuple[3] ?? '', amount: tuple[0] }
}

/**
 * Build the committed asset from the validated source corpus. Throws on a
 * duplicate id — a corpus id collisions would make a deck unaddressable in the
 * picker, and the generator must fail loud rather than ship it.
 */
export function buildBundledDecksFile(corpus: BuiltinCorpus): BundledDecksFile {
  const decks: BundledDeckEntry[] = []
  const byFormat: Record<string, number> = {}
  const byGroup: Record<string, number> = {}
  const seen = new Set<string>()
  let majors = 0
  let sample = 0
  for (const d of corpus.decks) {
    if (seen.has(d.id)) throw new Error(`duplicate bundled deck id: ${d.id}`)
    seen.add(d.id)
    const { cards, sideboard } = parseBuiltinDeckList(d.text)
    decks.push({ id: d.id, name: d.name, format: d.format, group: d.group, source: d.source, cards, sideboard })
    byFormat[d.format] = (byFormat[d.format] ?? 0) + 1
    byGroup[d.group] = (byGroup[d.group] ?? 0) + 1
    if (d.source === 'majors') majors += 1
    else if (d.source === 'sample') sample += 1
  }
  const manifest: BundledDecksManifest = {
    decks: decks.length,
    majors: corpus.counts?.majors ?? majors,
    sample: corpus.counts?.sample ?? sample,
    byFormat,
    byGroup,
  }
  return { generated: corpus.generated ?? new Date().toISOString(), source: 'builtin-decks.sh', manifest, decks }
}
