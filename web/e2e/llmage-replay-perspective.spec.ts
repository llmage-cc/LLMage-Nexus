/**
 * E2E — the replay "view as" seat picker. The DEFAULT perspective already
 * auto-picks: `pickPerspectivePlayer()` prefers a username-matching seat and
 * falls back to `players[0]`. What this pins is the picker BETWEEN seats.
 *
 * What this pins, through the real store/handlers/DOM:
 *   1. The default perspective is today's auto-pick: the signed-in username
 *      matches no seat, so `players[0]` (Alice) renders as the own (bottom) side
 *      and Bob as the opponent.
 *   2. The replay chrome offers a "view as" button per seat, the auto-picked
 *      seat marked pressed.
 *   3. Clicking the other seat SWAPS the rendered sides — Bob becomes the own
 *      zone and Alice the opponent zone (a re-render, not just a store write).
 *   4. No page errors through the whole flow.
 *
 * Fake mode (default): the FixtureServer + `llmageScenario` harness the
 * replay-viewer spec uses, plus the production relay modelled in `onVerb`
 * (`replayGame` → `REPLAY_GAME` → `REPLAY_INIT`). The frame is a
 * SPECTATOR-SHAPED replay GameView — every seat `controlled:false`, exactly as
 * the wire carries a watched replay, which is the state that makes the
 * perspective picker meaningful in the first place.
 */

import { test, expect } from '@playwright/test'
import { FakeServer } from '../fixtures/fake'
import { llmageScenario, DEFAULT_REPLAY_FILES, type LlmageScenarioOptions } from '../fixtures/scenarios/llmageGate'
import { makeGameView, makePlayer } from '../src/__fixtures__/gameViews'
import type { GameView } from '../src/net/types'
import { FAKE_MODE } from './dual'
import { getFakePort, setFakePort } from './support/fake-port'
import { installCapture, login, type CaptureBuffers } from './support/start-game'
import { installProxyConfigStub, DEFAULT_FAKE_PROXY_CONFIG } from './support/proxy-config'

const FAKE_ONLY =
  'fake-only: drives the deterministic FixtureServer scenario (the parent runs the real suite separately).'

/** The saved-replay row the spec clicks (default listing row 1). */
const REPLAY_ID = DEFAULT_REPLAY_FILES.files[0].gameId

/**
 * A replay GameView as the wire carries it: spectator-shaped (NO seat
 * `controlled` — the proxy watches the replay session), two seats.
 */
function replayFrame(): GameView {
  return makeGameView({
    players: [
      makePlayer({ playerId: 'p1', name: 'Alice', life: 20 }),
      makePlayer({ playerId: 'p2', name: 'Bob', life: 18 }),
    ],
    myPlayerId: null,
    activePlayerId: 'p2',
    activePlayerName: 'Bob',
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
 * The production relay the fake must model: `replayGame` creates the session,
 * the server then emits `REPLAY_GAME` (viewer opens) and `REPLAY_INIT` (first
 * frame). Emitted from `onVerb` so `fixtures/fake.ts` stays untouched.
 */
function replayLoadRelay(): LlmageScenarioOptions['onVerb'] {
  return (conn, action, args, requestId) => {
    if (action !== 'replayGame') return false
    const gameId = String(args.gameId ?? '')
    conn.ok(requestId, action, undefined)
    conn.broadcast('REPLAY_GAME', null, gameId)
    conn.broadcast(
      'REPLAY_INIT',
      { gameView: replayFrame(), replayStateIndex: 0, replayStateCount: 7 },
      gameId,
    )
    return true
  }
}

/** The own (bottom) and opponent seat names the board is currently painting. */
async function renderedSides(page: import('@playwright/test').Page): Promise<{ own: string | null; opp: string | null }> {
  return page.evaluate(() => ({
    own: document.querySelector('.game-board > .player-zone')?.getAttribute('data-player-name') ?? null,
    opp: document.querySelector('.game-board > .opponent-zone')?.getAttribute('data-player-name') ?? null,
  }))
}

test('replay "view as": the default auto-pick renders, and picking the other seat swaps the sides @replayperspective', async ({ page }) => {
  test.skip(!FAKE_MODE, FAKE_ONLY)
  await withLlmageServer({ onVerb: replayLoadRelay() }, async () => {
    // The login name matches NO seat, so the default perspective is players[0].
    const { pageErrors } = await openReplayPanel(page, 'repl-perspective')

    const row = page.locator('.replay-files-item').first()
    await expect(row).toBeVisible({ timeout: 10_000 })
    await row.getByRole('button', { name: /Ver Repetición/ }).click()

    // 1) the viewer chrome + board mount off the callbacks.
    await expect(page.locator('[data-testid="replay-controls"]')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('[data-testid="game-status"]')).toBeVisible({ timeout: 10_000 })

    // 2) the default perspective is the auto-pick: Alice own, Bob opponent.
    await expect(page.locator('.game-board > .player-zone[data-player-name="Alice"]')).toBeVisible({ timeout: 10_000 })
    expect(await renderedSides(page)).toEqual({ own: 'Alice', opp: 'Bob' })

    // 3) the chrome offers one "view as" button per seat; the auto-picked Alice
    //    is the pressed one.
    const picker = page.locator('[data-testid="replay-perspective"]')
    await expect(picker).toBeVisible({ timeout: 10_000 })
    const alice = page.locator('[data-testid="replay-perspective-p1"]')
    const bob = page.locator('[data-testid="replay-perspective-p2"]')
    await expect(alice).toBeVisible()
    await expect(bob).toBeVisible()
    await expect(alice).toHaveAttribute('aria-pressed', 'true')
    await expect(bob).toHaveAttribute('aria-pressed', 'false')

    // 4) picking the other seat SWAPS which side renders as own.
    await bob.click()
    await expect(page.locator('.game-board > .player-zone[data-player-name="Bob"]')).toBeVisible({ timeout: 10_000 })
    expect(await renderedSides(page)).toEqual({ own: 'Bob', opp: 'Alice' })
    await expect(bob).toHaveAttribute('aria-pressed', 'true')
    await expect(alice).toHaveAttribute('aria-pressed', 'false')

    // The pick is store state scoped to the open replay (session, not persisted).
    const state = await page.evaluate(() => (globalThis as unknown as {
      __mageStore?: { getState: () => { replay?: { gameId?: string; perspectivePlayerId?: string | null } | null } }
    }).__mageStore?.getState())
    expect(state?.replay?.gameId).toBe(REPLAY_ID)
    expect(state?.replay?.perspectivePlayerId).toBe('p2')

    expect(pageErrors, `pageerrors: ${pageErrors.map(String).join(' | ')}`).toEqual([])
  })
})
