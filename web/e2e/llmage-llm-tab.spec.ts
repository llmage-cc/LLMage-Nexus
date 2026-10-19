/**
 * E2E — live LLM drawer tab and the browser-side `/llm-relay` routing of the
 * client-key bridge.
 *
 * Fake mode (default): a locally started FixtureServer runs `llmageScenario`,
 * whose `connect` result carries `capabilities.llm:true`. Every frame these
 * specs inject rides the REAL fake-WS ingress (`FakeConn.raw` → WS → Gateway
 * JSON parse → seq dedup → frameBuffer → handleMessage → eventHandler): the
 * scenario's own `GAME_INIT` plants the drawer's LLM view (Part A) and the
 * `llm_prompt` frames are queued on the scenario's `onVerb`/`onTableCreated`
 * hooks and flushed with `conn.raw` (Part B/C). Nothing is pushed through the
 * store's DEV-only `window.__mageStore.handleMessage` hook in fake mode.
 *
 * Part A — the drawer gate + panel:
 *   - with no `capabilities.llm` (stock capabilities) the `drawer-tab-llm` is ABSENT;
 *   - with the gate open and a game frame whose `llmDebug` carries an LLM seat, the
 *     tab renders; clicking it shows `[data-testid=llm-tab]`, the player block, its
 *     messages and the streaming lines.
 *
 * Part B — the bridge routing. The fake FixtureServer CAN emit
 * arbitrary top-level frames: `fixtures/scenarios/llmageGate.ts` exposes
 * `opts.onVerb(conn, action, args, requestId)` — invoked for every verb the
 * base scenario does not answer in its own switch — and `FakeConn.raw` places
 * any JSON frame on the app's socket (the same raw-frame path
 * llmage-login-gate.spec.ts relies on). `llmPromptOverWs` queues frames for the
 * hook, and the History panel's `getFinishedMatches` verb (fired by the
 * `Historial` click inside `dispatchLlmPrompt`) is the deterministic trigger that
 * makes the hook `conn.raw` them. The API key is seeded through the real UI
 * (Create Table → a COMPUTER_LLM seat → its apiKey field), and the opaque
 * `clientKeyTag` is read back off the outgoing `createTable` frame — the key
 * store is module-scope and NOT reachable from `page.evaluate`.
 *   (a) a relay-only endpoint (ollama-cloud) is POSTed to the SAME-ORIGIN
 *       `/llm-relay?url=<encoded>` and the browser answers `llm_decision`;
 *   (b) a CORS-capable endpoint goes browser-direct (no `/llm-relay`) and is answered;
 *   (c) a frame whose `clientKeyTag` has no stored key answers `llm_error`
 *       `retryable:false` and never calls the provider.
 *
 * Part C — one full prompt/decision round trip: a table is created through the
 * real wizard (the one-click LLM-vs-LLM preset, both seats COMPUTER_LLM) and the
 * scenario answers the create call the way a live server does — `conn.raw`-ing
 * an `llm_prompt` naming the seat's just-minted `clientKeyTag`. The assertions
 * pin the wire correlation: the answer carries the requestId the prompt asked
 * about, and the prompt named the tag the create call minted.
 *
 * Real mode (E2E_BACKEND=real) needs the gated deployment: the `/config` stub is
 * fake-mode only (the real proxy serves its own, `authRequired:true`) and the
 * connect submits the token from `E2E_AUTH_TOKEN`. Without that env var the
 * dual-mode tests skip with a clear message — the gated proxy answers a
 * token-less connect with its 4401 close, so "runs in both modes" cannot mean
 * "runs without one". `window.__mageStore.handleMessage` survives for that real
 * leg ONLY: no fake server exists there to emit an `llm_prompt` on demand, and
 * the real XMage server sends one only for a live LLM seat. (The `__mageStore`
 * hook itself cannot be deleted: ~30 other e2e specs read `getState`/`setState`/
 * `setSetting` off it.)
 */

