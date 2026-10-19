import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'
import { FAKE_MODE } from './dual'
import { withFakeServer } from './support/fake-backend'
import { llmageScenario } from '../fixtures/scenarios/llmageGate'
import type { Scenario } from '../fixtures/fake'
import {
  installProxyConfigStub,
  gotoLogin,
  type FakeProxyConfig,
} from './support/proxy-config'
import { dismissSetupWizard } from './support/start-game'
import { getFakePort } from './support/fake-port'

/**
 * Gated-login E2E: the proxy's `GET /config` deployment gate and
 * the 4401 auth-rejection path.
 *
 * Fake mode drives the /config stub (the test helper) plus a FixtureServer WS
 * backend; real mode hits the proxy (8787/8788) which really serves
 * /config and really closes 4401 on a refused connect. The config-gate
 * assertions run in BOTH modes; the 404 degradation and the auth-off/on toggles
 * are fake-only (the real deployment is always gated).
 */

/** Navigate to the login screen; install the /config stub first in fake mode
 *  (pass `null` to test the real endpoint / a 404). The stub MUST precede the
 *  first goto: App() probes /config on mount. */
async function gotoScreen(page: Page, config: FakeProxyConfig | null): Promise<void> {
  if (config !== null && FAKE_MODE) await installProxyConfigStub(page, config)
  await gotoLogin(page)
  await dismissSetupWizard(page)
}

/** Fill the credentials the gated form actually exposes (the Server/Port fields
 *  are absent when hideServerTarget), then submit. Never waits for the lobby:
 *  the caller decides what the outcome should be. */
async function submitConnect(page: Page, username: string, token?: string): Promise<void> {
  await page.getByLabel(/Nombre de usuario|Usuario|Username/i).fill(username)
  const password = page.getByLabel(/Contraseña|Password/i)
  if (await password.isEnabled().catch(() => false)) await password.fill('x')
  if (token !== undefined) {
    const auth = page.getByTestId('login-auth-token')
    await expect(auth).toBeVisible({ timeout: 10_000 })
    await auth.fill(token)
  }
  await page.getByRole('button', { name: /Conectar|Connect/i }).click()
}

/** A FixtureServer scenario whose `connect` is refused with a typed
 *  connect_error — the fake backend cannot emit a raw 4401 close code
 *  (FakeConn.close() takes none), so this is the fake-mode stand-in. */
function refusedConnectScenario(): Scenario {
  return {
    onConnect(conn) {
      conn.raw({ type: 'connected', message: 'Proxy ready.' })
      conn.raw({ type: 'info', message: 'Proxy ready.' })
    },
    onStart(conn) {
      conn.lobby([])
    },
    onAction(conn, action, args, requestId) {
      if (action === 'connect') {
        conn.fail(requestId, action, 'Bad or missing auth token', 'AUTH_REJECTED')
        return
      }
      conn.ok(requestId, action, {})
      void args
    },
  }
}

function proxySockets(page: Page): string[] {
  const urls: string[] = []
  page.on('websocket', (ws) => urls.push(ws.url()))
  return urls
}

