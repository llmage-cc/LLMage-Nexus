import { fakeOnly } from './support/fake-mode'
import { test, expect } from './fixtures'
import { DECK } from '../fixtures/deck-names'
import { startGame } from './support/start-game'
import { withFakeServer } from './support/fake-backend'
import { makeBaseScenario } from '../fixtures/fake'
import { makeCard, makeGameView, makePlayer, makePermanent } from '../src/__fixtures__/gameViews'
import {
  GAME_ID, HUMAN_NAME, HUMAN_PLAYER_ID, SIM_NAME, SIM_PLAYER_ID, TABLE_ID,
} from '../fixtures/humanGameConstants'
import { parseSent, sentOf } from './support/frames'
import type { Page } from '@playwright/test'
import type { GameView } from '../src/net/types'

fakeOnly()

const RELOAD_TABLE = 'reload-restore-test'

function boardView(): GameView {
  return makeGameView({
    players: [
      makePlayer({
        playerId: HUMAN_PLAYER_ID,
        name: HUMAN_NAME,
        controlled: true,
        isHuman: true,
        isActive: true,
        hasPriority: true,
        life: 20,
        battlefield: {
          'rel-land': makePermanent({ name: 'Mountain', parentId: 'rel-land', controlled: true, cardTypes: ['Land'] }),
        },
      }),
      makePlayer({ playerId: SIM_PLAYER_ID, name: SIM_NAME, isActive: false, hasPriority: false }),
    ],
    myPlayerId: HUMAN_PLAYER_ID,
    myHand: {
      'rel-mountain': makeCard({ name: 'Mountain', parentId: 'rel-mountain', cardTypes: ['Land'] }),
    },
    activePlayerId: HUMAN_PLAYER_ID,
    activePlayerName: HUMAN_NAME,
    priorityPlayerName: HUMAN_NAME,
    phase: 'PRECOMBAT_MAIN',
    step: 'PRECOMBAT_MAIN',
    turn: 1,
  })
}

/** Reanudación: `joinGame` reemite el GAME_INIT, como hace el proxy al re-attach. */
function reloadScenario() {
  const view = boardView()
  return makeBaseScenario({
    tableId: TABLE_ID,
    tableName: RELOAD_TABLE,
    gameId: GAME_ID,
    gameView: view,
    onJoinGame: (conn, gameId) => {
      conn.broadcast('GAME_INIT', { gameView: view }, gameId)
    },
  })
}

/**
 * `connect` commands sent so far. Counted instead of sliced by a captured index:
 * `__sent` is the Node-side capture buffer of `start-game.ts`, which survives the
 * reload, but it is capped at MAX_FRAMES and trims from the front, so an index
 * taken before the reload can shift. A count cannot.
 */
function connectCount(page: Page): number {
  return parseSent(sentOf(page)).filter((f) => f.action === 'connect').length
}

/**
 * The reload of a real player, which no spec used to cover: a device that already
 * logged in (a stored connection + a stored active game) and never finished the setup
 * wizard. Measured 2026-10-09 on the deployed build over the Cloudflare tunnel: that
 * device state landed every reload back on the login screen with no error, because
 * `App.tsx` gated the re-login on `isSetupDone()` — and closing the wizard with the X
 * only hid it, so the flag stayed unset. The proxy log confirmed the client never
 * dialled the proxy at all, which is why the assertions below also check the `connect`
 * being attempted, not only what ends up painted.
 *
 * Every other reload spec gets here through `startGame`, whose `login()` dismisses the
 * wizard with "skip" (which does set the flag), so the gate was invisible from the
 * test suite. This spec removes it on purpose.
 */
test('recargar con sesión guardada y el asistente sin terminar reabre la partida', async ({ page }) => {
  await withFakeServer(() => reloadScenario(), async () => {
    const session = await startGame(page, {
      prefix: 'rel',
      tableName: RELOAD_TABLE,
      deck: DECK.advanced,
      skipAsks: true,
    })
    await expect(page.locator('.game-board')).toBeVisible({ timeout: 30_000 })

    // the device state of the bug: session stored, wizard never completed
    await page.evaluate(() => window.localStorage.removeItem('nexus_setup_v'))
    expect(await page.evaluate(() => window.localStorage.getItem('nexus_setup_v'))).toBeNull()
    const connectsBefore = connectCount(page)

    await page.reload({ waitUntil: 'domcontentloaded' })

    // The contract, waited on directly: the stored session comes back to its board on
    // its own and the wizard stays away. 60 s because the dev-bundle boot, the /config
    // probe and the WS handshake queue behind whatever else the CI host is running —
    // the property under test is the app's behaviour, not the runner's speed (a fixed
    // 20 s poll on a raw frame count was red in client CI run 519 when the reload
    // landed late, with the board one poll away from being painted).
    await expect(page.locator('.game-board')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByTestId('setup-wizard')).toBeHidden({ timeout: 60_000 })

    // Frame evidence, read after the contract instead of racing it: a painted board can
    // only come from a GAME_INIT that followed this session's `connect`, so this is a
    // seam assertion (no attempt at all is the bug), not a second wait on the wire.
    expect(connectCount(page), 'connect frames sent after the reload').toBeGreaterThan(connectsBefore)

    expect(session.pageErrors, `pageerrors: ${session.pageErrors.map(String).join(' | ')}`).toEqual([])
  })
})
