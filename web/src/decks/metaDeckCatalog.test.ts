import { describe, it, expect } from 'vitest'
import { loadMetaDeckCatalog, metaDeckCatalogIfLoaded } from './metaDeckCatalog'

/**
 * The curated catalog moved out of the entry chunk: it is reached through a dynamic import, so
 * the lobby and the board never pay for 50 KB of decklists. These pin the contract the deck
 * gallery, the deck browser and the starter-deck offer rely on — one shared array, memoised, and
 * a synchronous peek for renders that cannot await.
 */
describe('meta deck catalog loader', () => {
  it('loads the curated catalog on demand and shares one array', async () => {
    const catalog = await loadMetaDeckCatalog()
    expect(catalog.length).toBeGreaterThan(5)
    expect(catalog.some((d) => d.id === 'meta-std-mono-red')).toBe(true)
    expect(catalog.some((d) => d.id === 'meta-edh-krenko')).toBe(true)
  })

  it('memoises the chunk: every caller gets the same array', async () => {
    const [a, b] = await Promise.all([loadMetaDeckCatalog(), loadMetaDeckCatalog()])
    expect(a).toBe(b)
    expect(await loadMetaDeckCatalog()).toBe(a)
  })

  it('exposes what already landed for a render that cannot await', async () => {
    const loaded = await loadMetaDeckCatalog()
    expect(metaDeckCatalogIfLoaded()).toBe(loaded)
  })
})
