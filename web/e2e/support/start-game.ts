/**
 * Modular match setup for the E2E specs. `startGame` wraps the whole flow every
 * spec repeats: frame/pageerror capture, login (with a retry for the proxy's
 * session switch), human table vs deterministic Sim, start, and the WS helper.
 * Each test creates ITS OWN match (full independence).
 */

import { expect, type Locator, type Page } from '@playwright/test'
import { cleanupUser, registerHelper } from '../cleanup'
import { HumanHelper } from '../wshelper'
import { parsedLen } from './frames'
import { FAKE_MODE } from '../dual'
import { getFakePort } from './fake-port'

export const MAX_FRAMES = 500

export interface CaptureBuffers {
  frames: Array<Record<string, unknown> | null>
  sent: Array<Record<string, unknown> | null>
  pageErrors: Error[]
}

export function installCapture(page: Page, buffers: CaptureBuffers, maxFrames = MAX_FRAMES): void {
  ;(page as unknown as { __frames: Array<Record<string, unknown> | null> }).__frames = buffers.frames
  ;(page as unknown as { __sent: Array<Record<string, unknown> | null> }).__sent = buffers.sent
  page.on('pageerror', (err) => buffers.pageErrors.push(err))
  page.on('websocket', (ws) => {
    // with auto-pass the turns fly by and frames pile up without bound
    // (OOM: ~4GB in a minute); only the last MAX_FRAMES are kept, already
    // parsed (re-parsing on every poll exhausted the heap too)
    ws.on('framereceived', (e) => {
      try {
        const f = JSON.parse(String(e.payload)) as Record<string, unknown>
        f.__t = Date.now()
        buffers.frames.push(f)
      } catch {
        buffers.frames.push(null)
      }
      if (buffers.frames.length > maxFrames) buffers.frames.splice(0, buffers.frames.length - maxFrames)
    })
    ws.on('framesent', (e) => {
      try {
        const f = JSON.parse(String(e.payload)) as Record<string, unknown>
        f.__t = Date.now()
        buffers.sent.push(f)
      } catch {
        buffers.sent.push(null)
      }
      if (buffers.sent.length > maxFrames) buffers.sent.splice(0, buffers.sent.length - maxFrames)
    })
  })
}

export interface LoginOptions {
  /** Retry "Connect" if the lobby does not appear (the proxy's session switch). */
  retryLobby?: boolean
  /** CSS selector of the screen the session lands on instead of the lobby
   *  (e.g. a scenario that starts a draft right after connect: the lobby heading
   *  can be replaced before it ever becomes visible on a slow runner). */
  landsOn?: string
}

export async function dismissSetupWizard(page: Page): Promise<void> {
  const wizard = page.getByTestId('setup-wizard')
  // The wizard opens itself in fresh contexts: wait for React to mount
  // (if it already ran there is no wizard and this is a no-op).
  await wizard.waitFor({ state: 'attached', timeout: 15_000 }).catch(() => {})
  if (await wizard.isVisible().catch(() => false)) {
    await page.getByTestId('setup-skip').click()
    await expect(wizard).toBeHidden({ timeout: 5_000 })
  }
}

export async function login(page: Page, username: string, opts: LoginOptions = {}): Promise<void> {
  await page.goto(`/?proxyPort=${FAKE_MODE ? getFakePort() : 8787}`)
  await dismissSetupWizard(page)
  if (await page.locator('details.login-network-box:not([open])').count() > 0) {
    await page.locator('summary.login-network-header').click()
  }
  await page.getByLabel(/^Proxy WS:/).fill('localhost')
  // in fake mode the FixtureServer ignores the target, but pinning localhost
  // stops a routing regression from launching the tests against the real
  // (beta) XMage
  await page.getByLabel(/^(Servidor XMage|XMage Server):/).fill(process.env.E2E_SERVER_HOST || (FAKE_MODE ? 'localhost' : 'beta.xmage.today'))
  await page.getByLabel(/^(Puerto|Port):/).fill(process.env.E2E_SERVER_PORT || '17171')
  await page.getByLabel(/Nombre de usuario|Usuario|Username/i).fill(username)
  // Against beta the field is disabled (the public server uses no password);
  // filling it blindly burns the test timeout.
  const password = page.getByLabel(/Contraseña|Password/i)
  if (await password.isEnabled().catch(() => false)) await password.fill('x')
  const lobby = opts.landsOn
    ? page.getByRole('heading', { name: /Lobby|XMage Nexus/i }).or(page.locator(opts.landsOn)).first()
    : page.getByRole('heading', { name: /Lobby|XMage Nexus/i })
  const connect = page.getByRole('button', { name: /Conectar|Connect/i })
  await connect.click()
  if (opts.retryLobby) {
    // the proxy's session switch after a previous user can be slow or fail
    // transiently; connect is idempotent, so retrying is safe
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await expect(lobby).toBeVisible({ timeout: 15_000 })
        return
      } catch {
        await connect.click()
      }
    }
  }
  await expect(lobby).toBeVisible({ timeout: 20_000 })
}

