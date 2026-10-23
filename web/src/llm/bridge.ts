/**
 * Browser-side client-key LLM bridge (the web half of the client-key bridge).
 *
 * The server (a fork build with LLM seats and `capabilities.llm === true`)
 * sends a typed `llm_prompt` frame carrying the exact OpenAI-compatible
 * request body it would have POSTed, plus the opaque `clientKeyTag` of the
 * seat. This module attaches the user's API key — which is NEVER sent to the
 * server or the proxy — and performs the call:
 *
 *   1. Browser-direct `fetch` to the provider when it serves CORS headers
 *      (OpenAI, OpenRouter, Groq, a local Ollama, any custom endpoint).
 *   2. Same-origin `/llm-relay?url=…` when the endpoint is a provider known to
 *      send no CORS headers (the proxy relay echoes the bytes and adds CORS
 *      headers; it never reads, logs or stores `Authorization`).
 *
 * The key lives in module memory only (`llmSeatKeys`): never localStorage,
 * sessionStorage, cookies, logs, or any WebSocket frame. A page refresh drops
 * it; the seat concedes at timeout unless the user re-enters it. That trade-off
 * is deliberate — keys on disk in a browser are keys in every XSS's reach.
 *
 * Fire-and-forget: `handleLlmPrompt` never throws to its caller (the
 * eventHandler/messageHandlers path must not gain an async error path); the
 * server-side future owns the timeout. An answer whose send finds the socket
 * down is held (keyed by `requestId`, the server's correlation id) and re-sent
 * when the socket is back (`flushUndeliveredLlmAnswers`) instead of leaving the
 * server-side future to burn its whole timeout.
 */

import type { LlmDecisionArgs, LlmErrorArgs } from '../net/commands'
import type { LlmPromptFrame } from '../net/types.generated'
import type { LogChannel } from '../state/slices/lobby'
import { getSeatKey, hasSeatKey, seatEndpointOf } from '../lobby/CreateTable/llmSeatKeys'
import { isRelayEndpoint } from '../lobby/CreateTable/llmConfig'
import { peekProxyConfig } from '../net/proxyConfig'
import { t } from '../i18n'

/** Same-origin CORS relay path on the proxy. */
export const RELAY_PATH = '/llm-relay'

/**
 * Whether the deployment's `GET /config` says the proxy did not register
 * `/llm-relay` (stock proxy, or `--llmRelayEnabled` left off). `null` — no probe
 * has settled yet — stays optimistic: the call is attempted and a missing route
 * surfaces as the provider's HTTP 404. A settled probe is guaranteed before any
 * `llm_prompt` can arrive (the boot probe precedes login).
 */
export function isRelayRouteMissing(): boolean {
  return peekProxyConfig()?.llmRelay === false
}

/**
 * Raised instead of fetching when a relay-only provider meets a deployment
 * without `/llm-relay`: the request would 404 at the proxy with no explanation,
 * so the seat is told the actual cause and that a direct provider works.
 */
export class LlmRelayUnavailableError extends Error {
  readonly apiEndpoint: string

  constructor(apiEndpoint: string) {
    super(
      `LLM relay unavailable: this deployment does not expose ${RELAY_PATH}, so the relay-only ` +
        `provider "${apiEndpoint}" cannot be called. Choose a provider the browser can reach ` +
        'directly (OpenAI, OpenRouter, Groq or a local Ollama), or start the proxy with ' +
        '--llmRelayEnabled.',
    )
    this.name = 'LlmRelayUnavailableError'
    this.apiEndpoint = apiEndpoint
  }
}

/** Cap on the provider body echoed in a failure message. */
const ERROR_BODY_CHARS = 400

/**
 * Hard clamp on the frame's requested provider timeout: a forged frame
 * with 1e9 seconds must not pin the fetch forever, and 0/negative/NaN must not
 * abort instantly — both fall back to the 600s default the seat config means.
 */
export function clampTimeoutSeconds(timeoutSeconds: number): number {
  return Math.min(Math.max(Number(timeoutSeconds) || 0, 1), 600)
}

/**
 * Scrub bearer-like secrets out of a provider error body before it is echoed
 * anywhere: a provider that echoes request headers back in its error text
 * would otherwise repeat the user's key on the wire/log. Non-secret
 * diagnostics (status reasons, rate-limit text) pass through untouched.
 */
