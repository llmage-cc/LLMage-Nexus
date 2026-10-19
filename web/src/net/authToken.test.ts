import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAuthToken, getAuthToken, setAuthToken } from './authToken'

/** Every value currently stored in one web-storage area (undefined → none in this env). */
function valuesOf(store: Storage | undefined): string[] {
  const out: string[] = []
  if (!store) return out
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i)
    if (k) out.push(store.getItem(k) ?? '')
  }
  return out
}

describe('authToken — per-tab persistence', () => {
  const clearStores = () => {
    window.sessionStorage.clear()
    // Node may expose localStorage but leave it undefined without
    // --localstorage-file: guard rather than assume jsdom provides it.
    try { window.localStorage?.clear() } catch {}
  }

  beforeEach(() => {
    clearStores()
    clearAuthToken()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    clearStores()
    clearAuthToken()
  })

  it('remembers the token in memory and mirrors it into sessionStorage', () => {
    setAuthToken('sekret')
    expect(getAuthToken()).toBe('sekret')
    expect(valuesOf(window.sessionStorage)).toContain('sekret')
  })

  it('never writes the token to localStorage or a cookie', () => {
    // install a recording localStorage so the "never persisted there" claim is
    // actually exercised (the jsdom env leaves window.localStorage undefined)
    const writes: string[] = []
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: (k: string, v: string) => { writes.push(`${k}=${v}`) },
      removeItem: () => {},
      clear: () => {},
    })
    setAuthToken('only-tab')
    expect(writes).toEqual([])
    expect(document.cookie).not.toContain('only-tab')
  })

  it('an empty value clears both the memory copy and the stored one', () => {
    setAuthToken('sekret')
    setAuthToken('')
    expect(getAuthToken()).toBe('')
    expect(valuesOf(window.sessionStorage)).not.toContain('sekret')
  })

  it('clearAuthToken() (logout / 4401) wipes the memory copy AND the stored one', () => {
    setAuthToken('sekret')
    clearAuthToken()
    expect(getAuthToken()).toBe('')
    expect(valuesOf(window.sessionStorage)).not.toContain('sekret')
  })

  it('a reload re-reads the token from sessionStorage at module init', async () => {
    // seed the way a previous page load would have, then drop the whole module
    // registry: the fresh import stands in for a browser reload of the tab.
    setAuthToken('across-reload')
    vi.resetModules()
    const fresh = await import('./authToken')
    expect(fresh.getAuthToken()).toBe('across-reload')
    // the reloaded module's clearAuthToken still wipes both copies
    fresh.clearAuthToken()
    expect(fresh.getAuthToken()).toBe('')
    expect(valuesOf(window.sessionStorage)).not.toContain('across-reload')
  })

  it('degrades to memory (never throws) when sessionStorage is unavailable', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => { throw new Error('storage disabled') },
      setItem: () => { throw new Error('storage disabled') },
      removeItem: () => { throw new Error('storage disabled') },
    })
    expect(() => setAuthToken('in-memory')).not.toThrow()
    expect(getAuthToken()).toBe('in-memory')
    expect(() => clearAuthToken()).not.toThrow()
    expect(getAuthToken()).toBe('')
  })
})
