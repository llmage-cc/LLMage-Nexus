/**
 * Deployment config the web proxy serves at GET /config.
 *
 * The proxy is the only component that knows how a deployment is hosted, so the
 * browser asks it (rather than guessing from its own URL) whether the connect
 * form must expose the XMage target fields and whether it needs an auth token.
 * The probe runs once per session and is cached: an old/stock proxy answers 404
 * (or is unreachable), which degrades to ALL-DEFAULTS instead of an error, so a
 * stock deployment keeps working unchanged.
 */

/** The proxy's HTTP port is its WS port + 1 (nexus convention 8787/8788). */
const DEFAULT_WS_PORT = Number(import.meta.env.VITE_DEFAULT_PROXY_PORT) || 8787

/** Explicit override for hosts where the HTTP config port is not WS+1. */
const HTTP_BASE_OVERRIDE = ((import.meta.env.VITE_PROXY_HTTP_BASE as string | undefined) ?? '').trim()

/** The default deployment name — NO fork-hardcoded branding. */
export const DEFAULT_DEPLOYMENT_NAME = 'XMage Nexus'

/** The shape of the proxy's `GET /config` body. */
export interface ProxyConfig {
  /** Every connect must carry `args.authToken` when true. */
  authRequired: boolean
  /** The proxy pins the XMage target: the form hides Server/Port. */
  hideServerTarget: boolean
  /** The pinned `host:port`, shown read-only; null when unpinned. */
  pinnedTarget: string | null
  /** Base document title / branding name. */
  deploymentName: string
  /** The `--llmRelayEnabled` toggle. */
  llmRelay: boolean
}

/** What an old/stock/unreachable proxy means: every gate off, stock branding. */
export const DEFAULT_PROXY_CONFIG: ProxyConfig = {
  authRequired: false,
  hideServerTarget: false,
  pinnedTarget: null,
  deploymentName: DEFAULT_DEPLOYMENT_NAME,
  llmRelay: false,
}

/** Minimal fetch shape — lets tests drive failures without a live proxy. */
export type FetchLike = (
  url: string,
  init?: { cache?: RequestCache },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

let cached: ProxyConfig | null = null
let inflight: Promise<ProxyConfig> | null = null

/**
 * The base URL for the proxy's HTTP endpoint. Default is
 * `${pageProtocol}//<wsHost>:<wsPort + 1>`; the `wsHost` may be given with a
 * `ws://`/`wss://` scheme (the scheme is swapped for http/https). A
 * `VITE_PROXY_HTTP_BASE` build var overrides the whole thing.
 *
 * When the page itself is served over https AND the proxy's WS port is
 * 443, the deployment sits behind one TLS edge that does not expose the
 * +1 HTTP port — `/config` is then a same-origin document the edge routes,
 * so the base is the page origin.
 */
export function getProxyHttpBase(wsHost?: string, wsPort?: number): string {
  if (HTTP_BASE_OVERRIDE) return HTTP_BASE_OVERRIDE
  const port = wsPort ?? DEFAULT_WS_PORT
  const raw = (wsHost ?? '').trim()
  const pageProto = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'https:' : 'http:'
  // https page + wss 443: same-origin /config behind the TLS edge
  if (pageProto === 'https:' && port === 443) return window.location.origin
  if (!raw) return `${pageProto}//${window.location.hostname}:${port + 1}`
  if (raw.includes('://')) {
    const proto = raw.startsWith('wss:') ? 'https:' : 'http:'
    let hostname = raw
    try {
      hostname = new URL(raw).hostname
    } catch {
      /* keep the raw string */
    }
    return `${proto}//${hostname}:${port + 1}`
  }
  return `${pageProto}//${raw}:${port + 1}`
}

/**
 * Normalize a `GET /config` body. Never throws: any field that is missing or of
 * the wrong type degrades to its default, so a partial or malformed body stays
 * usable. A non-object body (a JSON scalar, an array, the SPA index.html the
 * proxy falls back to) is ALL-DEFAULTS.
 */
export function parseProxyConfig(body: unknown): ProxyConfig {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ...DEFAULT_PROXY_CONFIG }
  }
  const b = body as Record<string, unknown>
  const pinned = typeof b.pinnedTarget === 'string' && b.pinnedTarget.trim() !== '' ? b.pinnedTarget.trim() : null
  const name = typeof b.deploymentName === 'string' && b.deploymentName.trim() !== '' ? b.deploymentName.trim() : DEFAULT_DEPLOYMENT_NAME
  return {
    authRequired: typeof b.authRequired === 'boolean' ? b.authRequired : false,
    hideServerTarget: typeof b.hideServerTarget === 'boolean' ? b.hideServerTarget : false,
    pinnedTarget: pinned,
    deploymentName: name,
    llmRelay: typeof b.llmRelay === 'boolean' ? b.llmRelay : false,
  }
}

async function probe(fetchFn: FetchLike, base: string): Promise<ProxyConfig> {
  try {
    const res = await fetchFn(`${base}/config`, { cache: 'no-store' })
    if (!res.ok) return { ...DEFAULT_PROXY_CONFIG }
    return parseProxyConfig(await res.json())
  } catch {
    // network failure / malformed JSON / fetch unavailable: an old or stock
    // proxy must keep working, never an error.
    return { ...DEFAULT_PROXY_CONFIG }
  }
}

/**
 * Fetch and cache `GET /config` (probe once per session). Concurrent callers
 * share one request. A 404, a network failure or a malformed body resolves to
 * ALL-DEFAULTS. The cached value is also kept in module memory for the
 * synchronous `peekProxyConfig()` used after a store reset.
 */
export function getProxyConfig(fetchFn: FetchLike = fetch, base: string = getProxyHttpBase()): Promise<ProxyConfig> {
  if (cached) return Promise.resolve(cached)
  if (!inflight) {
    inflight = probe(fetchFn, base).then((config) => {
      cached = config
      inflight = null
      return config
    })
  }
  return inflight
}

/** The probed config, or null when the probe has not settled yet. */
export function peekProxyConfig(): ProxyConfig | null {
  return cached
}

/**
 * True when `config` carries the ALL-DEFAULTS shape: every gate off, stock
 * branding. A probe that DEGRADED to this (404, network failure,
 * malformed body) is indistinguishable from a genuinely stock proxy — it is
 * the one cached shape a 4401 reject must re-check, because a gated proxy
 * answering 4401 can never have legitimately produced it.
 */
export function isAllDefaultsConfig(config: ProxyConfig): boolean {
  return (
    config.authRequired === DEFAULT_PROXY_CONFIG.authRequired
    && config.hideServerTarget === DEFAULT_PROXY_CONFIG.hideServerTarget
    && config.pinnedTarget === DEFAULT_PROXY_CONFIG.pinnedTarget
    && config.deploymentName === DEFAULT_PROXY_CONFIG.deploymentName
    && config.llmRelay === DEFAULT_PROXY_CONFIG.llmRelay
  )
}

/** Test-only: drop the module cache so a spec can exercise every state. */
export function resetProxyConfigCache(): void {
  cached = null
  inflight = null
}