import { test, expect } from '@playwright/test'
import * as fs from 'node:fs'
import { FakeServer, STOCK_FAKE_CAPABILITIES } from '../fixtures/fake'
import { llmageScenario, type LlmageScenarioOptions } from '../fixtures/scenarios/llmageGate'
import { makeGameView, makePlayer } from '../src/__fixtures__/gameViews'
import type { GameView, LLMConversationView } from '../src/net/types'
import type { LlmPromptFrame } from '../src/net/types.generated'
import { FAKE_MODE } from './dual'
import { getFakePort, setFakePort } from './support/fake-port'
import { dismissSetupWizard, installCapture, login, type CaptureBuffers } from './support/start-game'
import { parseSent, sentOf } from './support/frames'
import { installProxyConfigStub, DEFAULT_FAKE_PROXY_CONFIG } from './support/proxy-config'

const FAKE_ONLY =
  'fake-only: drives the deterministic FixtureServer scenario (no real proxy here).'

const REAL_ONLY =
  'real mode needs E2E_AUTH_TOKEN: the gated proxy closes a token-less connect with 4401 ' +
  '(run fake mode — the default — or export the deployment token).'

const GAME_ID = 'llmage-game-1'
const TABLE_NAME = 'llmage-e2e'
const RELAY = '/llm-relay'
const OLLAMA_CLOUD = 'https://ollama.com/v1/chat/completions'
const CORS_ENDPOINT = 'https://api.example.com/v1/chat/completions'
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'

/**
 * The dummy client key the specs seed through the seat panel. Pure ASCII on
 * purpose: a key with a non-Latin-1 code point makes `fetch` throw while reading
 * the Authorization header ("String contains non ISO-8859-1 code point") and the
 * bridge answers `llm_error` instead of the expected `llm_decision`.
 */
const API_KEY = 'XXXXXX-not-a-real-key'

/** The gated deployment's token (real mode only; empty = skip, see REAL_ONLY). */
const REAL_AUTH_TOKEN = (process.env.E2E_AUTH_TOKEN ?? '').trim()

/** Real mode has no token source other than the environment. */
function requireRealAuthToken(): void {
  test.skip(!FAKE_MODE && !REAL_AUTH_TOKEN, REAL_ONLY)
}

/** The LLM conversation the drawer's panel should render. */
const LLM_VIEW: LLMConversationView = {
  playerName: 'DeepSeek Bot',
  modelName: 'deepseek-v4.1-flash',
  exchangeCount: 2,
  totalContextChars: 42,
  modelContextWindow: 0,
  streaming: true,
  streamingReasoning: 'considering the board state',
  streamingContent: 'I will pass priority',
  streamingStartedAt: Date.now(),
  messages: [
    { role: 'user', content: 'It is your turn 3.', promptType: 'turn', turn: 3, phaseStep: 'PRECOMBAT_MAIN' },
    { role: 'assistant', content: 'I cast Lightning Bolt targeting the opponent.' },
  ],
}

/** A participant game frame whose `llmDebug` carries the LLM seat. */
function llmGameView(): GameView {
  return makeGameView({
    players: [
      makePlayer({ playerId: 'me-1', name: 'Me', controlled: true, isHuman: true, life: 20 }),
      makePlayer({ playerId: 'bot-1', name: 'DeepSeek Bot', isHuman: false, life: 18 }),
    ],
    myPlayerId: 'me-1',
    activePlayerId: 'me-1',
    activePlayerName: 'Me',
    priorityPlayerName: 'Me',
    turn: 3,
    llmChatPublic: true,
    llmDebug: [LLM_VIEW],
  }) as GameView
}

/** A well-formed `llm_prompt` frame with overridable fields. */
function promptFrame(over: Partial<LlmPromptFrame>): LlmPromptFrame {
  return {
    type: 'llm_prompt',
    requestId: 'req-1',
    seatId: 'seat-1',
    gameId: GAME_ID,
    playerName: 'DeepSeek Bot',
    requestBody: JSON.stringify({ model: 'gpt-5', messages: [] }),
    apiEndpoint: OLLAMA_CLOUD,
    stream: false,
    timeoutSeconds: 600,
    clientKeyTag: 'tag-1',
    ...over,
  }
}

