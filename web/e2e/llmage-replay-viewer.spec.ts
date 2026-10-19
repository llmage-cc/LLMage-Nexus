/**
 * E2E — WATCH REPLAY opens the viewer and the session survives.
 *
 * Fake mode (default): drives the real UI against a locally started
 * FixtureServer running `llmageScenario` (its connect result carries
 * `capabilities.llm:true`, which unlocks both the fork-only "Saved replays"
 * panel and the replay scrubber chrome). The scenario's `onVerb` hook models
 * the ONE thing the fake backend did not: the production relay of the server's
 * replay-load flow. In production, `replayGame` only CREATES the server-side
 * replay session; the board is opened by the server's `REPLAY_GAME` callback and
 * the first state arrives as `REPLAY_INIT`. The web must therefore drive the
 * viewer off the CALLBACK, never off the `replayGame` result (documented race).
 *
 * What this pins, end to end, through the real store/handlers:
 *   1. Clicking "Watch Replay" sends `replayGame` for that row's gameId.
 *   2. The `REPLAY_GAME` callback opens the viewer: `[data-testid=replay-controls]`
 *      mounts and issues the `startReplay` follow-up (callback-driven, not the ACK).
 *   3. The first `REPLAY_INIT` frame paints the board: a board container
 *      (`[data-testid=game-status]`) and a seek scrubber (`input[type=range]`,
 *      `[data-testid=replay-scrubber]`) are both present.
 *   4. The session STAYS on the replay: no `serverLink failed`/`superseded`, no
 *      `disconnected` frame, and the store is left in `phase:'game'` with a live
 *      `replay` slice (a replay load that tore the session down used to fall
 *      back to the login screen).
 */

import { test, expect } from '@playwright/test'
import { FakeServer } from '../fixtures/fake'
import { llmageScenario, DEFAULT_REPLAY_FILES, type LlmageScenarioOptions } from '../fixtures/scenarios/llmageGate'
import { makeGameView, makePlayer } from '../src/__fixtures__/gameViews'
import type { GameView } from '../src/net/types'
import { FAKE_MODE } from './dual'
import { getFakePort, setFakePort } from './support/fake-port'
import { installCapture, login, type CaptureBuffers } from './support/start-game'
import { parseSent, sentOf, parseFrames, framesOf } from './support/frames'
import { installProxyConfigStub, DEFAULT_FAKE_PROXY_CONFIG } from './support/proxy-config'

const FAKE_ONLY =
  'fake-only: drives the deterministic FixtureServer scenario (the parent runs the real suite separately).'

/** The saved-replay row the spec clicks (default listing row 1). */
const REPLAY_ID = DEFAULT_REPLAY_FILES.files[0].gameId

/**
 * A replay GameView: spectator-shaped (`controlled` false — the proxy watches the
 * replay session), two seats, one of them the chosen viewing perspective.
 */
function replayGameView(): GameView {
  return makeGameView({
    players: [
      makePlayer({ playerId: 'p1', name: 'Alice', life: 20, controlled: true }),
      makePlayer({ playerId: 'p2', name: 'Bob', life: 18 }),
    ],
    myPlayerId: 'p1',
    activePlayerId: 'p1',
    activePlayerName: 'Alice',
    turn: 4,
  })
}

/** Spin up a FixtureServer with the LLMage scenario and point the page at it. */
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

/** Connect and open the History tab's "Saved replays" panel. */
async function openReplayPanel(page: import('@playwright/test').Page, username: string): Promise<CaptureBuffers> {
  const buffers: CaptureBuffers = { frames: [], sent: [], pageErrors: [] }
  installCapture(page, buffers)
  await installProxyConfigStub(page, DEFAULT_FAKE_PROXY_CONFIG)
  await login(page, username)
  await page.getByRole('button', { name: /^Historial$/ }).first().click()
  await page.getByRole('tab', { name: /Repeticiones guardadas/ }).click()
  await expect(page.locator('.replay-files-panel')).toBeVisible({ timeout: 10_000 })
  return buffers
}

/**
 * The production relay the fake must model: `replayGame` creates the replay
 * session, the server then emits `REPLAY_GAME` (viewer opens) and `REPLAY_INIT`
 * (first frame). Emitting them from `onVerb` keeps `fixtures/fake.ts` untouched.
 */
