import { describe, expect, it } from 'vitest'
import {
  initialLlmList,
  listActionFromResult,
  llmListReducer,
  listErrorMessage,
  type LlmListState,
} from './llmModelPicker'

describe('llmListReducer — the picker state machine', () => {
  it('starts idle: no items, not loading, no error', () => {
    expect(initialLlmList).toEqual({ items: [], loading: false, error: null })
  })

  it("start sets the loading flag and clears a previous error", () => {
    const after: LlmListState = llmListReducer({ items: ['x'], loading: false, error: 'old' }, { kind: 'start' })
    expect(after.loading).toBe(true)
    expect(after.error).toBeNull()
  })

  it('success fills the items AND clears the loading flag', () => {
    const after = llmListReducer({ items: [], loading: true, error: null }, { kind: 'success', items: ['gpt-5', 'llama3'] })
    expect(after).toEqual({ items: ['gpt-5', 'llama3'], loading: false, error: null })
  })

  it('error clears the loading flag too (the pitfall) and carries the reason', () => {
    const after = llmListReducer({ items: [], loading: true, error: null }, { kind: 'error', message: 'host blocked' })
    expect(after.loading).toBe(false)
    expect(after.error).toBe('host blocked')
    expect(after.items).toEqual([])
  })

  it('after a failure a retry can succeed (loading clears are not sticky)', () => {
    let state: LlmListState = llmListReducer(initialLlmList, { kind: 'start' })
    state = llmListReducer(state, { kind: 'error', message: 'boom' })
    expect(state.loading).toBe(false)
    state = llmListReducer(state, { kind: 'start' })
    expect(state.loading).toBe(true)
    expect(state.error).toBeNull()
    state = llmListReducer(state, { kind: 'success', items: ['m'] })
    expect(state).toEqual({ items: ['m'], loading: false, error: null })
  })
})

describe('listActionFromResult', () => {
  it('maps a success answer to a success action', () => {
    expect(listActionFromResult({ ok: true, items: ['m1'], error: '' })).toEqual({ kind: 'success', items: ['m1'] })
  })

  it('maps a typed failure answer to an error action with its message', () => {
    expect(listActionFromResult({ ok: false, items: [], error: 'host blocked' }))
      .toEqual({ kind: 'error', message: 'host blocked' })
  })

  it('a failure without a message still clears the flag (never "request failed" undefined)', () => {
    expect(listActionFromResult({ ok: false, items: [], error: '' }))
      .toEqual({ kind: 'error', message: 'request failed' })
  })
})

describe('listErrorMessage', () => {
  it('reads an Error message', () => {
    expect(listErrorMessage(new Error('nope'))).toBe('nope')
  })

  it('falls back for a non-Error throw', () => {
    expect(listErrorMessage('raw')).toBe('raw')
    expect(listErrorMessage(undefined)).toBe('request failed')
  })
})