async function withLlmageServer(
  opts: LlmageScenarioOptions,
  run: (server: FakeServer) => Promise<void>,
): Promise<void> {
  const server = await FakeServer.start(0, () => llmageScenario(opts))
  const previousPort = getFakePort()
  setFakePort(server.port)
  try {
    await run(server)
  } finally {
    try {
      await server.stop()
    } finally {
      setFakePort(previousPort)
    }
  }
}

/**
 * Connect and land in the lobby, with WS-frame capture installed. Fake mode
 * stubs `/config` (the FixtureServer is WS-only) and logs in through the stock
 * form; real mode leaves `/config` to the gated proxy — the stub would claim
 * `authRequired:false`, which the real token gate contradicts — and submits
 * `E2E_AUTH_TOKEN` on the form the deployment actually renders.
 */
async function connectLobby(page: import('@playwright/test').Page, username: string): Promise<CaptureBuffers> {
  const buffers: CaptureBuffers = { frames: [], sent: [], pageErrors: [] }
  installCapture(page, buffers)
  if (FAKE_MODE) {
    await installProxyConfigStub(page, DEFAULT_FAKE_PROXY_CONFIG)
    await login(page, username)
    return buffers
  }
  await page.goto('/?proxyPort=8787&server=127.0.0.1:17181')
  await dismissSetupWizard(page)
  await page.getByLabel(/Nombre de usuario|Usuario|Username/i).fill(username)
  const password = page.getByLabel(/Contraseña|Password/i)
  if (await password.isEnabled().catch(() => false)) await password.fill('x')
  const auth = page.getByTestId('login-auth-token')
  await expect(auth).toBeVisible({ timeout: 10_000 })
  await auth.fill(REAL_AUTH_TOKEN)
  await page.getByRole('button', { name: /Conectar|Connect/i }).click()
  await expect(page.getByRole('heading', { name: /Lobby|XMage Nexus/i })).toBeVisible({ timeout: 20_000 })
  return buffers
}

/**
 * Connect, then press Start on the scenario's table so the app enters the game
 * screen. The scenario's own `GAME_INIT` (a real frame on the real ingress)
 * carries the view, so the drawer strip — which mounts with `phase === 'game'` —
 * is what we wait for.
 */
async function connectAndStart(page: import('@playwright/test').Page, username: string): Promise<CaptureBuffers> {
  const buffers = await connectLobby(page, username)
  const row = page.locator('.table-row', { hasText: TABLE_NAME }).first()
  await expect(row).toBeVisible({ timeout: 10_000 })
  await row.getByRole('button', { name: /Empezar|Iniciar Partida|Start/i }).click({ force: true })
  await expect(page.getByTestId('drawer-tab-log')).toBeVisible({ timeout: 20_000 })
  return buffers
}

/**
 * Inject a store message through the app's own exported handler. Real-mode Part
 * B only (see the file header): the page is on the real proxy and no fake server
 * exists to put an `llm_prompt` on the socket.
 */
async function pushMessage(page: import('@playwright/test').Page, message: Record<string, unknown>): Promise<void> {
  await page.evaluate((msg) => {
    const store = (window as unknown as { __mageStore?: { handleMessage: (m: unknown) => void } }).__mageStore
    if (!store) throw new Error('no __mageStore (dev hook missing)')
    store.handleMessage(msg)
  }, message)
}

/** The args of the most recent outgoing frame for `action`, if any. */
function sentArgs(page: import('@playwright/test').Page, action: string): Record<string, unknown> | undefined {
  return parseSent(sentOf(page)).filter((f) => f.action === action).pop()?.args
}

/**
 * A per-test queue of raw `llm_prompt` frames delivered by the fake WS backend.
 * The scenario's `onVerb` hook fires for every verb the base scenario does not
 * itself answer; `getFinishedMatches` (requested by the History panel on
 * opening) is the deterministic in-app trigger used to flush the queue. The
 * hook must answer the trigger normally (return false → the llmGate scenario
 * answers ok:[]), so the panel keeps working while the frames ride `conn.raw`
 * onto the app's real socket.
 */
