/**
 * Per-browser identifier for the hosted shared-IP problem:
 * `web:<username>:<uuid>`, persisted so it is stable across a reload AND shared
 * by every tab of the same browser. Sent on EVERY `connect` as
 * `args.browserId`; the proxy forwards it as `Connection.userIdStr` so the
 * XMage server's admin/shared-IP discrimination sees a real per-browser id
 * instead of the host proxy's.
 *
 * localStorage (not sessionStorage) is deliberate: nexus's multi-tenant proxy
 * ATTACHES a second connection of the same account to the one live session
 * ("same account, multiple windows"), and its same-name anon guard treats a
 * connect whose browserId matches the holder as the legitimate reconnect
 * takeover. A per-tab id would make a second tab look like a DIFFERENT browser,
 * breaking both. The id is not secret, so persisting it is safe.
 */

const STORAGE_KEY = 'mage-web-browser-id'

function mintId(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined
  if (c?.randomUUID) {
    try {
      return c.randomUUID()
    } catch {
      /* fall through */
    }
  }
  const rand = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10)
  return `no-crypto-${rand}`
}

/**
 * In-memory fallback for an environment with no usable web storage — the same
 * shape state/persistence.ts uses. In the browser localStorage always works; in
 * the vitest/jsdom harness it does not (Node shadows the global), and a
 * per-process id is enough there.
 */
let memoryId: string | null = null

/** localStorage when a real browser provides it, else null (do not use a global that may be Node's). */
function store(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.getItem(STORAGE_KEY) // probe: throws when storage is disabled
      return window.localStorage
    }
  } catch {
    /* privacy mode / disabled storage */
  }
  return null
}

/**
 * The browser id for a username: a stable per-browser uuid, prefixed so the
 * server can tell a web-proxy user from a desktop client. Persisted in
 * localStorage so it survives a reload and is shared by every tab of the
 * browser; degrades to a per-process in-memory id when web storage is
 * unavailable (privacy mode, test harness).
 */
export function getBrowserId(username: string): string {
  const s = store()
  if (s) {
    try {
      let id = s.getItem(STORAGE_KEY)
      if (!id) {
        id = mintId()
        s.setItem(STORAGE_KEY, id)
      }
      return `web:${username}:${id}`
    } catch {
      /* fall through to the in-memory id */
    }
  }
  if (!memoryId) {
    memoryId = mintId()
  }
  return `web:${username}:${memoryId}`
}

/** Test-only: forget the persisted + in-memory id so a spec starts from a clean browser. */
export function clearBrowserId(): void {
  memoryId = null
  const s = store()
  try {
    s?.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}
