import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import App from './App'
import { isSetupDone, SETUP_VERSION } from './setup/setupFlag'
import { loadConn } from './state/persistence'
import { doConnect } from './state/store'
import { initialState, setState } from './state/state'
import { resetProxyConfigCache } from './net/proxyConfig'

vi.mock('./state/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./state/store')>()
  return { ...actual, doConnect: vi.fn(async () => {}), probeProxyConfig: vi.fn(async () => ({})) }
})

/**
 * The boot effect that reconnects with the SAVED
 * connection on reload must honor VITE_LOCK_DEPLOYMENT — substitute the baked
 * VITE_DEFAULT_SERVER_HOST/PORT for the saved values, and rewrite the saved
 * connection so the bypass does not persist into the next reload.
 */

const mockStorage: Record<string, string> = {}

function seedConn(conn: Record<string, unknown>): void {
  mockStorage['mage-web-conn'] = JSON.stringify(conn)
}

const savedConn = {
  wsHost: 'my-proxy.example.com',
  proxyPort: 8787,
  serverHost: 'beta.xmage.today',
  port: 17171,
  username: 'alice',
  password: 'pw',
  flagName: 'es',
  avatarId: 10,
}

describe('App boot reconnect honors the deployment lock', () => {
  beforeEach(() => {
    for (const k of Object.keys(mockStorage)) delete mockStorage[k]
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, value: string) => { mockStorage[key] = value },
      removeItem: (key: string) => { delete mockStorage[key] },
      clear: () => { for (const k of Object.keys(mockStorage)) delete mockStorage[k] },
    })
    // setup done + idle phase + a saved connection: the boot effect's preconditions
    mockStorage['nexus_setup_v'] = SETUP_VERSION
    setState({ ...initialState, phase: 'idle' })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })))
    resetProxyConfigCache()
    vi.mocked(doConnect).mockClear()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    resetProxyConfigCache()
    setState(initialState)
  })

  it('unlocked: reconnects with the saved server target unchanged (today\'s behavior)', async () => {
    seedConn(savedConn)
    render(<App />)
    await waitFor(() => expect(doConnect).toHaveBeenCalledTimes(1))
    const args = vi.mocked(doConnect).mock.calls[0]
    expect(args[0]).toBe('my-proxy.example.com') // wsHost
    expect(args[2]).toBe('beta.xmage.today') // serverHost — untouched
    expect(args[3]).toBe(17171) // port — untouched
    // the saved connection is NOT rewritten on an unlocked deployment
    expect(loadConn()).toMatchObject({ serverHost: 'beta.xmage.today', port: 17171 })
  })

  it('locked: substitutes the baked VITE_DEFAULT_SERVER_HOST/PORT and rewrites the saved conn', async () => {
    vi.stubEnv('VITE_LOCK_DEPLOYMENT', '1')
    vi.stubEnv('VITE_DEFAULT_SERVER_HOST', 'locked-target.example.com')
    vi.stubEnv('VITE_DEFAULT_SERVER_PORT', '15999')
    seedConn(savedConn) // a foreign saved target (beta.xmage.today)
    render(<App />)
    await waitFor(() => expect(doConnect).toHaveBeenCalledTimes(1))
    const args = vi.mocked(doConnect).mock.calls[0]
    // the baked target replaced the saved one on the connect…
    expect(args[2]).toBe('locked-target.example.com')
    expect(args[3]).toBe(15999)
    // …proxy host/port stay the saved ones (the lock is about the XMage target)
    expect(args[0]).toBe('my-proxy.example.com')
    expect(args[1]).toBe(8787)
    // …and the saved connection was rewritten so the bypass does not persist
    await waitFor(() => expect(loadConn()).toMatchObject({ serverHost: 'locked-target.example.com', port: 15999 }))
  })

  it('locked: a saved conn already on the baked target connects without a rewrite churn', async () => {
    vi.stubEnv('VITE_LOCK_DEPLOYMENT', '1')
    vi.stubEnv('VITE_DEFAULT_SERVER_HOST', 'locked-target.example.com')
    vi.stubEnv('VITE_DEFAULT_SERVER_PORT', '15999')
    seedConn({ ...savedConn, serverHost: 'locked-target.example.com', port: 15999 })
    render(<App />)
    await waitFor(() => expect(doConnect).toHaveBeenCalledTimes(1))
    const args = vi.mocked(doConnect).mock.calls[0]
    expect(args[2]).toBe('locked-target.example.com')
    expect(args[3]).toBe(15999)
    // saveConn was not called (same values — nothing to rewrite)
    expect(mockStorage['mage-web-conn']).toBe(JSON.stringify({ ...savedConn, serverHost: 'locked-target.example.com', port: 15999 }))
  })

  it('no saved connection / setup not done: no connect fires', async () => {
    mockStorage['nexus_setup_v'] = '0'
    delete mockStorage['mage-web-conn']
    render(<App />)
    expect(isSetupDone()).toBe(false)
    await new Promise((r) => setTimeout(r, 30))
    expect(doConnect).not.toHaveBeenCalled()
  })

  it('locked: setup not done (first run): the wizard owns the first connect, no boot auto-connect', async () => {
    vi.stubEnv('VITE_LOCK_DEPLOYMENT', '1')
    mockStorage['nexus_setup_v'] = '0'
    render(<App />)
    await new Promise((r) => setTimeout(r, 30))
    expect(doConnect).not.toHaveBeenCalled()
  })
})