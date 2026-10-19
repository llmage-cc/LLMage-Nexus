import { describe, expect, it } from 'vitest'
import type { P1DeckEntry } from '../../net/commands'
import {
  buildP1SeatOptions,
  isP1Seat,
  p1DeckNameForText,
  p1DeckText,
  p1DefaultDeckName,
  p1DefaultDeckText,
  p1SeatDeckIsTraining,
} from './p1Decks'
import { P1_SEAT, normalizeSeatType } from './constants'

const POOL: P1DeckEntry[] = [
  { name: 'Izzet Spellementals', deck: '4 Lightning Bolt\n24 Island\n' },
  { name: 'Mono Red Aggro', deck: '4 Monastery Swiftspear\n' },
  { name: 'Azorius Control', deck: '4 Counterspell\n' },
]
const DEFAULT_NAME = 'Izzet Spellementals'

describe('isP1Seat (capabilities.p1 seat type)', () => {
  it('is true only for the P1 seat and normalizes aliases', () => {
    expect(isP1Seat('COMPUTER_P1')).toBe(true)
    expect(isP1Seat('computer_p1')).toBe(true)
    expect(isP1Seat('Computer - P1')).toBe(true)
    expect(isP1Seat('COMPUTER_LLM')).toBe(false)
    expect(isP1Seat('SIM')).toBe(false)
    expect(isP1Seat('HUMAN')).toBe(false)
    expect(isP1Seat('COMPUTER_MAD')).toBe(false)
  })

  it('normalizeSeatType folds the alias map to the canonical constant', () => {
    expect(normalizeSeatType('COMPUTER_P1')).toBe(P1_SEAT)
    expect(normalizeSeatType('computer policy net')).toBe(P1_SEAT)
  })
})

describe('p1DefaultDeckName', () => {
  it('uses the proxy default when it is in the pool', () => {
    expect(p1DefaultDeckName(POOL, DEFAULT_NAME)).toBe(DEFAULT_NAME)
  })

  it('falls back to the first deck when the default name is missing or unknown', () => {
    expect(p1DefaultDeckName(POOL, '')).toBe('Izzet Spellementals')
    expect(p1DefaultDeckName(POOL, 'Not A Real Deck')).toBe('Izzet Spellementals')
  })

  it('is empty for an empty pool', () => {
    expect(p1DefaultDeckName([], DEFAULT_NAME)).toBe('')
  })
})

describe('buildP1SeatOptions', () => {
  it('maps every deck, marking the default (order preserved)', () => {
    const opts = buildP1SeatOptions(POOL, DEFAULT_NAME)
    expect(opts.map((o) => o.name)).toEqual(['Izzet Spellementals', 'Mono Red Aggro', 'Azorius Control'])
    expect(opts.map((o) => o.isDefault)).toEqual([true, false, false])
    expect(opts[0].deck).toBe('4 Lightning Bolt\n24 Island\n')
  })

  it('is empty for an empty pool', () => {
    expect(buildP1SeatOptions([], DEFAULT_NAME)).toEqual([])
  })
})

describe('p1DeckText / p1DefaultDeckText', () => {
  it('returns the TEXT for a pool name and empty otherwise', () => {
    expect(p1DeckText(POOL, 'Mono Red Aggro')).toBe('4 Monastery Swiftspear\n')
    expect(p1DeckText(POOL, 'Nope')).toBe('')
  })

  it('defaults to the materialized default deck text (never arbitrary)', () => {
    expect(p1DefaultDeckText(POOL, DEFAULT_NAME)).toBe('4 Lightning Bolt\n24 Island\n')
    expect(p1DefaultDeckText([], DEFAULT_NAME)).toBe('')
  })
})

describe('p1DeckNameForText (select controlled value)', () => {
  it('resolves the stored TEXT back to its name', () => {
    expect(p1DeckNameForText(POOL, '4 Lightning Bolt\n24 Island\n')).toBe('Izzet Spellementals')
  })

  it('tolerates a lost trailing newline (trimmed match)', () => {
    expect(p1DeckNameForText(POOL, '4 Lightning Bolt\n24 Island')).toBe('Izzet Spellementals')
  })

  it('is empty for empty or non-pool text', () => {
    expect(p1DeckNameForText(POOL, '')).toBe('')
    expect(p1DeckNameForText(POOL, '4 Some Random Card\n')).toBe('')
  })
})

describe('p1SeatDeckIsTraining', () => {
  it('only accepts exact (or trimmed) pool text', () => {
    expect(p1SeatDeckIsTraining(POOL, '4 Counterspell\n')).toBe(true)
    expect(p1SeatDeckIsTraining(POOL, '4 Counterspell')).toBe(true)
    expect(p1SeatDeckIsTraining(POOL, '4 Not A Training Card\n')).toBe(false)
    expect(p1SeatDeckIsTraining(POOL, '')).toBe(false)
  })
})
