import type { P1DeckEntry } from '../../net/commands'
import { P1_SEAT, normalizeSeatType } from './constants'

/**
 * Pure helpers for the COMPUTER_P1 training-deck picker.
 *
 * The proxy's `getP1Decks` verb serves the 55 Standard training decklists (name +
 * paste-ready TEXT) and the deterministic default name. The picker is SELECT-only
 * (the user never types an arbitrary list): these helpers turn the fetched pool
 * into the select's options, resolve the defaulted selection, and map between a
 * deck NAME (the select's value) and the deck TEXT the seat carries into
 * `joinTable` (the server's authoritative P1DeckRestriction runs on it).
 *
 * Kept pure and free of React so the seat-type/default/selection logic is unit
 * tested without a DOM.
 */

/** True when a seat type is the Argentum-P1 fork seat (capabilities.p1 gated). */
export function isP1Seat(type: string): boolean {
  return normalizeSeatType(type) === P1_SEAT
}

/** One option of the picker's select: the deck NAME (value) plus its TEXT. */
export interface P1SeatOption {
  /** Canonical deck name — the select's value and label. */
  name: string
  /** Paste-ready decklist TEXT the seat carries into joinTable. */
  deck: string
  /** True for the pool's deterministic default (labelled "(default)"). */
  isDefault: boolean
}

/**
 * The name the picker should show as selected: the proxy's `default` when it is
 * actually part of the pool, else the pool's first deck, else '' (empty pool).
 * Never invents a name outside the served list.
 */
export function p1DefaultDeckName(decks: P1DeckEntry[], defaultName: string): string {
  if (decks.length === 0) return ''
  if (defaultName && decks.some((d) => d.name === defaultName)) return defaultName
  return decks[0].name
}

/** The select's options: one per served deck, the default marked. Order preserved. */
export function buildP1SeatOptions(decks: P1DeckEntry[], defaultName: string): P1SeatOption[] {
  const def = p1DefaultDeckName(decks, defaultName)
  return decks.map((d) => ({ name: d.name, deck: d.deck, isDefault: d.name === def }))
}

/** The deck TEXT for a training deck NAME ('' when the name is not in the pool). */
export function p1DeckText(decks: P1DeckEntry[], name: string): string {
  const entry = decks.find((d) => d.name === name)
  return entry ? entry.deck : ''
}

/**
 * The NAME of the deck whose TEXT was stored in the seat (reverse lookup for the
 * select's controlled value). Matches on exact text, then on whitespace-trimmed
 * text (a persisted list may have lost a trailing newline). '' when not in pool.
 */
export function p1DeckNameForText(decks: P1DeckEntry[], text: string): string {
  if (!text) return ''
  const exact = decks.find((d) => d.deck === text)
  if (exact) return exact.name
  const trimmed = text.trim()
  const loose = decks.find((d) => d.deck.trim() === trimmed)
  return loose ? loose.name : ''
}

/**
 * The deck TEXT a newly created COMPUTER_P1 seat should carry by default: the
 * proxy's deterministic default deck (materialized), so an untouched P1 seat is
 * never handed an arbitrary/empty list. '' when the pool is empty.
 */
export function p1DefaultDeckText(decks: P1DeckEntry[], defaultName: string): string {
  return p1DeckText(decks, p1DefaultDeckName(decks, defaultName))
}

/**
 * True when the seat's stored deck value is exactly one of the served training
 * lists — the condition the picker uses to keep a valid selection (an empty or
 * stale text falls back to the default).
 */
export function p1SeatDeckIsTraining(decks: P1DeckEntry[], text: string): boolean {
  if (!text) return false
  return decks.some((d) => d.deck === text || d.deck.trim() === text.trim())
}
