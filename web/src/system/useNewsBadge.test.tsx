import { act } from 'react'
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useNewsBadge } from './useNewsBadge'
import type { NewsRelease } from './news'

// `getNews()` is a GitHub round-trip, so it routinely resolves after the screen that asked for the
// badge is gone. The hook must not dispatch then: React still walks its update path, which reads
// `window`, so the late setState dies as an uncaught `ReferenceError` once vitest has torn jsdom
// down — the state that reds a run whose every assertion passed.
const { getNewsMock, loadNewsCacheMock } = vi.hoisted(() => ({
  getNewsMock: vi.fn(),
  loadNewsCacheMock: vi.fn<() => { fetchedAt: number; releases: NewsRelease[] } | null>(() => null),
}))

vi.mock('./news', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./news')>()
  return { ...actual, getNews: getNewsMock, loadNewsCache: loadNewsCacheMock }
})

const release = (tag: string): NewsRelease => ({
  repo: 'nexus',
  tag,
  name: tag,
  body: '',
  url: `https://github.com/Adamychen/xmage-nexus/releases/tag/${tag}`,
  publishedAt: null,
})

function Badge() {
  const { unseen } = useNewsBadge()
  return <span data-testid="badge">{unseen ? 'unseen' : 'none'}</span>
}

/**
 * `getNews` resolves through this thenable, so the hook's continuation can be invoked at the exact
 * moment a real promise would resume it — after unmount — instead of after an arbitrary delay.
 */
function pendingNews(): { resolve: (releases: NewsRelease[]) => void } {
  let resume: ((value: { releases: NewsRelease[]; offline: boolean }) => void) | null = null
  const thenable = {
    then(onFulfilled: (value: { releases: NewsRelease[]; offline: boolean }) => void) {
      resume = onFulfilled
    },
  }
  getNewsMock.mockReturnValueOnce(thenable as never)
  return { resolve: (releases) => { resume?.({ releases, offline: false }) } }
}

afterEach(() => {
  getNewsMock.mockReset()
  loadNewsCacheMock.mockReturnValue(null)
})

describe('useNewsBadge after unmount', () => {
  const withoutWindow = (run: () => void) => {
    const saved = globalThis.window
    delete (globalThis as { window?: Window }).window
    try {
      expect(run).not.toThrow()
    } finally {
      Object.defineProperty(globalThis, 'window', { configurable: true, enumerable: true, writable: true, value: saved })
    }
  }

  it('drops a getNews() that resolves after unmount instead of calling setTick', () => {
    const news = pendingNews()
    const view = render(<Badge />)
    view.unmount()

    // No window: any setTick would go through react-dom's resolveUpdatePriority and throw.
    withoutWindow(() => news.resolve([release('v0.4.7')]))
  })

  it('still counts a resolution that lands while mounted (the guard is not a blanket no-op)', () => {
    const news = pendingNews()
    const view = render(<Badge />)
    expect(view.getByTestId('badge').textContent, 'sin caché todavía no hay novedad').toBe('none')

    // The tick is what re-reads the cache; it must still happen while the badge is mounted.
    loadNewsCacheMock.mockReturnValue({ fetchedAt: Date.now(), releases: [release('v0.4.7')] })
    act(() => news.resolve([release('v0.4.7')]))

    expect(getNewsMock).toHaveBeenCalledTimes(1)
    expect(view.getByTestId('badge').textContent).toBe('unseen')
  })
})