function llmPromptOverWs(frames: LlmPromptFrame[]): LlmageScenarioOptions['onVerb'] {
  return (conn, action) => {
    if (action !== 'getFinishedMatches') return false
    for (const frame of frames.splice(0)) conn.raw(frame)
    return false
  }
}

/**
 * Deliver `llm_prompt` frame(s) through the REAL ingress: queue them for the
 * fake server's `onVerb` hook, then open the History panel — its
 * `getFinishedMatches` request is the trigger the hook answers by
 * `conn.raw`-ing the frames onto the app's WebSocket (WS → Gateway JSON parse
 * → eventHandler case → bridge). Real mode keeps the dev-hook dispatch: see the
 * file header.
 */
async function dispatchLlmPrompt(
  page: import('@playwright/test').Page,
  frames: LlmPromptFrame[],
  opts: LlmageScenarioOptions,
): Promise<void> {
  if (!FAKE_MODE) {
    for (const frame of frames) await pushMessage(page, frame as unknown as Record<string, unknown>)
    return
  }
  opts.onVerb = llmPromptOverWs([...frames])
  await page.getByRole('button', { name: /^Historial$/ }).first().click()
  // The History tab's default panel mounting is what issues the trigger verb;
  // the raw llm_prompt frames follow it onto the socket (the assertions below
  // poll the outgoing llm_decision/llm_error, which covers the async delivery).
  await expect(page.locator('.finished-matches-panel')).toBeVisible({ timeout: 10_000 })
}

/**
 * Seed a client API key through the REAL UI and return the opaque `clientKeyTag`
 * the app minted for it (read off the outgoing `createTable` frame). The key store
 * lives in module memory and is not on `window`, so this is the only reachable path.
 * Leaves the app in the lobby (the created table joins its bot seats, not us).
 * `providerId` optionally picks a provider in the endpoint dropdown BEFORE the
 * key is filled, so the minted tag is also BOUND to that endpoint (endpoint binding).
 */
async function seedClientKey(
  page: import('@playwright/test').Page,
  apiKey: string,
  providerId?: string,
): Promise<string> {
  await page.getByRole('button', { name: /Nueva/i }).first().click()
  await expect(page.getByRole('heading', { name: /Nueva mesa|Crear Mesa/i })).toBeVisible()
  // Seats step → an LLM seat carrying a client-key apiKey.
  await page.locator('button.wizard-step', { hasText: /Multijugador/i }).click()
  // Turn the human seat OFF so submit needs no human deck (the LLM seat has its own).
  await page.locator('.human-seat-box').getByRole('button', { name: /Jugador|Player/ }).click()
  await expect(page.getByTestId('seat-type-0')).toBeVisible()
  await page.getByTestId('seat-type-0').selectOption('COMPUTER_LLM')
  await expect(page.getByTestId('llm-config-panel-0')).toBeVisible()
  if (providerId) await page.getByTestId('llm-provider').selectOption(providerId)
  await page.getByTestId('llm-apiKey').fill(apiKey)
  // Jump to the (last) Dev step where the submit button lives, then submit.
  await page.locator('button.wizard-step', { hasText: /Dev/i }).click()
  await page.locator('.create-submit-btn').click()

  // The conversion minted a clientKeyTag for the key; read it off the wire.
  await expect
    .poll(() => parseSent(sentOf(page)).find((f) => f.action === 'createTable'), { timeout: 10_000 })
    .toBeTruthy()
  const configs = sentArgs(page, 'createTable')?.llmConfigs as Array<Record<string, unknown>> | undefined
  const tag = configs?.[0]?.clientKeyTag
  if (typeof tag !== 'string' || !tag) throw new Error(`no clientKeyTag on createTable: ${JSON.stringify(configs)}`)
  return tag
}

/**
 * Create an ALL-BOT table through the real wizard: the one-click LLM-vs-LLM
 * preset puts COMPUTER_LLM in both seats, and seat 0 gets a client key (bound to
 * the provider picked in its endpoint dropdown) so the browser can answer the
 * prompt the server sends for that seat.
 */
