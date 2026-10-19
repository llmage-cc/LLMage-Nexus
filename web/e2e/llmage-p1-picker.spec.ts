import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'
import { cleanupUser } from './cleanup'
import { FAKE_MODE } from './dual'
import { withFakeServer } from './support/fake-backend'
import { llmageScenario } from '../fixtures/scenarios/llmageGate'
import { STOCK_FAKE_CAPABILITIES } from '../fixtures/fake'
import { gotoLogin } from './support/proxy-config'
import { dismissSetupWizard, pickFormatOption } from './support/start-game'

/**
 * COMPUTER_P1 training-deck picker E2E.
 *
 * Fake mode drives the `llmageScenario` fixture (caps `p1:true`, 4 fixed training
 * decks, default `Izzet Spellementals`) and captures the outgoing `joinTable`
 * to prove the seat carries the deck TEXT (not its name). Real mode lists the
 * real proxy's 55-deck pool. `capabilities.p1 === false` must offer no P1 seat
 * at all.
 */

const DEFAULT_DECKS = ['Izzet Spellementals', 'Mono Red Aggro', 'Azorius Control', 'Golgari Midrange']

/** Login against the active backend and open the Create-Table wizard on the
 *  `Multijugador` (seats) step, where the seat-type radiogroups live.
 *  `deckType` (optional) is picked on the General step first: upstream now opens
 *  a match as `Limited`, where bot seats carry no per-seat deck, so a spec that
 *  inspects the wire must ask for a constructed table explicitly. */
async function openSeatsStep(page: Page, username: string, deckType?: string): Promise<void> {
  if (!FAKE_MODE) {
    // the gated real deployment pins the server; the proxy dials the args target,
    // so the documented URL params must point the app at 127.0.0.1:17181.
    await page.goto('/?proxyPort=8787&server=127.0.0.1:17181')
  } else {
    await gotoLogin(page)
  }
  await dismissSetupWizard(page)
  await page.getByLabel(/Nombre de usuario|Usuario|Username/i).fill(username)
  const password = page.getByLabel(/Contraseña|Password/i)
  if (await password.isEnabled().catch(() => false)) await password.fill('x')
  // a gated deployment (real) exposes the auth-token field and rejects a connect
  // without it, so present the test token when the field is there (fake has none).
  const auth = page.getByTestId('login-auth-token')
  if ((await auth.count()) > 0) await auth.fill('e2e-secret')
  await page.getByRole('button', { name: /Conectar|Connect/i }).click()
  await expect(page.getByRole('heading', { name: /XMage Nexus|Lobby/i })).toBeVisible({ timeout: 25_000 })

  await page.getByRole('button', { name: /Nueva/i }).first().click()
  await expect(page.getByRole('heading', { name: /Nueva mesa|Crear Mesa/i })).toBeVisible()
  if (deckType) await pickFormatOption(page, 'format-deck-type', deckType)
  await page.locator('button.wizard-step', { hasText: /Multijugador/i }).click()
  // The stage opens on the creator's own ("you") seat; the first editable seat is
  // node 1, and its editor is the one that carries `seat-type-0`.
  await page.getByTestId('seat-node-1').click()
  await expect(page.getByTestId('seat-type-0')).toBeVisible({ timeout: 10_000 })
}

async function pickerOptionValues(page: Page): Promise<string[]> {
  return page.getByTestId('p1-deck-picker').locator('option').evaluateAll((els: HTMLOptionElement[]) =>
    els.map((o) => o.value),
  )
}

/**
 * Pick a seat type in seat `idx`'s editor. Upstream replaced the per-seat
 * `<select data-testid="seat-type-N">` with a radiogroup of chips carrying the
 * same testid, so the type is chosen by its visible label.
 */
async function pickSeatType(page: Page, idx: number, name: RegExp): Promise<void> {
  await page.getByTestId(`seat-type-${idx}`).getByRole('radio', { name }).click()
}

