import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'
import { FAKE_MODE } from './dual'
import { withFakeServer } from './support/fake-backend'
import { llmageScenario } from '../fixtures/scenarios/llmageGate'
import { STOCK_FAKE_CAPABILITIES } from '../fixtures/fake'
import { gotoLogin } from './support/proxy-config'
import { dismissSetupWizard, installCapture, type CaptureBuffers } from './support/start-game'
import { parseSent, sentOf } from './support/frames'

/**
 * LLM-vs-LLM create-table preset E2E.
 *
 * The BACKEND already accepts `createTable {playerTypes:['COMPUTER_LLM',
 * 'COMPUTER_LLM']}` (proven live); the gap was the dialog, where the
 * `humanSeat` toggle forces seat 0 to HUMAN. The one-click "LLM vs LLM" chip
 * on the seats step sets `humanSeat=false` + both seats COMPUTER_LLM.
 *
 * Fake mode drives `llmageScenario` (caps `llm:true`) and captures the outgoing
 * `createTable` frame to prove the all-bot shape. `capabilities.llm === false`
 * must offer no chip at all (double gating).
 */

/** Login against the fake backend and open the Create-Table wizard on the
 *  seats step, where the seat-type radiogroups and the preset chip live. */
async function openSeatsStep(page: Page, username: string): Promise<void> {
  const buffers: CaptureBuffers = { frames: [], sent: [], pageErrors: [] }
  installCapture(page, buffers)
  if (!FAKE_MODE) {
    await page.goto('/?proxyPort=8787&server=127.0.0.1:17181')
  } else {
    await gotoLogin(page)
  }
  await dismissSetupWizard(page)
  await page.getByLabel(/Nombre de usuario|Usuario|Username/i).fill(username)
  const password = page.getByLabel(/Contraseña|Password/i)
  if (await password.isEnabled().catch(() => false)) await password.fill('x')
  const auth = page.getByTestId('login-auth-token')
  if ((await auth.count()) > 0) await auth.fill('e2e-secret')
  await page.getByRole('button', { name: /Conectar|Connect/i }).click()
  await expect(page.getByRole('heading', { name: /XMage Nexus|Lobby/i })).toBeVisible({ timeout: 25_000 })

  await page.getByRole('button', { name: /Nueva/i }).first().click()
  await expect(page.getByRole('heading', { name: /Nueva mesa|Crear Mesa/i })).toBeVisible()
  await page.locator('button.wizard-step', { hasText: /Multijugador/i }).click()
  // The seats stage is up once its seat nodes render (the creator's "you" node is
  // active by default; each spec picks the node it wants to edit).
  await expect(page.getByTestId('seat-node-1')).toBeVisible({ timeout: 10_000 })
}

/** Click Siguiente until the submit button shows, then create the table. */
async function submitWizard(page: Page): Promise<void> {
  for (let i = 0; i < 8; i++) {
    const submit = page.locator('.create-submit-btn')
    if ((await submit.count()) > 0 && (await submit.first().isVisible())) break
    await page.getByRole('button', { name: /Siguiente/ }).click()
  }
  await page.locator('.create-submit-btn').click()
}

/** The args of the last outgoing frame for `action`, if any. */
function sentArgs(page: Page, action: string): Record<string, unknown> | undefined {
  return parseSent(sentOf(page)).filter((f) => f.action === action).pop()?.args
}

test.describe('LLM vs LLM preset — fake backend', () => {
  test.skip(!FAKE_MODE, 'fake-only: drives the llmageScenario llm capability')

  test('the one-click chip creates an all-bot table and both seats join as COMPUTER_LLM', async ({ page }) => {
    const errors: Error[] = []
    page.on('pageerror', (e) => errors.push(e))
    await withFakeServer(() => llmageScenario(), async () => {
      await openSeatsStep(page, `llmvm-${Date.now().toString().slice(-8)}`)

      // The chip is discoverable on the seats step when capabilities.llm is on.
      const chip = page.getByTestId('llm-vs-llm-preset')
      await expect(chip).toBeVisible({ timeout: 10_000 })
      await chip.click()

      // It flips the creator to spectator mode and puts LLM in both seat slots.
      // One seat editor at a time: seat 0 first, then seat 1.
      await expect(page.getByTestId('seat-node-0')).toContainText(/IA LLM|LLM AI/)
      await page.getByTestId('seat-node-0').click()
      await expect(page.getByTestId('seat-type-0').getByRole('radio', { name: /LLM/ })).toBeChecked()
      await page.getByTestId('seat-node-1').click()
      await expect(page.getByTestId('seat-type-1').getByRole('radio', { name: /LLM/ })).toBeChecked()
      // seat 0 is no longer the human slot: the stage toggle offers spectator mode
      await expect(page.locator('.seats-stage-head').getByRole('button', { name: /Espectadores|Spectator/ })).toBeVisible()

      await submitWizard(page)

      await expect
        .poll(() => sentArgs(page, 'createTable'), { timeout: 10_000 })
        .toBeTruthy()
      const create = sentArgs(page, 'createTable')
      expect(create?.playerTypes).toEqual(['COMPUTER_LLM', 'COMPUTER_LLM'])
      // one llmConfig entry per LLM seat (shape per submitTable.ts llmConfigsForSeats)
      const configs = create?.llmConfigs as Array<Record<string, unknown>> | undefined
      expect(configs).toHaveLength(2)
      for (const c of configs ?? []) {
        expect(c.thinkingEnabled).toBe(true)
        expect(c).not.toHaveProperty('apiKey')
      }

      // both seats join as COMPUTER_LLM; no human seat is joined
      await expect
        .poll(() => parseSent(sentOf(page)).filter((f) => f.action === 'joinTable').length, { timeout: 10_000 })
        .toBe(2)
      const joins = parseSent(sentOf(page)).filter((f) => f.action === 'joinTable')
      expect(joins.map((f) => (f.args as { playerType?: string })?.playerType)).toEqual(['COMPUTER_LLM', 'COMPUTER_LLM'])
      expect(joins.map((f) => (f.args as { playerName?: string })?.playerName)).toEqual(['Computer 1', 'Computer 2'])

      expect(errors).toEqual([])
    })
  })

  test('capabilities.llm === false offers no LLM seat and no preset chip', async ({ page }) => {
    const errors: Error[] = []
    page.on('pageerror', (e) => errors.push(e))
    await withFakeServer(
      () =>
        llmageScenario({
          capabilities: STOCK_FAKE_CAPABILITIES,
          playerTypes: STOCK_FAKE_CAPABILITIES.playerTypes as string[],
        }),
      async () => {
        await openSeatsStep(page, `llmoff-${Date.now().toString().slice(-8)}`)
        await expect(page.getByTestId('llm-vs-llm-preset')).toHaveCount(0)
        await page.getByTestId('seat-node-1').click()
        const labels = await page.getByTestId('seat-type-0').getByRole('radio').allTextContents()
        expect(labels.some((label) => /LLM/.test(label))).toBe(false)
        expect(errors).toEqual([])
      },
    )
  })
})