function replayLoadRelay(): LlmageScenarioOptions['onVerb'] {
  return (conn, action, args, requestId) => {
    if (action !== 'replayGame') return false
    const gameId = String(args.gameId ?? '')
    conn.ok(requestId, action, undefined)
    // 1) server announced the replay session → the viewer must open off THIS.
    conn.broadcast('REPLAY_GAME', null, gameId)
    // 2) first saved state, as a full GameView (spectator-shaped, like the wire).
    conn.broadcast(
      'REPLAY_INIT',
      { gameView: replayGameView(), replayStateIndex: 0, replayStateCount: 7 },
      gameId,
    )
    return true
  }
}

test('watch replay: the viewer mounts (board + seek scrubber) and the session survives @replayviewer', async ({ page }) => {
  test.skip(!FAKE_MODE, FAKE_ONLY)
  await withLlmageServer({ onVerb: replayLoadRelay() }, async () => {
    const { pageErrors } = await openReplayPanel(page, 'repl-viewer')

    const row = page.locator('.replay-files-item').first()
    await expect(row).toBeVisible({ timeout: 10_000 })
    await row.getByRole('button', { name: /Ver Repetición/ }).click()

    // 1) the click issued replayGame for THIS row's save.
    await expect
      .poll(() => parseSent(sentOf(page)).some((f) => f.action === 'replayGame' && f.args?.gameId === REPLAY_ID), {
        timeout: 10_000,
      })
      .toBe(true)

    // 2) the REPLAY_GAME callback opened the viewer, which then asked to start it.
    await expect
      .poll(() => parseFrames(framesOf(page)).some((f) => f.method === 'REPLAY_GAME' && f.objectId === REPLAY_ID), {
        timeout: 10_000,
      })
      .toBe(true)
    await expect
      .poll(() => parseSent(sentOf(page)).some((f) => f.action === 'startReplay' && f.args?.gameId === REPLAY_ID), {
        timeout: 10_000,
      })
      .toBe(true)

    // 3) the viewer chrome is mounted: scrubber + board container.
    await expect(page.locator('[data-testid="replay-controls"]')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('[data-testid="replay-controls"] input[type="range"]')).toHaveCount(1)
    await expect(page.locator('[data-testid="replay-scrubber"]')).toBeVisible()
    await expect(page.locator('[data-testid="game-status"]')).toBeVisible({ timeout: 10_000 })

    // 4) the session stayed on the replay — no teardown to the login screen.
    const parsed = parseFrames(framesOf(page))
    expect(parsed.some((f) => f.method === 'serverLink')).toBe(false)
    expect(parsed.some((f) => f.method === 'disconnected')).toBe(false)
    const state = await page.evaluate(() => (globalThis as unknown as {
      __mageStore?: { getState: () => { phase?: string; replay?: { gameId?: string } | null } }
    }).__mageStore?.getState())
    expect(state?.phase).toBe('game')
    expect(state?.replay?.gameId).toBe(REPLAY_ID)

    expect(pageErrors, `pageerrors: ${pageErrors.map(String).join(' | ')}`).toEqual([])
  })
})

test('watch replay: the viewer does NOT open off the replayGame ACK alone (callback-driven) @replayviewer', async ({ page }) => {
  test.skip(!FAKE_MODE, FAKE_ONLY)
  // Negative control: the ACK arrives but the server never emits REPLAY_GAME.
  // The viewer must stay closed — proof the flow is callback-driven, not ACK-driven.
  const ackOnly: LlmageScenarioOptions['onVerb'] = (conn, action, args, requestId) => {
    if (action !== 'replayGame') return false
    conn.ok(requestId, action, undefined)
    return true
  }
  await withLlmageServer({ onVerb: ackOnly }, async () => {
    const { pageErrors } = await openReplayPanel(page, 'repl-ackonly')

    const row = page.locator('.replay-files-item').first()
    await expect(row).toBeVisible({ timeout: 10_000 })
    await row.getByRole('button', { name: /Ver Repetición/ }).click()

    // The ACK went out…
    await expect
      .poll(() => parseSent(sentOf(page)).some((f) => f.action === 'replayGame'), { timeout: 10_000 })
      .toBe(true)
    // …but with no callback the viewer (and thus the scrubber) must never mount.
    await page.waitForTimeout(750)
    await expect(page.locator('[data-testid="replay-controls"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="replay-scrubber"]')).toHaveCount(0)

    expect(pageErrors, `pageerrors: ${pageErrors.map(String).join(' | ')}`).toEqual([])
  })
})