test.describe('gated login — fake backend + /config stub', () => {
  test.skip(!FAKE_MODE, 'fake-only: needs the /config stub and a FixtureServer script')

  test('stock /config (auth off): network box stays, no auth field', async ({ page }) => {
    await withFakeServer(() => llmageScenario(), async () => {
      await gotoScreen(page, { authRequired: false, hideServerTarget: false, deploymentName: 'Stock Deploy' })
      // the probe applied before we assert the defaults around it
      await expect(page).toHaveTitle('Stock Deploy')
      await expect(page.locator('details.login-network-box')).toBeVisible()
      await expect(page.getByTestId('login-auth-token')).toHaveCount(0)
      await expect(page.getByTestId('login-pinned-target')).toHaveCount(0)
    })
  })

  test('authRequired: the auth-token field renders (password, autocomplete off)', async ({ page }) => {
    await withFakeServer(() => llmageScenario(), async () => {
      await gotoScreen(page, { authRequired: true, deploymentName: 'Stock Deploy' })
      await expect(page).toHaveTitle('Stock Deploy')
      const auth = page.getByTestId('login-auth-token')
      await expect(auth).toBeVisible()
      await expect(auth).toHaveAttribute('type', 'password')
      await expect(auth).toHaveAttribute('autocomplete', 'off')
      // authRequired does not hide the target fields on its own
      await expect(page.locator('details.login-network-box')).toBeVisible()
    })
  })

  test('hideServerTarget: no network box, pinned target shown, deployment name sets the title', async ({ page }) => {
    await withFakeServer(() => llmageScenario(), async () => {
      await gotoScreen(page, {
        authRequired: true,
        hideServerTarget: true,
        pinnedTarget: '127.0.0.1:17181',
        deploymentName: 'LLMage',
      })
      await expect(page).toHaveTitle(/LLMage/)
      await expect(page.locator('details.login-network-box')).toHaveCount(0)
      const pinned = page.getByTestId('login-pinned-target')
      await expect(pinned).toBeVisible()
      await expect(pinned).toContainText('127.0.0.1:17181')
      await expect(page.getByTestId('login-auth-token')).toBeVisible()
    })
  })

  test('a 404 /config degrades to the stock form (ALL-DEFAULTS)', async ({ page }) => {
    await withFakeServer(() => llmageScenario(), async () => {
      await page.route('**/config', (route) =>
        route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' }),
      )
      await gotoLogin(page)
      await dismissSetupWizard(page)
      // ALL-DEFAULTS: stock branding, target fields shown, no token field
      await expect(page).toHaveTitle('XMage Nexus')
      await expect(page.locator('details.login-network-box')).toBeVisible()
      await expect(page.getByTestId('login-auth-token')).toHaveCount(0)
    })
  })

  test('a refused connect surfaces the reason and never reconnects', async ({ page }) => {
    const sockets = proxySockets(page)
    await withFakeServer(() => refusedConnectScenario(), async () => {
      const port = getFakePort()
      await gotoScreen(page, {})
      await submitConnect(page, `rej-${Date.now().toString().slice(-8)}`)
      // the server's reason reaches the login screen
      await expect(page.getByText(/Bad or missing auth token/)).toBeVisible({ timeout: 15_000 })
      // no auto-reconnect / auto-relogin: 6 s later we are still on the login
      // screen and only ONE socket to the proxy was ever opened
      await page.waitForTimeout(6000)
      await expect(page.getByRole('heading', { name: /XMage Nexus|Lobby/i })).toHaveCount(0)
      expect(sockets.filter((u) => u.includes(`:${port}`))).toHaveLength(1)
    })
  })
})

test.describe('gated login — real proxy on 8787', () => {
  test.skip(FAKE_MODE, 'real-only: needs the unit-1 proxy on 8787 and vite on 5173')

  test('/config renders the auth field, hides Server/Port, pins the target, brands the title', async ({ page }) => {
    await gotoScreen(page, null)
    await expect(page).toHaveTitle(/LLMage/)
    await expect(page.getByTestId('login-auth-token')).toBeVisible()
    await expect(page.locator('details.login-network-box')).toHaveCount(0)
    await expect(page.getByTestId('login-pinned-target')).toContainText('127.0.0.1:17181')
  })

  test('a wrong token gets the 4401 banner and no reconnect', async ({ page }) => {
    const sockets = proxySockets(page)
    await gotoScreen(page, null)
    await submitConnect(page, `rej-${Date.now().toString().slice(-8)}`, 'wrong-secret')
    const banner = page.getByTestId('login-proxy-reject')
    await expect(banner).toBeVisible({ timeout: 20_000 })
    await expect(banner).toContainText(/Auth token required/i)
    await page.waitForTimeout(6000)
    await expect(page.getByRole('heading', { name: /XMage Nexus|Lobby/i })).toHaveCount(0)
    expect(sockets.filter((u) => u.includes(':8787'))).toHaveLength(1)
  })

  test('the right token passes the gate and reaches the lobby', async ({ page }) => {
    // The proxy's pin is keyed on the connect args but the client dials the args'
    // target, so the documented real-mode URL params must point the app at the
    // pinned server (127.0.0.1:17181); ?server= + ?proxyPort= carry it in.
    await page.goto('/?proxyPort=8787&server=127.0.0.1:17181')
    await dismissSetupWizard(page)
    await submitConnect(page, `ok-${Date.now().toString().slice(-8)}`, 'e2e-secret')
    await expect(page.getByRole('heading', { name: /XMage Nexus/i })).toBeVisible({ timeout: 25_000 })
  })
})
