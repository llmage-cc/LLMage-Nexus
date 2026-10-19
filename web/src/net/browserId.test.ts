import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearBrowserId, getBrowserId } from './browserId'

/**
 * The harness has no web storage (Node shadows the `localStorage` global and
 * jsdom's is absent), so these specs exercise the in-memory fallback — which
 * shares the same stability contract the localStorage path gives a real
 * browser. The format, per-username scoping, per-browser stability and the
 * clear-for-tests helper are what matter here.
 */
describe('getBrowserId', () => {
  beforeEach(() => {
    clearBrowserId()
  })

  afterEach(() => {
    clearBrowserId()
  })

  it('mints a web:<username>:<uuid> id', () => {
    const id = getBrowserId('player1')
    expect(id).toMatch(/^web:player1:[0-9a-f-]{8,}$/i)
  })

  it('is stable across calls in the same browser', () => {
    const first = getBrowserId('player1')
    const second = getBrowserId('player1')
    expect(second).toBe(first)
  })

  it('is shared across tabs: a second tab reads the SAME uuid (multi-tab attach)', () => {
    // One id per BROWSER (localStorage in the browser; the same process id in
    // the harness) — which is what lets the proxy attach a second tab to the
    // live session and treat its same-name connect as the legitimate reconnect
    // takeover, instead of refusing it as a different browser.
    const tab1 = getBrowserId('player1')
    const tab2 = getBrowserId('player1')
    expect(tab2).toBe(tab1)
  })

  it('scopes the id to the username but reuses the same browser uuid', () => {
    const a = getBrowserId('alice')
    const b = getBrowserId('bob')
    expect(a.replace(/^web:alice:/, '')).toBe(b.replace(/^web:bob:/, ''))
  })

  it('mints a fresh id after clearBrowserId (a new browser)', () => {
    const first = getBrowserId('player1')
    clearBrowserId()
    const second = getBrowserId('player1')
    expect(second).not.toBe(first)
  })

  it('degrades to a non-persisted id when web storage is unavailable', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new Error('privacy mode') },
    })
    const id = getBrowserId('player1')
    expect(id).toMatch(/^web:player1:/)
    if (original) Object.defineProperty(window, 'localStorage', original)
  })
})