export interface CreateTableOptions {
  tableName?: string
  /** Human deck ('Mage Web advanced', 'Mage Web lands', ...). */
  deck?: string
  /** Bot seat deck. In real mode it fills the seat with the server's native
   *  Mad AI; in fake mode the FixtureServer ignores it (the opponent is
   *  scripted by the scenario). */
  simDeck?: string
  /** Format (Deck Type), e.g. 'Constructed - Pioneer'. Defaults to the dialog's. */
  deckType?: string
  skipShuffle?: boolean
  skipStartingPlayer?: boolean
  /** Fill the bot seat: in real mode the server's native Mad AI (the proxy's
   *  SIM bot is dev-only and can no longer be picked from the client). */
  sim?: boolean
  /** Match best-of-N: wins needed (1 = a single game). */
  winsNeeded?: number
}

/** Pick a deck by name in the wizard selects: the option values now carry the
 *  stable reference (id) and the name in the label. */
async function selectDeckOption(select: Locator, deckName: string): Promise<void> {
  const value = await select.evaluate((el, name) => {
    const options = [...(el as HTMLSelectElement).options]
    const withCount = options.find((o) => (o.textContent ?? '').startsWith(`${name} (`))
    const exact = options.find((o) => (o.textContent ?? '').trim() === name)
    return withCount?.value ?? exact?.value ?? ''
  }, deckName)
  if (!value) throw new Error(`Cannot find the deck option "${deckName}" in the wizard`)
  await select.selectOption(value)
}

export async function createTable(page: Page, tableName: string, opts: CreateTableOptions = {}): Promise<void> {
  await page.getByRole('button', { name: /Nueva/i }).first().click()
  await expect(page.getByRole('heading', { name: /Nueva mesa|Crear Mesa/i })).toBeVisible()
  await page.getByLabel(/Nombre/i).fill(tableName)

  if (opts.winsNeeded && opts.winsNeeded > 1) {
    if (opts.winsNeeded === 2) {
      await page.getByRole('button', { name: /^Bo3/i }).click()
    } else if (opts.winsNeeded === 3) {
      await page.getByRole('button', { name: /^Bo5/i }).click()
    }
  }

    if (opts.deckType) {
      await page.getByLabel(/Formato/i).selectOption({ value: opts.deckType })
    }
    if (opts.deck || opts.simDeck || !FAKE_MODE) {
      // wizard step (2026-09 redesign): "🤖 Multiplayer" (scoped to the
      // wizard-step: the "Commander / Multiplayer" mode card matches too)
      await page.locator('button.wizard-step', { hasText: /Multijugador/i }).click()
      if (opts.deck) {
        await selectDeckOption(page.getByLabel(/Mazo activo/i), opts.deck)
      }
      if (!FAKE_MODE) {
        // The proxy's SIM bot is dev-only and the client no longer offers it:
        // real-backend specs opt for the server's native Mad AI (the same
        // source self-test/human-test use over a direct WS).
        const seatType = page.getByTestId('seat-type-0')
        if (await seatType.isVisible().catch(() => false)) {
          await seatType.selectOption({ value: 'COMPUTER_MAD' })
          if (opts.simDeck) {
            await selectDeckOption(page.getByLabel(/Mazo plaza 2|Seat 2 deck/i), opts.simDeck)
          }
        }
      }
    }

  if ((opts.skipShuffle ?? true) || (opts.skipStartingPlayer ?? true)) {
    // wizard step: "🛠️ Dev" (formerly "Settings / Dev")
    await page.getByRole('button', { name: /Dev/i }).click()
    if (opts.skipShuffle ?? true) {
      const shuffle = page.getByRole('checkbox', { name: /No barajar el mazo inicial/i })
      if (!(await shuffle.isChecked())) await shuffle.check()
    }
    if (opts.skipStartingPlayer ?? true) {
      const starting = page.getByRole('checkbox', { name: /Sin sorteo de jugador inicial/i })
      if (!(await starting.isChecked())) await starting.check()
    }
  }

  // dialog-specific submit selector: the lobby empty state also has a
  // "Create Table" button when the server has no tables
  const submit = page.locator('.create-submit-btn')
  await submit.click()
}

/** If the automatic jump to the waiting room (JOINED_TABLE) is on, go back to the lobby. */
export async function dismissStaging(page: Page): Promise<void> {
  const back = page.getByTestId('staging-back')
  if (await back.isVisible().catch(() => false)) {
    await back.click()
    await expect(back).toBeHidden({ timeout: 5_000 }).catch(() => {})
  }
}

/** Is the staging start button visible AND enabled? (NOTE: `isEnabled()`
 *  waits until the default timeout; the timeout is bounded here so it can be
 *  used as a probe inside polls.) */