async function createLlmVsLlmTable(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: /Nueva/i }).first().click()
  await expect(page.getByRole('heading', { name: /Nueva mesa|Crear Mesa/i })).toBeVisible()
  await page.locator('button.wizard-step', { hasText: /Multijugador/i }).click()
  const chip = page.getByTestId('llm-vs-llm-preset')
  await expect(chip).toBeVisible({ timeout: 10_000 })
  await chip.click()
  const seat0 = page.getByTestId('llm-config-panel-0')
  await expect(seat0).toBeVisible({ timeout: 10_000 })
  await seat0.getByTestId('llm-provider').selectOption('groq')
  await seat0.getByTestId('llm-apiKey').fill(API_KEY)
  await page.locator('button.wizard-step', { hasText: /Dev/i }).click()
  await page.locator('.create-submit-btn').click()
}

/** The `clientKeyTag` the app minted for the k-th LLM seat of the last createTable. */
function createTableTag(page: import('@playwright/test').Page, seat = 0): string | undefined {
  const configs = sentArgs(page, 'createTable')?.llmConfigs as Array<Record<string, unknown>> | undefined
  const tag = configs?.[seat]?.clientKeyTag
  return typeof tag === 'string' && tag ? tag : undefined
}

/** CORS headers so a stubbed cross-origin fulfill is not blocked by the browser. */
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
}

// ─────────────────────────── Part A — the drawer tab ────────────────────────

test('llm tab: absent without capabilities.llm @llmtab', async ({ page }) => {
  test.skip(!FAKE_MODE, FAKE_ONLY)
  const stock: LlmageScenarioOptions = {
    capabilities: STOCK_FAKE_CAPABILITIES,
    playerTypes: STOCK_FAKE_CAPABILITIES.playerTypes as string[],
    gameView: llmGameView(),
  }
  await withLlmageServer(stock, async () => {
    const { pageErrors } = await connectAndStart(page, 'llm-stock')
    // The scenario's own GAME_INIT carried an LLM seat; the strip is alive…
    await expect(page.getByTestId('drawer-tab-log')).toBeVisible()
    // …but the gate is off: the LLM drawer tab must not exist even with an LLM seat.
    await expect(page.getByTestId('drawer-tab-llm')).toHaveCount(0)
    expect(pageErrors, `pageerrors: ${pageErrors.map(String).join(' | ')}`).toEqual([])
  })
})

test('llm tab: opens with the seat, its messages and the streaming lines @llmtab', async ({ page }) => {
  test.skip(!FAKE_MODE, FAKE_ONLY)
  await withLlmageServer({ gameView: llmGameView() }, async () => {
    const { pageErrors } = await connectAndStart(page, 'llm-open')

    // Gate open (capabilities.llm + an LLM seat): the drawer offers the tab.
    const tab = page.getByTestId('drawer-tab-llm')
    await expect(tab).toBeVisible({ timeout: 10_000 })
    await tab.click()

    const panel = page.getByTestId('llm-tab')
    await expect(panel).toBeVisible()

    const player = panel.getByTestId('llm-player')
    await expect(player).toHaveCount(1)
    await expect(player).toContainText('DeepSeek Bot')
    await expect(player).toContainText('deepseek-v4.1-flash')

    await expect(panel.getByTestId('llm-message')).toHaveCount(2)
    await expect(panel).toContainText('I cast Lightning Bolt targeting the opponent.')

    await expect(panel.getByTestId('llm-streaming')).toBeVisible()
    await expect(panel.getByTestId('llm-streaming-reasoning')).toContainText('considering the board state')
    await expect(panel.getByTestId('llm-streaming-content')).toContainText('I will pass priority')

    expect(pageErrors, `pageerrors: ${pageErrors.map(String).join(' | ')}`).toEqual([])
  })
})