export function scrubBearerTokens(text: string): string {
  return text.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, '[redacted]')
}

/** Callbacks injected by the caller so the bridge stays free of the transport. */
export interface LlmBridgeTransport {
  /**
   * Send the provider's response back to the proxy (`llm_decision`). Returns the
   * gateway's `send()` envelope when it has one: the bridge holds the answer for
   * a re-send when that envelope says the socket was down.
   */
  sendDecision: (args: LlmDecisionArgs) => unknown
  /** Send a failure back to the proxy (`llm_error`). Same result contract as `sendDecision`. */
  sendError: (args: LlmErrorArgs) => unknown
  /** Surface a local (never server-facing) note in the log. */
  log?: (from: string, text: string, channel?: LogChannel) => void
}

/** The gateway's `send()` envelope, as much of it as the hold rule reads. */
interface SendEnvelope {
  ok?: unknown
  error?: unknown
  errorCode?: unknown
}

/**
 * The frame never reached the wire: the socket was down when the answer was
 * ready (`'not connected'`), or it was dropped on the way out. A
 * sent-but-unanswered request (`'timeout'`) or a far-end rejection is excluded —
 * duplicating such an answer for one requestId helps nobody.
 */
function notDelivered(res: unknown): boolean {
  if (typeof res !== 'object' || res === null) return false
  const r = res as SendEnvelope
  if (r.ok !== false) return false
  return r.errorCode === 'NOT_CONNECTED'
    || r.error === 'not connected'
    || r.error === 'disconnected'
    || r.error === 'heartbeat timeout'
}

function isThenable(res: unknown): res is Promise<unknown> {
  return typeof (res as { then?: unknown } | null)?.then === 'function'
}

/**
 * Answers the socket could not carry: a socket that
 * dropped between the `llm_prompt` and its answer resolves `send()` as
 * `ok:false 'not connected'`, and the server-side future then burns its whole
 * timeout for an answer this browser already has. The answer is held here,
 * keyed by `requestId` — the id the server correlates on — and re-sent as soon
 * as the socket is known to be live again (`flushUndeliveredLlmAnswers`).
 */
const undeliveredAnswers = new Map<string, () => unknown>()

/** Hard cap: only the answers that can still be pending are worth holding. */
export const MAX_UNDELIVERED_LLM_ANSWERS = 8

/** How many answers the socket dropped and are still held (diagnostics/tests). */
export function undeliveredLlmAnswerCount(): number {
  return undeliveredAnswers.size
}

/** Hold an answer whose send found the socket down; a newer answer for the same exchange wins. */
function holdAnswer(requestId: string, resend: () => unknown): void {
  undeliveredAnswers.delete(requestId)
  undeliveredAnswers.set(requestId, resend)
  while (undeliveredAnswers.size > MAX_UNDELIVERED_LLM_ANSWERS) {
    const oldest = undeliveredAnswers.keys().next().value
    if (oldest === undefined) break
    undeliveredAnswers.delete(oldest)
  }
}

/**
 * Deliver one answer, holding it when the gateway reports the frame never left
 * the browser. The call itself stays synchronous: the transport may answer with
 * the send promise (`cmds.llmDecision`), which is inspected asynchronously.
 */
function deliverAnswer(requestId: string, send: () => unknown): void {
  const res = send()
  if (isThenable(res)) {
    void Promise.resolve(res).then(
      (settled) => {
        if (notDelivered(settled)) holdAnswer(requestId, send)
      },
      () => {},
    )
    return
  }
  if (notDelivered(res)) holdAnswer(requestId, send)
}

/**
 * Re-send every held answer. Called when the socket is known to be live again
 * (the proxy's `connected` frame, or an inbound `llm_prompt`): the server still
 * correlates the answer by `requestId`, so an exchange whose socket dropped
 * mid-flight no longer has to burn its full timeout. An answer that goes out —
 * or whose exchange the server no longer knows, which it ignores — leaves the
 * queue; one that fails again stays for the next opportunity.
 */
