import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearSeatKeys,
  getSeatKey,
  hasSeatKey,
  MAX_SEAT_KEYS,
  newClientKeyTag,
  seatEndpointOf,
  setSeatEndpoint,
  setSeatKey,
} from './llmSeatKeys'
import { convertLlmConfigForWire } from './llmConfig'

/**
 * Endpoint binding: the memory-only seat store keeps
 * { key, endpoint } per tag, and the wire conversion binds the seat's chosen
 * apiEndpoint at the same moment it mints the tag. These tests pin the store
 * contract and its one production writer.
 */

const TAG = 'seat-tag-1'

beforeEach(() => {
  clearSeatKeys()
})

describe('llmSeatKeys — key semantics (unchanged)', () => {
  it('stores a trimmed key under a tag; hasSeatKey/getSeatKey read it back', () => {
    setSeatKey(TAG, '  XXXXXX-not-a-real-key  ')
    expect(hasSeatKey(TAG)).toBe(true)
    expect(getSeatKey(TAG)).toBe('XXXXXX-not-a-real-key')
  })

  it('an empty/whitespace key deletes the entry entirely', () => {
    setSeatKey(TAG, 'XXXXXX-not-a-real-key')
    setSeatKey(TAG, '   ')
    expect(hasSeatKey(TAG)).toBe(false)
    expect(() => getSeatKey(TAG)).toThrow(/No API key stored/)
  })

  it('clearSeatKeys empties the store', () => {
    setSeatKey(TAG, 'XXXXXX-not-a-real-key')
    clearSeatKeys()
    expect(hasSeatKey(TAG)).toBe(false)
  })

  it('newClientKeyTag mints unique tags', () => {
    expect(new Set([newClientKeyTag(), newClientKeyTag(), newClientKeyTag()]).size).toBe(3)
  })
})

describe('llmSeatKeys — endpoint binding', () => {
  it('seatEndpointOf is null for an unknown tag and "" for a bound-but-empty endpoint', () => {
    expect(seatEndpointOf('never-set')).toBeNull()
    setSeatKey(TAG, 'XXXXXX-not-a-real-key')
    expect(seatEndpointOf(TAG)).toBe('')
  })

  it('setSeatEndpoint stores a trimmed endpoint on an existing key entry', () => {
    setSeatKey(TAG, 'XXXXXX-not-a-real-key')
    setSeatEndpoint(TAG, '  https://api.openai.com/v1/chat/completions  ')
    expect(seatEndpointOf(TAG)).toBe('https://api.openai.com/v1/chat/completions')
    // The key is untouched by the binding.
    expect(getSeatKey(TAG)).toBe('XXXXXX-not-a-real-key')
  })

  it('setSeatEndpoint cannot create a keyless entry (no endpoint without a key)', () => {
    setSeatEndpoint('no-key', 'https://api.openai.com/v1/chat/completions')
    expect(seatEndpointOf('no-key')).toBeNull()
    expect(hasSeatKey('no-key')).toBe(false)
  })

  it('re-entering a key on an already-bound tag keeps the binding', () => {
    setSeatKey(TAG, 'XXXXXX-not-a-real-key')
    setSeatEndpoint(TAG, 'https://api.groq.com/openai/v1/chat/completions')
    setSeatKey(TAG, 'XXXXXX-not-a-real-key-new')
    expect(getSeatKey(TAG)).toBe('XXXXXX-not-a-real-key-new')
    expect(seatEndpointOf(TAG)).toBe('https://api.groq.com/openai/v1/chat/completions')
  })

  it('clearing the key drops the binding with it', () => {
    setSeatKey(TAG, 'XXXXXX-not-a-real-key')
    setSeatEndpoint(TAG, 'https://api.openai.com/v1/chat/completions')
    setSeatKey(TAG, '')
    expect(seatEndpointOf(TAG)).toBeNull()
  })
})

