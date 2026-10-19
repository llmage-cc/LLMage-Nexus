/**
 * Proving spec for the LLMage fixture layer: drives the deployment
 * `/config` gate and every new post-port WS verb the FixtureServer answers, in
 * fake mode, against a locally started `FakeServer` running `llmageScenario()`.
 *
 * Covers, in one pass:
 *   - the `/config` stub renders the token field + pinned target and hides the
 *     network box (deployment gating);
 *   - `getP1Decks` fills the COMPUTER_P1 training-deck picker with the fixed pool
 *     and selects the deterministic default;
 *   - `getReplayFiles` (merged with an empty `getFinishedMatches`) lists the saved
 *     rows, one carrying the legacy chip;
 *   - `fetchModels` / `fetchPersonalities` fill the LLM seat list pickers;
 *   - `llm_decision` / `llm_error` are acknowledged (the client only checks ok).
 *
 * Hermetic: starts its OWN FixtureServer on a free port and stops it in the
 * finally; no cleanup helper (the fake backend needs no server-side cleanup).
 */

import { test, expect } from '@playwright/test'
import { FakeServer } from '../fixtures/fake'
import {
  DEFAULT_LLM_MODELS,
  DEFAULT_LLM_PERSONALITIES,
  DEFAULT_P1_DECKS,
  DEFAULT_P1_DEFAULT,
  llmageScenario,
  type LlmageScenarioOptions,
} from '../fixtures/scenarios/llmageGate'
import { getFakePort, setFakePort } from './support/fake-port'
import { gotoLogin, installProxyConfigStub, LLMAGE_PROXY_CONFIG } from './support/proxy-config'
import { dismissSetupWizard } from './support/start-game'

/**
 * Call one verb over a fresh browser WebSocket and resolve its `result` frame.
 * Uses the page's own WebSocket so the wire path matches what the app uses.
 */
