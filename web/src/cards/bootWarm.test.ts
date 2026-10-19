import { afterEach, describe, expect, it, vi } from 'vitest'
import { scheduleBootWarm } from './offlineIndex'

describe('scheduleBootWarm', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('starts neither loader before the idle callback fires', () => {
    const callbacks: Array<() => void> = []
    vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
      callbacks.push(cb)
      return 1
    })
    const first = vi.fn()
    const second = vi.fn()

    scheduleBootWarm([first, second])

    expect(callbacks).toHaveLength(1)
    expect(first).not.toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()

    callbacks[0]()
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('falls back to setTimeout and still starts both loaders when requestIdleCallback is absent', () => {
    vi.stubGlobal('requestIdleCallback', undefined)
    vi.useFakeTimers()
    try {
      const first = vi.fn()
      const second = vi.fn()

      scheduleBootWarm([first, second])
      expect(first).not.toHaveBeenCalled()
      expect(second).not.toHaveBeenCalled()

      vi.runOnlyPendingTimers()
      expect(first).toHaveBeenCalledTimes(1)
      expect(second).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('swallows a rejecting loader (no unhandled rejection), like the fire-and-forget boot calls', async () => {
    let run: (() => void) | undefined
    scheduleBootWarm([() => Promise.reject(new Error('boom'))], {
      idle: (task) => {
        run = task
      },
    })
    expect(typeof run).toBe('function')

    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    run!()
    await new Promise((resolve) => setTimeout(resolve, 10))
    process.off('unhandledRejection', onUnhandled)

    expect(unhandled).toEqual([])
  })

  it('swallows a loader that throws synchronously', () => {
    const pending: Array<() => void> = []
    scheduleBootWarm(
      [
        () => {
          throw new Error('sync boom')
        },
        () => Promise.resolve(),
      ],
      {
        idle: (task) => {
          pending.push(task)
        },
      },
    )

    expect(() => pending[0]()).not.toThrow()
  })
})
