import { afterEach, describe, expect, it, vi } from 'vitest'
import { getProxyConfig, getProxyHttpBase, resetProxyConfigCache, DEFAULT_PROXY_CONFIG, type FetchLike } from './proxyConfig'

/**
 * Same-origin /config for a TLS-edge deployment.
 *
 * A deployment that serves the webapp AND the proxy behind one TLS edge on 443
 * (wss://host → https://host, no separate HTTP port) cannot be probed at
 * `wsPort + 1` — that port is not exposed. The proxy's /config is then a
 * SAME-ORIGIN document (the edge routes it), so the base is the page origin.
 */

function res(body: unknown, ok = true, status = 200): { ok: boolean; status: number; json: () => Promise<unknown> } {
  return { ok, status, json: async () => body }
}

const fetchReturning = (value: { ok: boolean; status: number; json: () => Promise<unknown> }): FetchLike =>
  vi.fn(async () => value)

afterEach(() => {
  vi.unstubAllGlobals()
  resetProxyConfigCache()
})

describe('getProxyHttpBase (https+443 same-origin)', () => {
  it('https page + wsPort 443 returns the page origin (same-origin /config behind the TLS edge)', () => {
    // deterministic origin: jsdom's location is non-configurable, so stub the global.
    vi.stubGlobal('location', { origin: 'https://nexus.example.com', protocol: 'https:' })
    expect(getProxyHttpBase('wss://nexus.example.com', 443)).toBe('https://nexus.example.com')
  })

  it('http page + wsPort 443 keeps the +1 rule (only an https page is same-origin under the edge)', () => {
    vi.stubGlobal('location', { origin: 'http://nexus.example.com', protocol: 'http:' })
    expect(getProxyHttpBase('wss://nexus.example.com', 443)).toBe('https://nexus.example.com:444')
  })

  it('http page with a plain host keeps WS+1 (nexus convention 8787/8788 unchanged)', () => {
    vi.stubGlobal('location', { origin: 'http://localhost:3000', protocol: 'http:' })
    expect(getProxyHttpBase('nexus.example.com', 8787)).toBe('http://nexus.example.com:8788')
  })
})

describe('getProxyConfig (re-probe after reset)', () => {
  it('resetProxyConfigCache drops the cached failure so the next call re-probes /config', async () => {
    // first probe fails (network down at boot): ALL-DEFAULTS gets cached
    const failing = fetchReturning(res('<html>', false, 404))
    expect(await getProxyConfig(failing, 'https://nexus.example.com')).toEqual(DEFAULT_PROXY_CONFIG)
    // reset (what the 4401 close handler does before rendering the reject)
    resetProxyConfigCache()
    // the next probe hits /config again — now the proxy is up and answers gated
    const live = fetchReturning(res({ authRequired: true }))
    const cfg = await getProxyConfig(live, 'https://nexus.example.com')
    expect(cfg.authRequired).toBe(true)
    expect(live).toHaveBeenCalledTimes(1)
  })
})