/** The visible type labels offered for seat `idx` (the chip radiogroup). */
async function seatTypeLabels(page: Page, idx: number): Promise<string[]> {
  return page.getByTestId(`seat-type-${idx}`).getByRole('radio').allTextContents()
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

test.describe('COMPUTER_P1 picker — fake backend', () => {
  test.skip(!FAKE_MODE, 'fake-only: needs the llmageScenario P1 pool')

  test('lists the served decks, defaults to the proxy default, and sticks the selection', async ({ page }) => {
    const errors: Error[] = []
    page.on('pageerror', (e) => errors.push(e))
    await withFakeServer(() => llmageScenario(), async () => {
      await openSeatsStep(page, `p1-${Date.now().toString().slice(-8)}`)
      await pickSeatType(page, 0, /P1/)

      const picker = page.getByTestId('p1-deck-picker')
      await expect(picker).toBeVisible({ timeout: 10_000 })
      await expect(picker.locator('option')).toHaveCount(DEFAULT_DECKS.length)
      expect(await pickerOptionValues(page)).toEqual(DEFAULT_DECKS)
      // defaulted to the proxy's deterministic default, labelled "(default)" in es
      expect(await picker.inputValue()).toBe('Izzet Spellementals')
      await expect(picker.locator('option').first()).toContainText(/predeterminado|default/i)

      // changing the selection is a controlled value that sticks
      await picker.selectOption('Mono Red Aggro')
      expect(await picker.inputValue()).toBe('Mono Red Aggro')
      expect(errors).toEqual([])
    })
  })

  test('capabilities.p1 === false offers no P1 seat at all', async ({ page }) => {
    const errors: Error[] = []
    page.on('pageerror', (e) => errors.push(e))
    await withFakeServer(
      () =>
        llmageScenario({
          capabilities: STOCK_FAKE_CAPABILITIES,
          playerTypes: STOCK_FAKE_CAPABILITIES.playerTypes as string[],
        }),
      async () => {
        await openSeatsStep(page, `p1off-${Date.now().toString().slice(-8)}`)
        const labels = await seatTypeLabels(page, 0)
        expect(labels.some((label) => /P1/.test(label))).toBe(false)
        await expect(page.getByTestId('p1-deck-picker')).toHaveCount(0)
        expect(errors).toEqual([])
      },
    )
  })
})

test.describe('COMPUTER_P1 picker — fake backend, seat wiring', () => {
  test.skip(!FAKE_MODE, 'fake-only: captures the outgoing joinTable')

  test('the P1 seat carries the selected deck TEXT (not its name) into joinTable', async ({ page }) => {
    const errors: Error[] = []
    page.on('pageerror', (e) => errors.push(e))
    const sent: Array<{ action?: string; args?: Record<string, unknown> }> = []
    page.on('websocket', (ws) => {
      ws.on('framesent', (e) => {
        try {
          sent.push(JSON.parse(String(e.payload)))
        } catch {
          /* ignore non-JSON */
        }
      })
    })
    await withFakeServer(() => llmageScenario(), async () => {
      const username = `p1seat-${Date.now().toString().slice(-8)}`
      cleanupUser(username)
      await openSeatsStep(page, username, 'Constructed - Modern')
      await pickSeatType(page, 0, /P1/)

      const picker = page.getByTestId('p1-deck-picker')
      await expect(picker).toBeVisible({ timeout: 10_000 })
      await picker.selectOption('Mono Red Aggro')

      // the name field lives on the General step and already defaults to
      // "<username>'s table" (non-empty), so the wizard can submit as is
      await submitWizard(page)
      await expect(page.getByTestId('staging-player-actions')).toBeVisible({ timeout: 15_000 })

      const create = sent.find((f) => f.action === 'createTable')
      expect(create?.args?.playerTypes).toContain('COMPUTER_P1')
      const botJoin = sent.find(
        (f) => f.action === 'joinTable' && (f.args as { playerType?: string })?.playerType === 'COMPUTER_P1',
      )
      expect(botJoin).toBeDefined()
      // the deck is the training list's TEXT (a Deck object), never the bare name
      const deck = (botJoin?.args as { deck?: { name?: string; cards?: Array<{ cardName?: string }> } })?.deck
      expect(deck?.cards?.some((c) => c.cardName === 'Monastery Swiftspear')).toBe(true)
      expect(JSON.stringify(deck)).not.toContain(DEFAULT_DECKS[0])
      expect(errors).toEqual([])
    })
  })
})

test.describe('COMPUTER_P1 picker — refused pool (fake backend)', () => {
  test.skip(!FAKE_MODE, 'fake-only: needs a getP1Decks that answers a typed error')

  test('a REFUSED getP1Decks surfaces an error + retry, never an eternal loading', async ({ page }) => {
    const errors: Error[] = []
    page.on('pageerror', (e) => errors.push(e))
    let failing = true
    await withFakeServer(
      () =>
        llmageScenario({
          // First call answers the typed CAPABILITY_UNAVAILABLE the proxy returns
          // when the running artifacts lack P1DeckPool; the retry falls through to
          // the normal pool.
          onVerb: (conn, action, _args, requestId) => {
            if (action !== 'getP1Decks') return false
            if (!failing) return false
            conn.fail(requestId, action, 'P1 deck pool unavailable', 'CAPABILITY_UNAVAILABLE')
            return true
          },
        }),
      async () => {
        await openSeatsStep(page, `p1err-${Date.now().toString().slice(-8)}`)
        await pickSeatType(page, 0, /P1/)

        await expect(page.getByTestId('p1-deck-picker-error')).toBeVisible({ timeout: 10_000 })
        // the refused pool is NOT disguised as the loading hint
        await expect(page.getByTestId('p1-deck-picker-empty')).toHaveCount(0)

        failing = false
        await page.getByTestId('p1-deck-picker-retry').click()
        await expect(page.getByTestId('p1-deck-picker')).toBeVisible({ timeout: 10_000 })
        await expect(page.locator('[data-testid=p1-deck-picker] option')).toHaveCount(DEFAULT_DECKS.length)
        expect(errors).toEqual([])
      },
    )
  })
})

test.describe('COMPUTER_P1 picker — real proxy on 8787', () => {
  test.skip(FAKE_MODE, 'real-only: needs the unit-1 proxy serving the 55-deck pool')

  test('getP1Decks serves the 55 training decks with the real default', async ({ page }) => {
    await openSeatsStep(page, `p1real-${Date.now().toString().slice(-8)}`)
    await pickSeatType(page, 0, /P1/)
    const picker = page.getByTestId('p1-deck-picker')
    await expect(picker).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[data-testid=p1-deck-picker] option')).toHaveCount(55)
    expect(await picker.inputValue()).toBe('Izzet Spellementals')
    await expect(page.getByTestId('p1-deck-picker-empty')).toHaveCount(0)
  })
})
