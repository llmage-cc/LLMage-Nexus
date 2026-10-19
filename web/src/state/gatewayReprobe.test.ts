import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Gateway } from '../net/Gateway'
import { attachGateway, probeProxyConfig, reprobeProxyConfig } from './gateway'
import { getState, setState } from './state'
import { resetProxyConfigCache, DEFAULT_PROXY_CONFIG, peekProxyConfig } from '../net/proxyConfig'
import { setAuthToken } from '../net/authToken'
import { initialState } from './state'

/**
 * A 4401 close must re-probe /config with the cache
 * dropped BEFORE the reject banner renders, so a gated deployment whose boot
 * probe failed (transient outage, proxy started later) shows its token field
 * instead of dead-ending on cached ALL-DEFAULTS.
 *
 * The gateway under test is REAL (the close handler under test lives in
 * attachGateway); only the WebSocket transport and the /config fetch are
 * fakes, mirroring the FakeWebSocket pattern of gatewayReplyFlow.test.ts.
 */

class FakeWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances: FakeWebSocket[] = []

  readonly url: string
  readyState = FakeWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onclose: ((ev: { reason?: string; code?: number }) => void) | null = null
  onerror: (() => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  send() {}
  close() {
    this.readyState = FakeWebSocket.CLOSED
  }

  triggerOpen() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }

  triggerClose(reason = '', code = 1006) {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({ reason, code })
  }
}

function gatedConfig() {
  return { authRequired: true, hideServerTarget: true, pinnedTarget: '127.0.0.1:17181', deploymentName: 'Gated', llmRelay: false }
}

describe('4401 close re-probes /config with the cache dropped', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket)
    setState(initialState)
    resetProxyConfigCache()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    setState(initialState)
    resetProxyConfigCache()
    setAuthToken('')
  })

  it('a cached ALL-DEFAULTS boot failure is dropped and the fresh gated config lands on the store', async () => {
    // boot: the probe failed (proxy still down) — ALL-DEFAULTS cached in the
    // module AND on the store, exactly the dead-end described above
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    await probeProxyConfig('localhost', 8787)
    expect(getState().proxyConfig).toEqual(DEFAULT_PROXY_CONFIG)

    // the proxy is up now and answers GATED
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200, json: async () => gatedConfig(),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const g = new Gateway()
    attachGateway(g)
    const opened = g.connect('ws://proxy.test:8787')
    FakeWebSocket.instances[FakeWebSocket.instances.length - 1].triggerOpen()
    await opened

    // the connect is refused: 4401
    ;(g.ws as unknown as FakeWebSocket).triggerClose('Auth token required', 4401)

    // the reject banner is already rendered (proxyReject set synchronously, mapped to
    // the localized segments the banner interpolates — no raw English payload)…
    expect(getState().proxyReject).toBe('Token de acceso: Requerido por este proxy')
    // …and the re-probe hits /config exactly once, with fresh gated result
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(getState().proxyConfig).toEqual(gatedConfig())
    })
    expect(peekProxyConfig()).toEqual(gatedConfig())
  })

  it('a cached NON-defaults config is left alone: the 4401 handler does not re-fetch', async () => {
    // a settled, non-defaults probe: the proxy's config is already known
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => gatedConfig() })))
    await probeProxyConfig('localhost', 8787)
    expect(getState().proxyConfig).toEqual(gatedConfig())
    const fetchMock = vi.mocked(fetch)

    const g = new Gateway()
    attachGateway(g)
    const opened = g.connect('ws://proxy.test:8787')
    FakeWebSocket.instances[FakeWebSocket.instances.length - 1].triggerOpen()
    await opened
    ;(g.ws as unknown as FakeWebSocket).triggerClose('Auth token required', 4401)

    expect(getState().proxyReject).toBe('Token de acceso: Requerido por este proxy')
    // fire-and-forget: give the microtask queue a beat to prove no fetch fired
    await new Promise((r) => setTimeout(r, 30))
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('/config'))).toHaveLength(1) // only the boot probe
    expect(getState().proxyConfig).toEqual(gatedConfig())
  })

  it('no cache at all (4401 before any probe): quiet, the App boot probe still owns first paint', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => gatedConfig() }))
    vi.stubGlobal('fetch', fetchMock)
    expect(peekProxyConfig()).toBeNull()

    const g = new Gateway()
    attachGateway(g)
    const opened = g.connect('ws://proxy.test:8787')
    FakeWebSocket.instances[FakeWebSocket.instances.length - 1].triggerOpen()
    await opened
    ;(g.ws as unknown as FakeWebSocket).triggerClose('Bad or missing auth token', 4401)

    expect(getState().proxyReject).toBe('Token de acceso: Requerido por este proxy')
    await new Promise((r) => setTimeout(r, 30))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reprobeProxyConfig itself drops the module cache and setStates the fresh result', async () => {
    // the helper the 4401 handler leans on, tested directly: a cached 404
    // failure is replaced by a fresh gated answer
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })))
    await probeProxyConfig('localhost', 8787)
    expect(peekProxyConfig()).toEqual(DEFAULT_PROXY_CONFIG)

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => gatedConfig() })))
    const cfg = await reprobeProxyConfig('localhost', 8787)
    expect(cfg).toEqual(gatedConfig())
    expect(getState().proxyConfig).toEqual(gatedConfig())
    expect(peekProxyConfig()).toEqual(gatedConfig())
  })
})