test('llm tab: the seat transcript downloads as a real file, built in the browser @llmtab', async ({ page }) => {
  test.skip(!FAKE_MODE, FAKE_ONLY)
  await withLlmageServer({ gameView: llmGameView() }, async () => {
    const { pageErrors } = await connectAndStart(page, 'llm-transcript')

    const tab = page.getByTestId('drawer-tab-llm')
    await expect(tab).toBeVisible({ timeout: 10_000 })
    await tab.click()

    const button = page.getByTestId('llm-tab').getByTestId('llm-download-transcript')
    // Never assert on the label: the app language follows the browser locale (this run
    // rendered Spanish). The English copy is pinned by the unit test; here the click and
    // the resulting file are the subject.
    await expect(button).toBeVisible()

    const [download] = await Promise.all([page.waitForEvent('download'), button.click()])
    // The server names its own transcript `<player>_<model>_transcript-<stamp>.txt`; the
    // browser copy must be indistinguishable by name so the two can sit side by side.
    expect(download.suggestedFilename()).toMatch(
      /^DeepSeek_Bot_deepseek-v4\.1-flash_transcript-\d{8}-\d{6}\.txt$/,
    )

    const file = await download.path()
    const text = fs.readFileSync(file, 'utf8')
    expect(text).toContain('=== LLM TRANSCRIPT (exported from the web client) ===')
    expect(text).toContain(`Game: ${GAME_ID}`)
    expect(text).toContain('Player: DeepSeek Bot')
    expect(text).toContain('Model: deepseek-v4.1-flash')
    expect(text).toContain('It is your turn 3.')
    expect(text).toContain('I cast Lightning Bolt targeting the opponent.')
    // The live frame was NOT trimmed, so the file must not claim to be partial.
    expect(text).not.toContain('PARTIAL')

    expect(pageErrors, `pageerrors: ${pageErrors.map(String).join(' | ')}`).toEqual([])
  })
})

// ─────────────────────── Part B — /llm-relay routing ─────────────────────────

test('llm relay: a relay-only endpoint is POSTed same-origin and answered with llm_decision', async ({ page }) => {
  requireRealAuthToken()
  const opts: LlmageScenarioOptions = {}
  await withLlmageServer(opts, async () => {
    const buffers = await connectLobby(page, `relay-${String(Date.now()).slice(-8)}`)
    const tag = await seedClientKey(page, API_KEY)

    // Record the same-origin relay and fulfil a provider-shaped body (no network).
    const relayHits: string[] = []
    await page.route('**/llm-relay**', async (route) => {
      relayHits.push(route.request().url())
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'pass' } }] }),
      })
    })

    const requestId = '11111111-1111-4111-8111-111111111111'
    await dispatchLlmPrompt(page, [promptFrame({ requestId, apiEndpoint: OLLAMA_CLOUD, clientKeyTag: tag })], opts)

    await expect
      .poll(() => sentArgs(page, 'llm_decision'), { timeout: 10_000 })
      .toMatchObject({ requestId, rawResponse: expect.stringContaining('pass'), httpStatus: 200 })

    // Same-origin relay carrying the encoded ollama endpoint.
    expect(relayHits).toHaveLength(1)
    const relayUrl = relayHits[0]
    expect(relayUrl).toContain(`${RELAY}?url=`)
    expect(decodeURIComponent(relayUrl.split('url=')[1])).toBe(OLLAMA_CLOUD)
    expect(new URL(relayUrl).origin).toBe(new URL(page.url()).origin)

    expect(buffers.pageErrors, `pageerrors: ${buffers.pageErrors.map(String).join(' | ')}`).toEqual([])
  })
})

test('llm relay: a CORS endpoint goes browser-direct (no /llm-relay) and is answered @llmtab', async ({ page }) => {
  requireRealAuthToken()
  const opts: LlmageScenarioOptions = {}
  await withLlmageServer(opts, async () => {
    const buffers = await connectLobby(page, `direct-${String(Date.now()).slice(-8)}`)
    const tag = await seedClientKey(page, API_KEY)

    let relayHits = 0
    await page.route('**/llm-relay**', (route) => {
      relayHits++
      return route.fulfill({ status: 500, headers: CORS_HEADERS, body: 'relay must not be used' })
    })
    const directHits: string[] = []
    await page.route(CORS_ENDPOINT, async (route) => {
      directHits.push(route.request().url())
      await route.fulfill({
        status: 200,
        headers: CORS_HEADERS,
        contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'direct ok' } }] }),
      })
    })

    const requestId = '22222222-2222-4222-8222-222222222222'
    await dispatchLlmPrompt(page, [promptFrame({ requestId, apiEndpoint: CORS_ENDPOINT, clientKeyTag: tag })], opts)

    await expect
      .poll(() => sentArgs(page, 'llm_decision'), { timeout: 10_000 })
      .toMatchObject({ requestId, rawResponse: expect.stringContaining('direct ok'), httpStatus: 200 })

    // Browser-direct: the provider URL was hit, the relay never was.
    expect(directHits).toEqual([CORS_ENDPOINT])
    expect(relayHits).toBe(0)

    expect(buffers.pageErrors, `pageerrors: ${buffers.pageErrors.map(String).join(' | ')}`).toEqual([])
  })
})

