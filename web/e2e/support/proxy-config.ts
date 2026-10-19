/**
 * HTTP-side stub for the proxy's `GET /config` deployment gate.
 *
 * The fake backend is a WS-only FixtureServer; the web's `getProxyConfig()` does
 * a plain `fetch('<httpBase>/config')` BEFORE the login screen renders, so a spec
 * answers it with Playwright routing. The route glob (double-star + slash +
 * `config`) intercepts whatever port the probe lands on: App() probes with no
 * args, so the base is `http://<page host>:8788` (WS default 8787 + 1) both in
 * fake mode and in real mode - the route ignores the port entirely.
 *
 * `installProxyConfigStub` must be called BEFORE the first `page.goto` so the
 * probe (fired on App mount) is intercepted.
 */

import type { Page } from '@playwright/test'
import { proxyPort } from '../dual'

/** The deployment config a spec may stub. Missing fields fall back to the all-off default. */
export interface FakeProxyConfig {
  authRequired?: boolean
  hideServerTarget?: boolean
  pinnedTarget?: string | null
  deploymentName?: string
  llmRelay?: boolean
}

/** All-off + stock branding: what an old/stock/unreachable proxy means. */
export const DEFAULT_FAKE_PROXY_CONFIG: Required<FakeProxyConfig> = {
  authRequired: false,
  hideServerTarget: false,
  pinnedTarget: null,
  deploymentName: 'XMage Nexus',
  llmRelay: false,
}

/** A fully gated LLMage deployment: token field + pinned target + relay on, 'LLMage' branding. */
export const LLMAGE_PROXY_CONFIG: Required<FakeProxyConfig> = {
  authRequired: true,
  hideServerTarget: true,
  pinnedTarget: 'localhost:17181',
  deploymentName: 'LLMage',
  llmRelay: true,
}

/**
 * Intercepts the /config route and answers the given deployment config
 * (ALL-DEFAULTS merged) as JSON with `cache-control: no-store`, matching what the
 * proxy serves. Works unchanged in fake and real mode (the glob is port-agnostic).
 */
export async function installProxyConfigStub(page: Page, config: FakeProxyConfig = {}): Promise<void> {
  const body = {
    authRequired: config.authRequired ?? DEFAULT_FAKE_PROXY_CONFIG.authRequired,
    hideServerTarget: config.hideServerTarget ?? DEFAULT_FAKE_PROXY_CONFIG.hideServerTarget,
    pinnedTarget: config.pinnedTarget ?? DEFAULT_FAKE_PROXY_CONFIG.pinnedTarget,
    deploymentName: config.deploymentName ?? DEFAULT_FAKE_PROXY_CONFIG.deploymentName,
    llmRelay: config.llmRelay ?? DEFAULT_FAKE_PROXY_CONFIG.llmRelay,
  }
  await page.route('**/config', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'cache-control': 'no-store' },
      body: JSON.stringify(body),
    }),
  )
}

/**
 * Navigate to the login screen for the active backend. The `?proxyPort=` value is
 * EXACTLY the one `e2e/support/start-game.ts login()` uses (fake: the dynamic
 * FixtureServer port; real: 8787), so the two stay consistent. `wsPort` overrides
 * it for a spec that points the page at a specific port.
 */
export async function gotoLogin(page: Page, opts: { wsPort?: number } = {}): Promise<void> {
  const port = opts.wsPort ?? proxyPort()
  await page.goto(`/?proxyPort=${port}`)
}