export async function stagingStartReady(page: Page, timeoutMs = 1_000): Promise<boolean> {
  try {
    await expect(page.getByTestId('staging-start')).toBeEnabled({ timeout: timeoutMs })
    return true
  } catch {
    return false
  }
}

/** Wait until the user's table is ready (SIM seat joined, Start button).
 *  The real server's JOINED_TABLE can arrive late: each pass considers both
 *  paths (waiting room ready or lobby row at 2/2) instead of fixing
 *  one at 500 ms -- with the app in staging the lobby listing goes stale. */
export async function waitTableReady(page: Page, tableName: string): Promise<void> {
  const row = page.locator('.table-row', { hasText: tableName }).first()
  await expect(async () => {
    if (await stagingStartReady(page)) return
    await dismissStaging(page)
    await expect(row).toBeVisible({ timeout: 1_000 })
    await expect(row.locator('.table-seats')).toHaveText(/2\/2/, { timeout: 1_000 })
  }).toPass({ timeout: 30_000 })
}

/** Start the match (Start button) and wait for the game screen. */
export async function startMatch(page: Page, tableName: string): Promise<void> {
  // The lobby can jump to staging on join: start from there.
  const stagingStart = page.getByTestId('staging-start')
  const row = page.locator('.table-row', { hasText: tableName }).first()
  const startButton = row.getByRole('button', { name: /Empezar|Iniciar Partida|Start/i })
  await expect(async () => {
    if (await stagingStartReady(page)) return
    await dismissStaging(page)
    await expect(startButton).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 20_000 })
  if (await stagingStart.isVisible().catch(() => false)) {
    await stagingStart.click()
  } else {
    // Forced: the lobby's live list re-renders continuously and the button never
    // settles for a normal click (hangs until the test timeout).
    await startButton.click({ force: true })
  }
  await expect(page.getByTestId('game-status')).toBeVisible({ timeout: 20_000 })
}

export interface GameSession {
  page: Page
  frames: Array<Record<string, unknown> | null>
  sent: Array<Record<string, unknown> | null>
  pageErrors: Error[]
  username: string
  helper: HumanHelper
  /** Index of the last processed frame (cursor for waitFrame). */
  cursor(): number
}

export interface StartGameOptions extends CreateTableOptions {
  /** Unique user prefix (sp/tg/cb/e2e...). */
  prefix?: string
  maxFrames?: number
  /** The helper does not touch combat windows (the human exercises them via the UI). */
  skipCombat?: boolean
  skipAsks?: boolean
  /** Disable mulligan auto-keep to exercise the mulligan window in E2E. */
  autoKeepMulligan?: boolean
}

/** Set up the match (login → table → Sim → start), start the HumanHelper
 *  (land development, discards and asks over WS) and return the session. */
export async function startGame(page: Page, opts: StartGameOptions = {}): Promise<GameSession> {
  const prefix = opts.prefix ?? 'e2e'
  // The server caps the username at 14 chars and login truncates it (maxLength):
  // the helper must use EXACTLY the same name to share the session.
  const username = `${prefix}-${String(Date.now()).slice(-8)}`.slice(0, 14)
  cleanupUser(username)
  const buffers: CaptureBuffers = { frames: [], sent: [], pageErrors: [] }
  installCapture(page, buffers, opts.maxFrames)
  await login(page, username, { retryLobby: true })
  if (opts.autoKeepMulligan !== false) {
    await page.evaluate(() => {
      const store = (globalThis as unknown as { __mageStore?: { setSetting?: (k: string, v: unknown) => void } }).__mageStore
      store?.setSetting?.('autoKeepMulligan', true)
      store?.setSetting?.('autoSubmitSideboard', true)
    })
  } else {
    await page.evaluate(() => {
      const store = (globalThis as unknown as { __mageStore?: { setSetting?: (k: string, v: unknown) => void } }).__mageStore
      store?.setSetting?.('autoKeepMulligan', false)
      store?.setSetting?.('autoSubmitSideboard', true)
    })
  }
  const tableName = opts.tableName ?? `${username}-t`
  await createTable(page, tableName, opts)
  await waitTableReady(page, tableName)
  // the helper connects BEFORE the match starts so it captures
  // START_GAME/GAME_INIT from the first event (waitGameId waits for it)
  const helper = new HumanHelper(username, 'x', { skipCombat: opts.skipCombat, skipAsks: opts.skipAsks })
  registerHelper(helper)
  // the helper inherits the page's browserId: the proxy's anon-name guard
  // (production security) rejects a second connect for the same user
  // without the SAME browser identity (typed connect_error + 4401).
  await helper.start(page)
  await startMatch(page, tableName)
  await helper.waitGameId(20_000)
  return { page, ...buffers, username, helper, cursor: () => parsedLen(page) }
}