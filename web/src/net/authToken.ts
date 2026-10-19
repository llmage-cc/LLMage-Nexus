/**
 * Per-tab proxy auth token (amended for the reload auto-attach):
 * held in module memory AND mirrored into `sessionStorage`, so a tab reload
 * re-attaches without re-prompting — "tab-refresh auto-attach stays smooth
 * without re-prompt" while every fresh WS connect still PRESENTS the token
 * (persistence never bypasses the connect). The key is scoped to this tab and
 * dies with it; the token is NEVER written to `localStorage`, a cookie or a URL.
 *
 * The token is only ever sent as `connect` `args.authToken`, and only when the
 * deployment's `/config` reported `authRequired`.
 */

const STORAGE_KEY = 'mage-web-auth-token'

function readStoredToken(): string {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) ?? ''
  } catch {
    // private mode / storage disabled: fall back to memory for this page
    return ''
  }
}

let token = readStoredToken()

/** Remember the token for this tab (memory + sessionStorage). An empty value clears it. */
export function setAuthToken(value: string): void {
  token = value
  try {
    if (value) window.sessionStorage.setItem(STORAGE_KEY, value)
    else window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // storage unavailable: memory still carries it for this page
  }
}

/** The token entered this tab (seeded from sessionStorage on load), or '' when none. */
export function getAuthToken(): string {
  return token
}

/** Forget the token (logout / after a rejection): memory and the stored copy. */
export function clearAuthToken(): void {
  token = ''
  try {
    window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // storage unavailable: nothing to clear
  }
}
