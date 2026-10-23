import { act } from 'react'
import { setImmediate as nodeSetImmediate } from 'node:timers'

const macrotask = (): Promise<void> =>
  new Promise<void>((resolve) => {
    nodeSetImmediate(resolve)
  })

export async function flushReactSchedulerWork(): Promise<void> {
  const scope = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  const previous = scope.IS_REACT_ACT_ENVIRONMENT
  scope.IS_REACT_ACT_ENVIRONMENT = true
  try {
    await act(async () => {
      await macrotask()
      await macrotask()
    })
  } finally {
    scope.IS_REACT_ACT_ENVIRONMENT = previous
  }
}
