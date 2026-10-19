import { loadConn } from '../persistence'
import type { ConnectionInfo } from '../persistence'
import { DEFAULT_PROXY_CONFIG, type ProxyConfig } from '../../net/proxyConfig'

/** Health of a logged-in session, shown as a banner while it is not `ok`:
 *  `ws-down` the socket to the proxy dropped and reconnects, `relogging` the
 *  socket is back and the session is being restored, `relogin-retry` that
 *  restore failed and is retried, `server-lost` the proxy lost the XMage server
 *  and logs in again on its own. */
export type LinkStatus = 'ok' | 'ws-down' | 'relogging' | 'relogin-retry' | 'server-lost'

/**
 * Live progress of the automatic login retries after the server refuses with "already
 * connected" (the account's previous session is still alive on the server). `until` is an
 * epoch ms so the connecting splash can count the wait down instead of looking frozen.
 */
export interface LoginRetry {
  attempt: number
  max: number
  until: number
}

/**
 * Feature flags the proxy reports on every successful connect result. `null` =
 * not reported (old proxy, stock server, failed connect): every LLM/replay
 * feature stays hidden. `playerTypes` is informational — the seat dropdown
 * still lists what getPlayerTypes() answers.
 */
export interface Capabilities {
  llm: boolean
  p1: boolean
  replayScrubber: boolean
  replaySidecar: boolean
  serverVersion: string
  playerTypes: string[]
}

/**
 * Read `data.capabilities` off a connect result. Missing or malformed fields
 * degrade to `null` (all gated features hidden) — this never throws: it rides
 * the connect path and a bad payload must not break login.
 */
export function parseCapabilities(data: unknown): Capabilities | null {
  if (typeof data !== 'object' || data === null) return null
  const raw = (data as { capabilities?: unknown }).capabilities
  if (typeof raw !== 'object' || raw === null) return null
  const c = raw as Record<string, unknown>
  if (
    typeof c.llm !== 'boolean' ||
    typeof c.p1 !== 'boolean' ||
    typeof c.replayScrubber !== 'boolean' ||
    typeof c.replaySidecar !== 'boolean' ||
    typeof c.serverVersion !== 'string'
  ) {
    return null
  }
  const playerTypes = Array.isArray(c.playerTypes)
    ? c.playerTypes.filter((pt): pt is string => typeof pt === 'string')
    : []
  return {
    llm: c.llm,
    p1: c.p1,
    replayScrubber: c.replayScrubber,
    replaySidecar: c.replaySidecar,
    serverVersion: c.serverVersion,
    playerTypes,
  }
}

export interface SessionSlice {
  phase: 'idle' | 'connecting' | 'lobby' | 'spectating_pending' | 'staging' | 'game'
  conn: ConnectionInfo | null
  wsUrl: string | null
  connecting: boolean
  wsAlive: boolean
  error: string | null
  link: LinkStatus
  linkAttempt: number
  loginRetry: LoginRetry | null
  /** Features the connected server reported; null = reported nothing. */
  capabilities: Capabilities | null
  /**
   * The deployment config probed from the proxy's `GET /config` before the login
   * screen. ALL-DEFAULTS until the probe settles (and forever, on an
   * old/stock proxy that 404s): the auth-token field, the pinned target and the
   * page-title branding all read from here.
   */
  proxyConfig: ProxyConfig
  /**
   * The proxy's typed reason for REFUSING the last connect over a 4401 close
   * (auth token, name already held, target refused). Non-null only when the
   * user must fix the input: it suppresses auto-reconnect and surfaces a
   * dedicated banner on the login screen. Cleared on the next attempt.
   */
  proxyReject: string | null
}

export const initialSession: SessionSlice = {
  phase: 'idle',
  conn: loadConn(),
  wsUrl: null,
  connecting: false,
  wsAlive: false,
  error: null,
  link: 'ok',
  linkAttempt: 0,
  loginRetry: null,
  capabilities: null,
  proxyConfig: DEFAULT_PROXY_CONFIG,
  proxyReject: null,
}