describe('convertLlmConfigForWire binds the endpoint at tag-mint time', () => {
  it('a submitted apiKey binds the seat\'s chosen apiEndpoint to the minted tag', () => {
    const wire = convertLlmConfigForWire({
      apiKey: 'XXXXXX-not-a-real-key',
      apiEndpoint: 'https://api.openai.com/v1/chat/completions',
    })
    const tag = wire.clientKeyTag as string
    expect(hasSeatKey(tag)).toBe(true)
    expect(getSeatKey(tag)).toBe('XXXXXX-not-a-real-key')
    expect(seatEndpointOf(tag)).toBe('https://api.openai.com/v1/chat/completions')
  })

  it('the bound endpoint is trimmed like the wire field', () => {
    const wire = convertLlmConfigForWire({
      apiKey: 'XXXXXX-not-a-real-key',
      apiEndpoint: '  https://api.openai.com/v1/chat/completions  ',
    })
    expect(seatEndpointOf(wire.clientKeyTag as string)).toBe('https://api.openai.com/v1/chat/completions')
  })

  it('a seat with a key but NO chosen endpoint binds "" (server default)', () => {
    const wire = convertLlmConfigForWire({ apiKey: 'XXXXXX-not-a-real-key' })
    expect(seatEndpointOf(wire.clientKeyTag as string)).toBe('')
  })

  it('a non-string apiEndpoint (absent/null) also binds ""', () => {
    const a = convertLlmConfigForWire({ apiKey: 'XXXXXX-not-a-real-key', apiEndpoint: undefined })
    expect(seatEndpointOf(a.clientKeyTag as string)).toBe('')
    const b = convertLlmConfigForWire({ apiKey: 'XXXXXX-not-a-real-key', apiEndpoint: null })
    expect(seatEndpointOf(b.clientKeyTag as string)).toBe('')
  })

  it('the binding is per-tag: two seats with different endpoints never cross', () => {
    const a = convertLlmConfigForWire({ apiKey: 'XXXXXX-not-a-real-key-a', apiEndpoint: 'https://a.example/v1' })
    const b = convertLlmConfigForWire({ apiKey: 'XXXXXX-not-a-real-key-b', apiEndpoint: 'https://b.example/v1' })
    expect(seatEndpointOf(a.clientKeyTag as string)).toBe('https://a.example/v1')
    expect(seatEndpointOf(b.clientKeyTag as string)).toBe('https://b.example/v1')
  })
})

/**
 * Nothing pruned the store, so a page that submitted again and again kept
 * every key it ever minted. The cap evicts the least recently USED tag first —
 * a live seat re-reads its key on every provider call, so it is never the
 * victim.
 */
describe('llmSeatKeys — bounded store', () => {
  it('holds exactly the cap and evicts the untouched oldest tag on overflow', () => {
    setSeatKey('lru-oldest', 'XXXXXX-not-a-real-key-oldest')
    for (let i = 0; i < MAX_SEAT_KEYS - 1; i++) setSeatKey('fill-' + i, 'XXXXXX-not-a-real-key-fill-' + i)
    // exactly at the cap: nothing evicted yet
    expect(hasSeatKey('lru-oldest')).toBe(true)

    // used since it was stored: it must survive the next insert
    expect(getSeatKey('lru-oldest')).toBe('XXXXXX-not-a-real-key-oldest')
    setSeatKey('over-cap', 'XXXXXX-not-a-real-key-new')

    expect(hasSeatKey('lru-oldest')).toBe(true)
    expect(hasSeatKey('fill-0')).toBe(false)
    expect(hasSeatKey('fill-1')).toBe(true)
    expect(hasSeatKey('over-cap')).toBe(true)
  })

  it('re-entering a key keeps the entry (and its endpoint binding) alive', () => {
    for (let i = 0; i < MAX_SEAT_KEYS; i++) setSeatKey('cycle-' + i, 'XXXXXX-not-a-real-key-' + i)
    setSeatEndpoint('cycle-0', 'https://a.example/v1')
    setSeatKey('cycle-0', 'XXXXXX-not-a-real-key-refreshed')
    setSeatKey('one-more', 'XXXXXX-not-a-real-key-x')
    expect(hasSeatKey('cycle-0')).toBe(true)
    expect(seatEndpointOf('cycle-0')).toBe('https://a.example/v1')
    expect(hasSeatKey('cycle-1')).toBe(false)
  })
})