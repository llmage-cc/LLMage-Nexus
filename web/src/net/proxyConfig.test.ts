import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_DEPLOYMENT_NAME,
  DEFAULT_PROXY_CONFIG,
  getProxyConfig,
  getProxyHttpBase,
  parseProxyConfig,
  peekProxyConfig,
  resetProxyConfigCache,
  type FetchLike,
} from './proxyConfig'

function res(body: unknown, ok = true, status = 200): { ok: boolean; status: number; json: () => Promise<unknown> } {
  return { ok, status, json: async () => body }
}

const fetchReturning = (value: { ok: boolean; status: number; json: () => Promise<unknown> }): FetchLike =>
  vi.fn(async () => value)

const fetchThrowing = (): FetchLike => vi.fn(async () => { throw new Error('network down') })

afterEach(() => resetProxyConfigCache())

describe('parseProxyConfig', () => {
  it('reads a full valid body', () => {
    const parsed = parseProxyConfig({
      authRequired: true,
      hideServerTarget: true,
      pinnedTarget: 'mage.example.com:17171',
      deploymentName: 'My Nexus',
      llmRelay: true,
    })
    expect(parsed).toEqual({
      authRequired: true,
      hideServerTarget: true,
      pinnedTarget: 'mage.example.com:17171',
      deploymentName: 'My Nexus',
      llmRelay: true,
    })
  })

  it('degrades missing or wrong-typed fields to their defaults', () => {
    expect(parseProxyConfig({ authRequired: 'yes', hideServerTarget: 1, pinnedTarget: 5, deploymentName: '', llmRelay: null }))
      .toEqual(DEFAULT_PROXY_CONFIG)
    expect(parseProxyConfig({})).toEqual(DEFAULT_PROXY_CONFIG)
  })

  it('treats a non-object body (index.html JSON scalar / array) as ALL-DEFAULTS', () => {
    expect(parseProxyConfig('<html>')).toEqual(DEFAULT_PROXY_CONFIG)
    expect(parseProxyConfig(null)).toEqual(DEFAULT_PROXY_CONFIG)
    expect(parseProxyConfig([1, 2, 3])).toEqual(DEFAULT_PROXY_CONFIG)
  })
})

describe('getProxyConfig', () => {
  it('parses a 200 body', async () => {
    const cfg = await getProxyConfig(fetchReturning(res({
      authRequired: true, hideServerTarget: false, pinnedTarget: null, deploymentName: 'Nexus Two', llmRelay: true,
    })), 'http://proxy:8788')
    expect(cfg).toEqual({
      authRequired: true, hideServerTarget: false, pinnedTarget: null, deploymentName: 'Nexus Two', llmRelay: true,
    })
    expect(peekProxyConfig()).toEqual(cfg)
  })

  it('returns ALL-DEFAULTS on 404 without throwing (old/stock proxy)', async () => {
    const cfg = await getProxyConfig(fetchReturning(res('<html>', false, 404)), 'http://proxy:8788')
    expect(cfg).toEqual(DEFAULT_PROXY_CONFIG)
    expect(cfg.deploymentName).toBe(DEFAULT_DEPLOYMENT_NAME)
  })

  it('returns ALL-DEFAULTS on a network failure', async () => {
    expect(await getProxyConfig(fetchThrowing(), 'http://proxy:8788')).toEqual(DEFAULT_PROXY_CONFIG)
  })

  it('returns ALL-DEFAULTS on a malformed body', async () => {
    expect(await getProxyConfig(fetchReturning(res([1, 2])), 'http://proxy:8788')).toEqual(DEFAULT_PROXY_CONFIG)
  })

  it('caches: a second call does not re-probe', async () => {
    const f = fetchReturning(res({ deploymentName: 'Cached' }))
    await getProxyConfig(f, 'http://proxy:8788')
    await getProxyConfig(f, 'http://proxy:8788')
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('shares one in-flight request between concurrent callers', async () => {
    const f = fetchReturning(res({ deploymentName: 'Concurrent' }))
    const [a, b] = await Promise.all([getProxyConfig(f, 'http://proxy:8788'), getProxyConfig(f, 'http://proxy:8788')])
    expect(f).toHaveBeenCalledTimes(1)
    expect(a).toEqual(b)
  })
})

describe('getProxyHttpBase', () => {
  it('defaults to WS port + 1', () => {
    expect(getProxyHttpBase('nexus.example.com', 8787)).toBe('http://nexus.example.com:8788')
  })

  it('an https page + wsPort 443 returns the page origin (same-origin /config behind the TLS edge)', () => {
    // jsdom's location is non-configurable, so the page origin is stubbed to
    // make the https-page leg deterministic.
    vi.stubGlobal('location', { origin: 'https://nexus.example.com', protocol: 'https:' })
    expect(getProxyHttpBase('wss://nexus.example.com', 443)).toBe('https://nexus.example.com')
    vi.unstubAllGlobals()
  })

  it('keeps https for a wss host and drops the scheme (every non-https-443 case keeps WS+1)', () => {
    expect(getProxyHttpBase('wss://nexus.example.com', 8787)).toBe('https://nexus.example.com:8788')
    expect(getProxyHttpBase('ws://nexus.example.com', 8787)).toBe('http://nexus.example.com:8788')
  })
})
