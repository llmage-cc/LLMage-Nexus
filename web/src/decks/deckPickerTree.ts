// Tiering for the Create-Table deck picker (the wizard's deck
// control was one flat ~5,000-option dropdown).
//
// `decks/deckOrder.ts` already reproduces the old webui's ORDER — one
// <optgroup> per corpus library, event formats first, decks A–Z. This module
// adds the TIERING that made that picker usable
// (`Mage.WebProxy/web/frontend/react/src/components/deckeditor/BuiltInDeckPicker.tsx`,
// `buildTree`: library select → event/set select → deck select):
//
//   category  the player's own decks vs the built-in corpus
//   format    the corpus library (`deck.group`, `compareLibraries` order) or the
//             player's own deck format, plus an unspecified bucket
//   event     the folder segment(s) of a corpus deck id, humanized, with an
//             explicit all-events option
//   deck      names A–Z inside the current selection
//
// `buildDeckPickerTree` walks the deck list ONCE and every selector below is a
// Map lookup, so the ~5,000-deck list must be memoized on its reference (it
// changes once, when the lazily loaded corpus lands): the 5.5 MB asset is never
// re-walked per render.

import type { Deck } from '../lobby/decks'
import { compareLibraries, SAMPLE_DECKS_GROUP, sortDecksByName, type DeckSection } from './deckOrder'

/** The "unspecified / no format" bucket of the player's own decks. */
export const NO_FORMAT = ''
/** The tournament tier's all-events sentinel (no deck id folder is ever this). */
export const ALL_EVENTS = '*'

export type DeckPickerCategory = 'own' | 'builtin'

export interface DeckPickerSelection {
  category: DeckPickerCategory
  /** `deck.group` for Built-in, the deck's own `format` for My decks. */
  format: string
  /** `ALL_EVENTS` or one of `deckPickerEvents()` for that format (Built-in only). */
  event: string
}

export interface DeckPickerTree {
  /** The player's own decks by format (`NO_FORMAT` = no format), each list A–Z. */
  ownByFormat: Map<string, Deck[]>
  /** Own format labels: event formats first, then alphabetical, `NO_FORMAT` last. */
  ownFormats: string[]
  /** Corpus libraries in `compareLibraries` order (event formats first). */
  libraries: string[]
  /** Built-in decks by library, A–Z. */
  builtinByLibrary: Map<string, Deck[]>
  /** Library → its humanized event labels, alphabetical. */
  eventsByLibrary: Map<string, string[]>
  /** `${library}\u0000${event}` → decks A–Z. */
  byLibraryEvent: Map<string, Deck[]>
  /** The compiled nexus sample decks (`SAMPLE_DECKS_GROUP`) — always offered. */
  samples: Deck[]
}

function eventKey(library: string, event: string): string {
  return `${library}\u0000${event}`
}

function push(map: Map<string, Deck[]>, key: string, deck: Deck): void {
  const list = map.get(key)
  if (list) list.push(deck)
  else map.set(key, [deck])
}

function sortValues(map: Map<string, Deck[]>): Map<string, Deck[]> {
  return new Map([...map].map(([key, decks]) => [key, sortDecksByName(decks)]))
}

/**
 * The player's own `format` when the runtime deck carries one (the client
 * `Deck` type has no `format` field and this module must not extend it);
 * `NO_FORMAT` when the deck carries none at all.
 */
function ownDeckFormat(deck: Deck): string {
  const format = (deck as Deck & { format?: string }).format
  return typeof format === 'string' ? format.trim() : NO_FORMAT
}

/** Humanize one folder segment: `10022_Grand_Prix_Lille_2015` → `10022 Grand Prix Lille 2015`. */
function humanizeSegment(segment: string): string {
  return segment.replace(/_/g, ' ').trim()
}

/**
 * The tournament/event the old picker nested a built-in deck under: the folder
 * segments between the library and the file, humanized
 * (`majors:Legacy/10022_Grand_Prix_Lille_2015/1__Monastery_Miracles….txt` →
 * `10022 Grand Prix Lille 2015`, `sample:2013/Modern/DailyMTG/x.dck` →
 * `Modern / DailyMTG`). `''` when the deck sits directly in its library and has
 * no such grouping (e.g. `sample:AI/Attack of the Vampires.dck`).
 */
export function deckEventLabel(id?: string): string {
  if (!id) return ''
  const separator = id.indexOf(':')
  const path = separator >= 0 ? id.slice(separator + 1) : id
  const segments = path.split('/')
  if (segments.length < 3) return ''
  return segments.slice(1, -1).map(humanizeSegment).filter(Boolean).join(' / ')
}