export async function flushUndeliveredLlmAnswers(): Promise<void> {
  if (undeliveredAnswers.size === 0) return
  for (const [requestId, resend] of [...undeliveredAnswers]) {
    let res: unknown
    try {
      res = await resend()
    } catch {
      // No transport at all (the session is gone): the answer stays queued for a
      // later opportunity instead of rejecting the caller's fire-and-forget call.
      return
    }
    if (!notDelivered(res) && undeliveredAnswers.get(requestId) === resend) {
      undeliveredAnswers.delete(requestId)
    }
  }
}

/** The request URL for an endpoint: the endpoint itself, or the same-origin relay. */
export function providerUrl(apiEndpoint: string, viaRelay: boolean): string {
  if (!viaRelay) return apiEndpoint
  return RELAY_PATH + '?url=' + encodeURIComponent(apiEndpoint)
}

/**
 * OpenCode Go/Zen requires `x-opencode-session` (stable per conversation) or
 * rejects the request with 400 MissingSessionID. One stable id per key-tag
 * (per seat), minted lazily and kept in memory.
 *
 * Bounded: one entry per key-tag and nothing pruned
 * a tag whose table is gone, so a long session accumulated them forever. The
 * cap evicts the least recently used tag first, and a live seat re-reads its id
 * on every provider call, so its entry is never the victim.
 */
const opencodeSessions = new Map<string, string>()

/** Hard cap on remembered OpenCode session ids. */
export const MAX_OPENCODE_SESSIONS = 64

/** Number of remembered OpenCode session ids (diagnostics/tests). */
export function opencodeSessionCount(): number {
  return opencodeSessions.size
}

function opencodeSessionFor(tag: string): string {
  const known = opencodeSessions.get(tag)
  if (known) {
    // Re-read on every call: keep the live seat's id at the warm end of the Map.
    opencodeSessions.delete(tag)
    opencodeSessions.set(tag, known)
    return known
  }
  const s =
    'nexus-' +
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36))
  opencodeSessions.set(tag, s)
  while (opencodeSessions.size > MAX_OPENCODE_SESSIONS) {
    const oldest = opencodeSessions.keys().next().value
    if (oldest === undefined) break
    opencodeSessions.delete(oldest)
  }
  return s
}

/** Whether this endpoint's host is `opencode.ai`. */
export function isOpencodeHost(url: string): boolean {
  try {
    return new URL(url).hostname === 'opencode.ai'
  } catch {
    return false
  }
}

/** `@internal` — the key must never be readable from other modules. */
function keyFor(tag: string): string {
  return getSeatKey(tag)
}

export interface ProviderCallResult {
  rawResponse: string
  httpStatus: number
  viaRelay: boolean
}

/**
 * POST the server-built body to the provider with the seat's stored key.
 *
 * Throws on a missing key (the key throws before any request is made), on a
 * relay route the deployment does not expose, and on any fetch/abort failure; a
 * non-2xx HTTP status is NOT a throw — the status and body come back so the
 * caller can classify it.
 */