test('llm relay: a frame with no stored key answers llm_error retryable:false and never calls the provider', async ({ page }) => {
  requireRealAuthToken()
  const opts: LlmageScenarioOptions = {}
  await withLlmageServer(opts, async () => {
    const buffers = await connectLobby(page, `nokey-${String(Date.now()).slice(-8)}`)

    let providerHits = 0
    await page.route('**/llm-relay**', (route) => { providerHits++; return route.abort() })
    await page.route(CORS_ENDPOINT, (route) => { providerHits++; return route.abort() })

    const requestId = '33333333-3333-4333-8333-333333333333'
    // An unseeded tag: the key store is memory-only, so this always misses.
    await dispatchLlmPrompt(page, [promptFrame({ requestId, apiEndpoint: OLLAMA_CLOUD, clientKeyTag: 'never-stored-tag' })], opts)

    await expect.poll(() => sentArgs(page, 'llm_error')?.requestId, { timeout: 10_000 }).toBe(requestId)
    expect(sentArgs(page, 'llm_error')?.retryable).toBe(false)

    // No provider request at all — neither the relay nor the endpoint.
    expect(providerHits).toBe(0)
    await expect.poll(() => parseSent(sentOf(page)).some((f) => f.action === 'llm_decision')).toBe(false)

    expect(buffers.pageErrors, `pageerrors: ${buffers.pageErrors.map(String).join(' | ')}`).toEqual([])
  })
})

test('llm bridge: a prompt naming a DIFFERENT endpoint than the seat\'s bound one is refused without a provider call (endpoint binding)', async ({ page }) => {
  test.skip(!FAKE_MODE, FAKE_ONLY)
  const opts: LlmageScenarioOptions = {}
  await withLlmageServer(opts, async () => {
    const buffers = await connectLobby(page, `bound-${String(Date.now()).slice(-8)}`)
    // Seed the key through the UI with the endpoint dropdown ON groq: the wire
    // conversion binds groq's endpoint to the minted tag.
    const tag = await seedClientKey(page, API_KEY, 'groq')

    // A hostile server names ITS OWN endpoint for the stolen tag.
    let providerHits = 0
    await page.route('**/llm-relay**', (route) => { providerHits++; return route.abort() })
    await page.route('https://evil.example/v1/chat/completions', (route) => { providerHits++; return route.abort() })

    const requestId = '44444444-4444-4444-8444-444444444444'
    await dispatchLlmPrompt(
      page,
      [promptFrame({ requestId, apiEndpoint: 'https://evil.example/v1/chat/completions', clientKeyTag: tag })],
      opts,
    )

    // The refusal answers llm_error retryable:false naming the mismatch…
    await expect.poll(() => sentArgs(page, 'llm_error')?.requestId, { timeout: 10_000 }).toBe(requestId)
    expect(sentArgs(page, 'llm_error')?.retryable).toBe(false)
    expect(String(sentArgs(page, 'llm_error')?.message)).toContain('endpoint mismatch')
    // …and the key never left: neither the named endpoint nor the relay was hit.
    expect(providerHits).toBe(0)
    await expect.poll(() => parseSent(sentOf(page)).some((f) => f.action === 'llm_decision')).toBe(false)

    expect(buffers.pageErrors, `pageerrors: ${buffers.pageErrors.map(String).join(' | ')}`).toEqual([])
  })
})