/** Walk a deck list once into the picker's tiers. Memoize on the list reference. */
export function buildDeckPickerTree(decks: Deck[]): DeckPickerTree {
  const ownByFormat = new Map<string, Deck[]>()
  const builtinByLibrary = new Map<string, Deck[]>()
  const eventsByLibrary = new Map<string, Set<string>>()
  const byLibraryEvent = new Map<string, Deck[]>()
  const samples: Deck[] = []

  for (const deck of decks) {
    const library = deck.group
    if (!library) {
      push(ownByFormat, ownDeckFormat(deck), deck)
      continue
    }
    // The compiled nexus samples are not a corpus library: they ship with the
    // bundle, the wizard seats them by default, so they keep their own
    // always-offered section instead of being filtered away by the format tier.
    if (library === SAMPLE_DECKS_GROUP) {
      samples.push(deck)
      continue
    }
    push(builtinByLibrary, library, deck)
    const event = deckEventLabel(deck.id)
    if (!event) continue
    let events = eventsByLibrary.get(library)
    if (!events) {
      events = new Set()
      eventsByLibrary.set(library, events)
    }
    events.add(event)
    push(byLibraryEvent, eventKey(library, event), deck)
  }

  const namedFormats = [...ownByFormat.keys()].filter((format) => format !== NO_FORMAT).sort(compareLibraries)
  return {
    ownByFormat: sortValues(ownByFormat),
    ownFormats: ownByFormat.has(NO_FORMAT) ? [...namedFormats, NO_FORMAT] : namedFormats,
    libraries: [...builtinByLibrary.keys()].sort(compareLibraries),
    builtinByLibrary: sortValues(builtinByLibrary),
    eventsByLibrary: new Map(
      [...eventsByLibrary].map(([library, events]) => [library, [...events].sort((a, b) => a.localeCompare(b))]),
    ),
    byLibraryEvent: sortValues(byLibraryEvent),
    samples: sortDecksByName(samples),
  }
}

/** The events offered for a built-in library (empty when it has no event tier). */
export function deckPickerEvents(tree: DeckPickerTree, library: string): string[] {
  return tree.eventsByLibrary.get(library) ?? []
}

/**
 * The deck `<select>`'s sections for a selection: the own-decks bucket alone, or
 * the always-offered samples plus the selected library (option: one event).
 */
export function deckPickerListSections(tree: DeckPickerTree, selection: DeckPickerSelection): DeckSection[] {
  if (selection.category === 'own') {
    const decks = tree.ownByFormat.get(selection.format) ?? []
    return decks.length > 0 ? [{ key: 'own', labelKey: 'my_decks', decks }] : []
  }
  const decks = selection.event === ALL_EVENTS
    ? tree.builtinByLibrary.get(selection.format) ?? []
    : tree.byLibraryEvent.get(eventKey(selection.format, selection.event)) ?? []
  const sections: DeckSection[] = []
  if (tree.samples.length > 0) sections.push({ key: 'samples', labelKey: 'browser_filter_precon', decks: tree.samples })
  if (decks.length > 0) sections.push({ key: `library:${selection.format}`, library: selection.format, decks })
  return sections
}

/** `Constructed - Modern` / `Variant Magic - Commander` → the bare format name. */
function bareFormat(deckType?: string): string {
  return (deckType ?? '').trim().replace(/^(Block Constructed|Constructed|Variant Magic) - /, '').trim()
}

/** The corpus library a create-table deck type names, when the tree carries it. */
export function libraryForDeckType(tree: DeckPickerTree, deckType?: string): string | undefined {
  const name = bareFormat(deckType).toLowerCase()
  if (!name) return undefined
  return tree.libraries.find((library) => library.toLowerCase() === name)
}

/** The player's own format bucket a create-table deck type names, when they have decks in it. */
export function ownFormatForDeckType(tree: DeckPickerTree, deckType?: string): string | undefined {
  const name = bareFormat(deckType).toLowerCase()
  if (!name) return undefined
  return tree.ownFormats.find((format) => format !== NO_FORMAT && format.toLowerCase() === name)
}

/** The format tier's best pick inside a category for the wizard's current deck type. */
export function deckPickerFormatFor(tree: DeckPickerTree, category: DeckPickerCategory, deckType?: string): string {
  if (category === 'own') {
    return ownFormatForDeckType(tree, deckType)
      ?? tree.ownFormats.find((format) => format !== NO_FORMAT)
      ?? NO_FORMAT
  }
  return libraryForDeckType(tree, deckType) ?? tree.libraries[0] ?? NO_FORMAT
}

/**
 * The default: the picker opens on **Built-in** — the player can
 * flip to My decks at any time — and the FORMAT tier follows the form's deck type
 * when the built-in corpus has that library, else the corpus's first library. The
 * event tier starts at all events. Having own decks must NOT pull the default away
 * from Built-in: the corpus is what makes the picker useful on a fresh profile, and
 * an own-deck-only list would hide it. The DECK tier keeps its own default in the
 * wizard (`findPresetDefaultDeck`, the curated 'Boros Burn') — untouched here.
 */
export function defaultDeckPickerSelection(tree: DeckPickerTree, deckType?: string): DeckPickerSelection {
  return { category: 'builtin', format: deckPickerFormatFor(tree, 'builtin', deckType), event: ALL_EVENTS }
}
