/**
 * Per-seat client keys for LLM seats, keyed by an opaque browser-generated tag
 * (clientKeyTag) — ported from the LLMage webui's llmBridgeClient.ts.
 * The key NEVER reaches the proxy or the server:
 * on submit the browser stores it here (module memory only, never
 * localStorage/sessionStorage/cookies) and sends only useClientKey +
 * clientKeyTag. A page refresh drops the keys; the seat then falls back to the
 * server key unless the user re-enters it.
 *
 * Each entry also carries the endpoint the user chose for the seat: the
 * client-key bridge refuses to attach the key to a call
 * whose endpoint differs from the one bound at submit, so a malicious or
 * compromised server cannot redirect the browser's key to its own endpoint
 * by naming it in the `llm_prompt` frame. The endpoint is a plain config field
 * that already rides the wire in llmConfigs, so binding it here discloses
 * nothing new; like the key it lives in memory only.
 */

interface SeatKeyEntry {
  key: string
  endpoint: string
}

const seatKeys = new Map<string, SeatKeyEntry>()

/**
 * Hard cap on live seat keys. A tag is minted per
 * submit and its entry is needed for as long as the server may ask this browser
 * for that seat's answer, so nothing is evicted at submit time; a page that
 * creates table after table (or whose create call fails after the tags were
 * minted) would otherwise keep every key it ever minted. The cap evicts the
 * least recently USED entry first, and a live seat's tag is touched on every
 * provider call (`getSeatKey`), so it can never be the victim.
 */
export const MAX_SEAT_KEYS = 64

/** Move a used tag to the back of the Map's insertion order (LRU). */
function touchSeatKey(tag: string): void {
  const entry = seatKeys.get(tag)
  if (!entry) return
  seatKeys.delete(tag)
  seatKeys.set(tag, entry)
}

/** Drop the least recently used entries until the store is back under the cap. */
function evictSeatKeyOverflow(): void {
  while (seatKeys.size > MAX_SEAT_KEYS) {
    const oldest = seatKeys.keys().next().value
    if (oldest === undefined) return
    seatKeys.delete(oldest)
  }
}

export function setSeatKey(tag: string, key: string): void {
  const trimmed = key.trim()
  if (trimmed) {
    // Keep any endpoint already bound to the tag: the key and the binding are
    // one seat entry, and re-submitting a key must not silently unbind it.
    const endpoint = seatKeys.get(tag)?.endpoint ?? ''
    touchSeatKey(tag)
    seatKeys.set(tag, { key: trimmed, endpoint })
    evictSeatKeyOverflow()
  } else {
    seatKeys.delete(tag)
  }
}

/**
 * Bind the seat's chosen apiEndpoint to a tag that already carries a key (the
 * wire conversion calls this right after `setSeatKey` mints the tag). An empty
 * string means the user chose no endpoint (server default). Unknown tags are
 * ignored so an endpoint can never create a keyless entry.
 */
export function setSeatEndpoint(tag: string, endpoint: string): void {
  const entry = seatKeys.get(tag)
  if (entry) entry.endpoint = endpoint.trim()
}

/**
 * The endpoint bound to a tag: '' when the seat chose no endpoint, null when
 * the tag has no entry at all (no key stored — callers check `hasSeatKey`
 * first, exactly like `getSeatKey`).
 */
export function seatEndpointOf(tag: string): string | null {
  return seatKeys.get(tag)?.endpoint ?? null
}

export function hasSeatKey(tag: string): boolean {
  return seatKeys.has(tag)
}

/**
 * The stored key for a tag. Throws when absent: the caller must first check
 * `hasSeatKey`, so an absent tag here is a programming error (the client-key
 * bridge answers the server with an `llm_error` instead of calling this).
 * The returned key is NEVER logged, persisted or sent on any WebSocket frame —
 * it only ever rides the provider request's Authorization header.
 */
export function getSeatKey(tag: string): string {
  const key = seatKeys.get(tag)?.key
  if (!key) {
    throw new Error(
      `No API key stored for tag ${tag} — re-enter the key in the game setup (keys are memory-only and do not survive a page refresh)`,
    )
  }
  // This is the tag of a seat the server is asking about right now: keep it warm.
  touchSeatKey(tag)
  return key
}

export function clearSeatKeys(): void {
  seatKeys.clear()
}

/** Fresh tag for a newly configured client-key seat. */
export function newClientKeyTag(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return 'k-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}