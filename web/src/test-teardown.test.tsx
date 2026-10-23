import { describe, expect, it } from 'vitest'
import { useEffect, useState } from 'react'
import { render, screen } from '@testing-library/react'
import { setImmediate as nodeSetImmediate } from 'node:timers'
import { flushReactSchedulerWork } from './test-teardown'

const tick = (): Promise<void> =>
  new Promise<void>((resolve) => {
    nodeSetImmediate(resolve)
  })

function Probe({ onMount }: { onMount: (update: () => void) => void }) {
  const [value, setValue] = useState('before')
  useEffect(() => {
    onMount(() => setValue('after'))
  }, [onMount])
  return <div data-testid="probe">{value}</div>
}

describe('flushReactSchedulerWork', () => {
  it('runs the render react-dom queued in the scheduler', async () => {
    let update: (() => void) | null = null
    render(<Probe onMount={(next) => { update = next }} />)
    expect(update).not.toBeNull()

    update!()
    expect(screen.getByTestId('probe').textContent).toBe('before')

    await flushReactSchedulerWork()

    expect(screen.getByTestId('probe').textContent).toBe('after')
  })

  it('leaves no scheduler callback for the environment teardown', async () => {
    let update: (() => void) | null = null
    render(<Probe onMount={(next) => { update = next }} />)
    update!()

    await flushReactSchedulerWork()

    const uncaught: unknown[] = []
    const capture = (error: unknown) => { uncaught.push(error) }
    process.on('uncaughtException', capture)
    const win = (globalThis as { window?: Window }).window
    delete (globalThis as { window?: Window }).window
    try {
      await tick()
      await tick()
    } finally {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        enumerable: true,
        writable: true,
        value: win,
      })
      process.off('uncaughtException', capture)
    }

    expect(uncaught).toEqual([])
  })
})