test('llm bridge: a prompt naming the SAME endpoint as the seat\'s binding is answered (endpoint-binding control)', async ({ page }) => {
  test.skip(!FAKE_MODE, FAKE_ONLY)
  const opts: LlmageScenarioOptions = {}
  await withLlmageServer(opts, async () => {
    const buffers = await connectLobby(page, `match-${String(Date.now()).slice(-8)}`)
    // Seed the key with the endpoint dropdown ON groq: the tag is bound to that endpoint.
    const tag = await seedClientKey(page, API_KEY, 'groq')

    const directHits: string[] = []
    await page.route(GROQ_ENDPOINT, async (route) => {
      directHits.push(route.request().url())
      await route.fulfill({
        status: 200,
        headers: CORS_HEADERS,
        contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'bound ok' } }] }),
      })
    })

    const requestId = '55555555-5555-4555-8555-555555555555'
    await dispatchLlmPrompt(
      page,
      [promptFrame({ requestId, apiEndpoint: GROQ_ENDPOINT, clientKeyTag: tag })],
      opts,
    )

    await expect
      .poll(() => sentArgs(page, 'llm_decision'), { timeout: 10_000 })
      .toMatchObject({ requestId, rawResponse: expect.stringContaining('bound ok'), httpStatus: 200 })
    expect(directHits).toEqual([GROQ_ENDPOINT])

    expect(buffers.pageErrors, `pageerrors: ${buffers.pageErrors.map(String).join(' | ')}`).toEqual([])
  })
})

// ────────────── Part C — an LLM-vs-LLM table's prompt round trip ─────────────

test('llm round trip: an LLM-vs-LLM table is created and its prompt is answered with a correlated llm_decision @llmtab', async ({ page }) => {
  test.skip(!FAKE_MODE, FAKE_ONLY)
  const requestId = '66666666-6666-4666-8666-666666666666'
  let promptedTag: string | null = null
  const opts: LlmageScenarioOptions = {
    // A live server asks the browser of the seat its own table just created;
    // the fake one answers the create call the same way, over the same socket.
    onTableCreated: (conn, _action, args) => {
      const tag = (args.llmConfigs as Array<Record<string, unknown>> | undefined)?.[0]?.clientKeyTag
      if (typeof tag !== 'string' || !tag) return
      promptedTag = tag
      conn.raw(promptFrame({ requestId, apiEndpoint: GROQ_ENDPOINT, clientKeyTag: tag }))
    },
  }
  await withLlmageServer(opts, async () => {
    const buffers = await connectLobby(page, `round-${String(Date.now()).slice(-8)}`)

    const directHits: string[] = []
    await page.route(GROQ_ENDPOINT, async (route) => {
      directHits.push(route.request().url())
      await route.fulfill({
        status: 200,
        headers: CORS_HEADERS,
        contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'round trip ok' } }] }),
      })
    })

    await createLlmVsLlmTable(page)

    // The table went out all-bot, with a client key on its first LLM seat…
    await expect
      .poll(() => sentArgs(page, 'createTable')?.playerTypes, { timeout: 10_000 })
      .toEqual(['COMPUTER_LLM', 'COMPUTER_LLM'])
    const tag = createTableTag(page)
    expect(tag, `no clientKeyTag on createTable: ${JSON.stringify(sentArgs(page, 'createTable')?.llmConfigs)}`).toBeTruthy()

    // …the server's prompt (real WS ingress) named exactly that seat's tag…
    expect(promptedTag).toBe(tag)
    // …and the store answered the SAME requestId it was asked about.
    await expect
      .poll(() => sentArgs(page, 'llm_decision'), { timeout: 10_000 })
      .toMatchObject({ requestId, rawResponse: expect.stringContaining('round trip ok'), httpStatus: 200 })
    expect(parseSent(sentOf(page)).filter((f) => f.action === 'llm_decision')).toHaveLength(1)
    expect(directHits).toEqual([GROQ_ENDPOINT])

    expect(buffers.pageErrors, `pageerrors: ${buffers.pageErrors.map(String).join(' | ')}`).toEqual([])
  })
})