async function rawCall(
  page: import('@playwright/test').Page,
  port: number,
  action: string,
  args: Record<string, unknown>,
): Promise<{ ok?: boolean; data?: unknown }> {
  return page.evaluate(
    ({ port: wsPort, action: act, args: a }) =>
      new Promise<{ ok?: boolean; data?: unknown }>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`)
        const requestId = `raw-${act}`
        const timer = setTimeout(() => {
          ws.close()
          reject(new Error(`timeout waiting for ${act}`))
        }, 5000)
        ws.onopen = () => ws.send(JSON.stringify({ action: act, requestId, args: a }))
        ws.onmessage = (e) => {
          const frame = JSON.parse(String(e.data)) as { type?: string; action?: string; requestId?: string; ok?: boolean; data?: unknown }
          if (frame.type === 'result' && frame.action === act && String(frame.requestId) === requestId) {
            clearTimeout(timer)
            ws.close()
            resolve(frame)
          }
        }
        ws.onerror = () => {
          clearTimeout(timer)
          reject(new Error(`ws error on ${act}`))
        }
      }),
    { port, action, args },
  )
}

test('llmage fixture: /config gate + every new WS verb answered', async ({ page }) => {
  const seenVerbs = new Set<string>()
  const pageErrors: Error[] = []
  page.on('pageerror', (err) => pageErrors.push(err))

  const opts: LlmageScenarioOptions = {
    onVerb: (_conn, action) => {
      seenVerbs.add(action)
      return false
    },
  }
  const server = await FakeServer.start(0, () => llmageScenario(opts))
  const previousPort = getFakePort()
  setFakePort(server.port)

  try {
    // The /config stub MUST be installed before the first goto (App probes on mount).
    await installProxyConfigStub(page, LLMAGE_PROXY_CONFIG)
    await gotoLogin(page)
    await dismissSetupWizard(page)

    // ── Deployment gate ──────────────────────────────────────────────────────
    await expect(page.getByTestId('login-auth-token')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('login-pinned-target')).toBeVisible()
    await expect(page.locator('details.login-network-box')).toHaveCount(0)
    await expect(page.getByTestId('login-pinned-target')).toContainText(LLMAGE_PROXY_CONFIG.pinnedTarget)
    await expect(page).toHaveTitle(LLMAGE_PROXY_CONFIG.deploymentName)

    // ── Connect (the network box is hidden; fill the plain fields only) ──────
    await page.getByLabel(/Nombre de usuario|Usuario|Username/i).fill('llmage-e2e')
    const password = page.getByLabel(/Contraseña|Password/i)
    if (await password.isEnabled().catch(() => false)) await password.fill('x')
    await page.getByTestId('login-auth-token').fill('test-token')
    await page.getByRole('button', { name: /Conectar|Connect/i }).click()
    await expect(page.getByRole('heading', { name: /Lobby|XMage Nexus/i })).toBeVisible({ timeout: 20_000 })

    // ── Create Table → COMPUTER_P1 seat → training-deck picker ──────────────
    await page.getByRole('button', { name: /Nueva/i }).first().click()
    await expect(page.getByRole('heading', { name: /Nueva mesa|Crear Mesa/i })).toBeVisible()
    await page.locator('button.wizard-step', { hasText: /Multijugador/i }).click()
    // The seat editor shows one seat at a time: the stage opens on the creator's
    // own ("you") seat, so select the first configurable seat before editing it.
    await page.getByTestId('seat-node-1').click()
    // The seat editor's type control is a radiogroup (upstream replaced the select).
    const seatType0 = page.getByTestId('seat-type-0')
    await expect(seatType0).toBeVisible()
    await seatType0.getByRole('radio', { name: /P1/ }).click()

    const picker = page.getByTestId('p1-deck-picker')
    await expect(picker).toBeVisible({ timeout: 15_000 })
    const pickerInfo = await picker.evaluate((el) => {
      const sel = el as HTMLSelectElement
      return { value: sel.value, options: [...sel.options].map((o) => ({ value: o.value, label: o.textContent ?? '' })) }
    })
    expect(pickerInfo.options.map((o) => o.value)).toEqual(DEFAULT_P1_DECKS.map((d) => d.name))
    expect(pickerInfo.value).toBe(DEFAULT_P1_DEFAULT)
    expect(pickerInfo.options.find((o) => o.value === DEFAULT_P1_DEFAULT)?.label).toContain(DEFAULT_P1_DEFAULT)

    // ── LLM seat → fetchModels / fetchPersonalities ──────────────────────────
    await seatType0.getByRole('radio', { name: /LLM/ }).click()
    await expect(page.getByTestId('llm-config-panel-0')).toBeVisible()
    await page.getByTestId('llm-model-fetch').click()
    await expect(page.locator('[data-testid=llm-model-select] option', { hasText: DEFAULT_LLM_MODELS[0] })).toHaveCount(1, { timeout: 10_000 })
    await page.getByTestId('llm-tab-personality').click()
    await page.getByTestId('llm-personality-fetch').click()
    await expect(page.locator('[data-testid=llm-personality-select] option', { hasText: DEFAULT_LLM_PERSONALITIES[0] })).toHaveCount(1, { timeout: 10_000 })

    // ── Close the wizard, History → saved replays browser (getReplayFiles) ──
    await page.getByRole('button', { name: /^Cancelar$/ }).first().click()
    await expect(page.getByRole('heading', { name: /Nueva mesa|Crear Mesa/i })).toBeHidden()
    await page.getByRole('button', { name: /^Historial$/ }).first().click()
    await page.getByRole('tab', { name: /Repeticiones guardadas/ }).click()
    const panel = page.locator('.replay-files-panel')
    await expect(panel).toBeVisible({ timeout: 10_000 })
    await expect(panel.locator('.replay-files-row.replay-files-item')).toHaveCount(3)
    await expect(panel.locator('.replay-files-item', { hasText: 'heredada' })).toHaveCount(1)

    // ── llm_decision / llm_error acks (transport verbs the client only checks ok) ──
    const decision = await rawCall(page, server.port, 'llm_decision', { requestId: 'x', rawResponse: 'ok' })
    const error = await rawCall(page, server.port, 'llm_error', { requestId: 'y', message: 'nope', retryable: false })
    expect(decision.ok).toBe(true)
    expect(error.ok).toBe(true)

    // ── Every new verb was answered by the fixture ───────────────────────────
    for (const verb of ['getP1Decks', 'getReplayFiles', 'fetchModels', 'fetchPersonalities', 'llm_decision', 'llm_error']) {
      expect.soft(seenVerbs.has(verb), `fixture never answered ${verb}`).toBe(true)
    }

    // ── No page errors ───────────────────────────────────────────────────────
    expect(pageErrors).toEqual([])
  } finally {
    try {
      await server.stop()
    } finally {
      setFakePort(previousPort)
    }
  }
})