export async function callProvider(
  apiEndpoint: string,
  clientKeyTag: string,
  requestBody: string,
  timeoutSeconds: number,
): Promise<ProviderCallResult> {
  const viaRelay = isRelayEndpoint(apiEndpoint)
  if (viaRelay && isRelayRouteMissing()) throw new LlmRelayUnavailableError(apiEndpoint)
  const key = keyFor(clientKeyTag)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), clampTimeoutSeconds(timeoutSeconds) * 1000)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: 'Bearer ' + key,
  }
  if (isOpencodeHost(apiEndpoint)) {
    headers['x-opencode-session'] = opencodeSessionFor(clientKeyTag)
  }
  try {
    const resp = await fetch(providerUrl(apiEndpoint, viaRelay), {
      method: 'POST',
      headers,
      body: requestBody,
      signal: controller.signal,
    })
    const rawResponse = await resp.text()
    return { rawResponse, httpStatus: resp.status, viaRelay }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Handle an incoming `llm_prompt`: perform the provider call, then send the
 * decision/error back through the transport. Fire-and-forget — the promise's
 * rejection is handled here and never propagates to the caller.
 *
 * Endpoint trust: the frame's apiEndpoint is only
 * honored when it matches the endpoint bound to the clientKeyTag at submit
 * time. A mismatch (a malicious or compromised server naming its own endpoint)
 * answers `llm_error` retryable:false and NEVER fetches, so the key cannot be
 * redirected. When no endpoint is stored (seat created before the binding
 * existed, or the user chose the server default) the call falls through, but
 * only to an https endpoint — the http exceptions in the provider table
 * (local Ollama) are covered by the binding, not the fallthrough.
 */
export function handleLlmPrompt(msg: LlmPromptFrame, transport: LlmBridgeTransport): void {
  if (!hasSeatKey(msg.clientKeyTag)) {
    const message = t('game', 'llm_no_key_for_seat')
    transport.log?.('error', message, 'system')
    deliverAnswer(msg.requestId, () =>
      transport.sendError({ requestId: msg.requestId, message, retryable: false }),
    )
    return
  }
  const boundEndpoint = seatEndpointOf(msg.clientKeyTag)
  const frameEndpoint = String(msg.apiEndpoint ?? '').trim()
  if (boundEndpoint !== null && boundEndpoint !== '') {
    if (frameEndpoint !== boundEndpoint) {
      const message =
        `LLM bridge endpoint mismatch: this seat's key is bound to "${boundEndpoint || 'the server default'}"` +
        ` but the prompt named "${frameEndpoint || 'the server default'}" — refusing the provider call.`
      transport.log?.('error', message, 'system')
      deliverAnswer(msg.requestId, () =>
        transport.sendError({ requestId: msg.requestId, message, retryable: false }),
      )
      return
    }
  } else if (!/^https:\/\//i.test(frameEndpoint)) {
    // No stored binding: keep the pre-binding behavior of honoring the frame's
    // endpoint, but never attach the key to a plain-http target.
    const message =
      `LLM bridge refusing non-https provider endpoint "${frameEndpoint}" for an unbound client key — ` +
      'choose an explicit endpoint for this seat or re-enter its key.'
    transport.log?.('error', message, 'system')
    deliverAnswer(msg.requestId, () =>
      transport.sendError({ requestId: msg.requestId, message, retryable: false }),
    )
    return
  }
  if (msg.stream) {
    // The bridge answers with a single complete response (the server-side
    // future owns the timeout); streaming frames are not parsed.
    transport.log?.(
      'info',
      'LLM streaming not supported by the web bridge — the response will arrive complete',
      'system',
    )
  }
  void callProvider(msg.apiEndpoint, msg.clientKeyTag, msg.requestBody, msg.timeoutSeconds)
    .then((result) => {
      if (result.httpStatus >= 200 && result.httpStatus < 300) {
        deliverAnswer(msg.requestId, () =>
          transport.sendDecision({
            requestId: msg.requestId,
            rawResponse: result.rawResponse,
            httpStatus: result.httpStatus,
          }),
        )
      } else {
        transport.log?.(
          'error',
          t('game', 'llm_provider_http_error', {
            status: result.httpStatus,
            route: result.viaRelay ? 'relay' : 'browser-direct',
          }),
          'system',
        )
        deliverAnswer(msg.requestId, () =>
          transport.sendError({
            requestId: msg.requestId,
            message:
              `HTTP ${result.httpStatus} from provider` +
              (result.viaRelay ? ' (via relay)' : ' (browser-direct)') +
              `: ${scrubBearerTokens(result.rawResponse).slice(0, ERROR_BODY_CHARS)}`,
            retryable: result.httpStatus === 429 || result.httpStatus >= 500,
            httpStatus: result.httpStatus,
          }),
        )
      }
    })
    .catch((e: unknown) => {
      if (e instanceof LlmRelayUnavailableError) {
        transport.log?.('error', e.message, 'system')
        deliverAnswer(msg.requestId, () =>
          transport.sendError({ requestId: msg.requestId, message: e.message, retryable: false }),
        )
        return
      }
      transport.log?.(
        'error',
        t('game', 'llm_provider_not_delivered', { detail: e instanceof Error ? e.message : String(e) }),
        'system',
      )
      deliverAnswer(msg.requestId, () =>
        transport.sendError({
          requestId: msg.requestId,
          message: `Browser LLM call failed: ${e instanceof Error ? e.message : String(e)}`,
          // network/CORS/abort failures are retryable server-side
          retryable: true,
        }),
      )
    })
}
