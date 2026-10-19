import { afterEach, describe, expect, it, vi } from 'vitest'
import { isDeploymentLocked } from './deploymentLock'

// `isDeploymentLocked()` gates the whole deployment-lock UX on the build-time
// VITE_LOCK_DEPLOYMENT flag. Default OFF keeps today's behavior for self-hosters;
// a hosted deployment builds with it ON to remove every server-choice surface.

describe('isDeploymentLocked', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is OFF by default (flag unset) — a self-hoster is not locked', () => {
    expect(isDeploymentLocked()).toBe(false)
  })

  it('is OFF for a blank / unrecognized value', () => {
    for (const v of ['', ' ', '0', 'false', 'no', 'on', '2']) {
      vi.stubEnv('VITE_LOCK_DEPLOYMENT', v)
      expect(isDeploymentLocked()).toBe(false)
    }
  })

  it('is ON for the truthy values, ignoring case and surrounding spaces', () => {
    for (const v of ['1', 'true', 'TRUE', 'True', ' 1 ', ' true ']) {
      vi.stubEnv('VITE_LOCK_DEPLOYMENT', v)
      expect(isDeploymentLocked()).toBe(true)
    }
  })
})
