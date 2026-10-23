import { test, expect } from '@playwright/test'
import { fakeOnly } from './support/fake-mode'
import { withFakeServer } from './support/fake-backend'
import { login, createTable } from './support/start-game'
import { makeBaseScenario, makeTable, type FakeConn } from '../fixtures/fake'
import { makeGameView, makePermanent, makePlayer, playerGameView } from '../src/__fixtures__/gameViews'

fakeOnly()

const TABLE_ID = 'table-stg-1'
const TABLE_NAME = 'staging-e2e'

function stagingScenario() {
  return makeBaseScenario({
    tableId: TABLE_ID,
    tableName: TABLE_NAME,
    gameId: 'game-stg-1',
    gameView: playerGameView,
  })
}

async function createAndWaitStaging(page: import('@playwright/test').Page) {
  await login(page, 'e2e')
  await createTable(page, TABLE_NAME)
  await expect(page.getByTestId('staging-player-actions')).toBeVisible({ timeout: 15_000 })
}

test.describe('Player staging room (JOINED_TABLE)', () => {
  test('al crear la mesa salta a la sala de espera y desde ella arranca la partida', async ({ page }) => {
    await withFakeServer(stagingScenario, async () => {
      await createAndWaitStaging(page)
      await expect(page.getByTestId('staging-start')).toBeVisible()
      await expect(page.getByTestId('staging-remove')).toBeVisible()
      await expect(page.getByTestId('staging-leave')).toBeVisible()
      await page.getByTestId('staging-start').click()
      await expect(page.getByTestId('game-status')).toBeVisible({ timeout: 15_000 })
    })
  })

  test('volver al lobby conserva el asiento y permite regresar con "Ir a la mesa"', async ({ page }) => {
    await withFakeServer(stagingScenario, async () => {
      await createAndWaitStaging(page)
      await page.getByTestId('staging-back').click()
      await expect(page.getByTestId('staging-player-actions')).toBeHidden()
      await expect(page.getByTestId('return-to-table').first()).toBeVisible()
      await page.getByTestId('return-to-table').first().click()
      await expect(page.getByTestId('staging-player-actions')).toBeVisible({ timeout: 15_000 })
    })
  })

  test('el dueño puede eliminar la mesa desde la sala de espera', async ({ page }) => {
    await withFakeServer(stagingScenario, async () => {
      await createAndWaitStaging(page)
      await page.getByTestId('staging-remove').click()
      await expect(page.getByTestId('staging-player-actions')).toBeHidden({ timeout: 15_000 })
      await expect(page.getByRole('heading', { name: /Lobby|XMage Nexus/i })).toBeVisible()
    })
  })

  test('the owner can delete the table from the lobby after leaving the waiting room', async ({ page }) => {
    const removed: string[] = []
    const scenario = () => makeBaseScenario({
      tableId: TABLE_ID,
      tableName: TABLE_NAME,
      gameId: 'game-stg-1',
      gameView: playerGameView,
      onRequest: (conn, action, args, requestId) => {
        if (action !== 'removeTable') return false
        removed.push(String((args as Record<string, unknown>).tableId))
        conn.ok(requestId, action, {})
        conn.lobby([])
        return true
      },
    })
    await withFakeServer(scenario, async () => {
      await createAndWaitStaging(page)
      await page.getByTestId('staging-back').click()
      await expect(page.getByTestId('staging-player-actions')).toBeHidden()
      await page.getByTestId('btn-remove-table').click()
      await expect(page.getByTestId('confirm-modal')).toBeVisible()
      await page.getByTestId('confirm-modal-ok').click()
      await expect.poll(() => removed).toEqual([TABLE_ID])
      await expect(page.getByTestId('active-tables-bar')).toBeHidden({ timeout: 15_000 })
      await expect(page.getByTestId('btn-remove-table')).toHaveCount(0)
    })
  })

  test('permite alternar entre listo/no listo y abrir selector de cambiar baraja', async ({ page }) => {
    await withFakeServer(stagingScenario, async () => {
      await createAndWaitStaging(page)
      const toggleBtn = page.getByTestId('staging-toggle-ready')
      await expect(toggleBtn).toBeVisible()
      await expect(toggleBtn).toContainText(/No estoy listo|Not ready/i)

      await toggleBtn.click()
      await expect(toggleBtn).toContainText(/Estoy listo|ready/i)

      await page.getByTestId('staging-change-deck').click()
      await expect(page.getByTestId('join-table-dialog')).toBeVisible()
      await expect(page.getByTestId('join-table-dialog').locator('.dlg-kicker')).toContainText(/CAMBIAR BARAJA|CHANGE TABLE DECK/i)
      await page.getByTestId('join-cancel-btn').click()
      await expect(page.getByTestId('join-table-dialog')).toBeHidden()
    })
  })

  test('el dueño puede reordenar asientos con subir/bajar (swapSeats)', async ({ page }) => {
    await withFakeServer(stagingScenario, async () => {
      await createAndWaitStaging(page)
      const firstCard = page.locator('.staging-duel-roster .staging-player-card').first()
      await expect(firstCard).toContainText('e2e')

      await expect(page.getByTestId('staging-seat-up-0')).toBeDisabled()
      await page.getByTestId('staging-seat-down-0').click()
      await expect(firstCard).toContainText('sim')

      await page.getByTestId('staging-seat-up-1').click()
      await expect(firstCard).toContainText('e2e')
    })
  })

  test('empezar sin readys pide confirmación y arranca al aceptar', async ({ page }) => {
    await withFakeServer(stagingScenario, async () => {
      await createAndWaitStaging(page)
      await page.getByTestId('staging-toggle-ready').click()
      await expect(page.getByTestId('staging-toggle-ready')).toContainText(/Estoy listo|ready/i)

      await page.getByTestId('staging-start').click()
      await expect(page.getByTestId('confirm-modal')).toBeVisible({ timeout: 15_000 })
      await page.getByTestId('confirm-modal-ok').click()
      await expect(page.getByTestId('game-status')).toBeVisible({ timeout: 15_000 })
    })
  })

  test('empezar sin readys se cancela al rechazar la confirmación', async ({ page }) => {
    await withFakeServer(stagingScenario, async () => {
      await createAndWaitStaging(page)
      await page.getByTestId('staging-toggle-ready').click()

      await page.getByTestId('staging-start').click()
      await expect(page.getByTestId('confirm-modal')).toBeVisible({ timeout: 15_000 })
      await page.getByTestId('confirm-modal-cancel').click()
      await expect(page.getByTestId('staging-player-actions')).toBeVisible()
      await expect(page.getByTestId('game-status')).toBeHidden()
    })
  })

  test('la meta del asiento (badge + historial) no desborda la tarjeta del anillo', async ({ page }) => {
    const ringScenario = () =>
      makeBaseScenario({
        tableId: 'table-stg-ring',
        tableName: 'staging-ring-e2e',
        gameId: 'game-stg-ring',
        gameView: playerGameView,
        gameType: 'Commander Free For All',
        seats: [
          { playerName: 'e2e', seatIndex: 0, playerType: 'HUMAN', constructedRating: 800, history: '720 (I:15 T:8 Q:3)' },
          { playerName: 'sim-000002-340', seatIndex: 1, playerType: 'SIM', constructedRating: 800, history: '720 (I:15 T:8 Q:3)' },
        ],
      })
    await withFakeServer(ringScenario, async () => {
      await login(page, 'e2e')
      await createTable(page, 'staging-ring-e2e')
      await expect(page.locator('.staging-ring')).toBeVisible({ timeout: 15_000 })
      await expect(page.locator('.ring-seat .player-seat-meta').first()).toBeVisible()
      const overflowing = await page.evaluate(() => {
        const bad: string[] = []
        document.querySelectorAll('.ring-seat').forEach((card) => {
          const meta = card.querySelector('.player-seat-meta')
          if (meta && meta.scrollWidth > (card as HTMLElement).clientWidth + 1) {
            bad.push((card.textContent ?? '').slice(0, 40))
          }
        })
        return bad
      })
      expect(overflowing).toEqual([])
    })
  })

  test('unirse a torneo limitado sin password entra directo sin diálogo de mazo', async ({ page }) => {
    const tournamentScenario = () =>
      makeBaseScenario({
        tableId: 'table-tny-1',
        tableName: 'tourney-e2e',
        gameId: 'game-tny-1',
        gameView: playerGameView,
        gameType: 'Booster Draft',
        isTournament: true,
        seats: [
          { playerName: 'host', seatIndex: 0, playerType: 'HUMAN' },
          { playerName: '', seatIndex: 1, playerType: 'HUMAN' },
        ],
      })
    await withFakeServer(tournamentScenario, async () => {
      await login(page, 'e2e')
      await page.getByRole('button', { name: /Unirse \(Humano\)|Join \(Human\)/ }).click()
      await expect(page.getByTestId('join-table-dialog')).toBeHidden()
      await expect(page.getByTestId('staging-player-actions')).toBeVisible({ timeout: 15_000 })
    })
  })
})

/**
 * B7 (audit 2026-10-21): a spectator who starts watching while the table is
 * still staging stayed on the staging screen forever. XMage refuses a table
 * watch until the table is DUELING (`TableController.watchTable`) and
 * `SessionImpl.watchTable` returns true anyway, so the ack is a silent no-op;
 * the client only learns the match started from the lobby (the table then
 * carries a game id) and must promote the table watch to a game watch.
 *
 * The fake models exactly that: `watchTable` subscribes to nothing and the
 * frames only start once the client sends `watchGame` — so this test is red
 * unless the promotion exists.
 */
test.describe('Spectator staging (watch a table that has not started yet)', () => {
  const SPEC_GAME_ID = 'game-stg-spec-1'
  const SPEC_TABLE_ID = 'table-stg-spec-1'
  const SPEC_TABLE_NAME = 'staging-spectate-e2e'

  const spectatorBoard = makeGameView({
    turn: 1,
    step: 'UPKEEP',
    myPlayerId: null,
    activePlayerName: 'host',
    priorityPlayerName: 'host',
    players: [
      makePlayer({
        playerId: 'p1',
        name: 'host',
        battlefield: { 'bf-1': makePermanent({ name: 'Serra Angel', parentId: 'bf-1' }) },
      }),
      makePlayer({ playerId: 'p2', name: 'sim', battlefield: {} }),
    ],
  })

  /** The table while the game has not been created: `games` is empty, exactly
   *  what `TableView` publishes for a READY_TO_START table. */
  const stagingTable = () => ({
    ...makeTable({ tableId: SPEC_TABLE_ID, tableName: SPEC_TABLE_NAME, gameId: SPEC_GAME_ID }),
    games: [],
    tableState: 'READY_TO_START',
    tableStateText: 'READY_TO_START (2/2)',
  })
  const runningTable = () => ({
    ...makeTable({ tableId: SPEC_TABLE_ID, tableName: SPEC_TABLE_NAME, gameId: SPEC_GAME_ID }),
    games: [SPEC_GAME_ID],
    tableState: 'DUELING',
    tableStateText: 'DUELING',
  })

  /** Trigger for "the host pressed Start Match", armed by the watchTable ack:
   *  the test decides WHEN the table turns DUELING, so there is no timer race. */
  let startMatch: (() => void) | null = null

  function spectatorStagingScenario() {
    return makeBaseScenario({
      tableId: SPEC_TABLE_ID,
      tableName: SPEC_TABLE_NAME,
      gameId: SPEC_GAME_ID,
      gameView: spectatorBoard,
      onRequest: (conn: FakeConn, action: string, _args: unknown, requestId: string | number) => {
        if (action === 'watchTable') {
          // Real server: the watch is refused (table not DUELING) but the proxy
          // acks ok:true — no subscription, no frames.
          conn.ok(requestId, action, { tableId: SPEC_TABLE_ID })
          conn.lobby([stagingTable()])
          // The host starts the match: the lobby then carries the game id.
          startMatch = () => { if (conn.isOpen()) conn.lobby([runningTable()]) }
          return true
        }
        if (action === 'watchGame') {
          conn.ok(requestId, action, { tableId: SPEC_TABLE_ID })
          // The watcher seed is the cached turn-0 view; the real state follows
          // as a normal update (the client discards the cached INIT).
          conn.event('GAME_INIT', { gameView: makeGameView({ turn: 0, phase: null, step: null, myPlayerId: null }) }, SPEC_GAME_ID)
          conn.event('GAME_UPDATE', { gameView: spectatorBoard }, SPEC_GAME_ID)
          return true
        }
        return false
      },
    })
  }

  test('al arrancar el host, el espectador pasa del staging al tablero', async ({ page }) => {
    startMatch = null
    await withFakeServer(spectatorStagingScenario, async () => {
      await login(page, 'e2e')
      const watchBtn = page.locator('.table-card [data-testid="watch-btn"]').first()
      await expect(watchBtn).toBeVisible({ timeout: 10_000 })
      await watchBtn.click()

      // Staging screen with the real table (name + roster).
      await expect(page.getByTestId('staging-back')).toBeVisible({ timeout: 10_000 })
      await expect(page.locator('.staging-table-name')).toContainText(SPEC_TABLE_NAME)
      await expect(page.locator('.spectator-staging-screen')).toHaveCount(1)

      // The host starts: the board must replace the staging screen.
      expect(startMatch).not.toBeNull()
      startMatch!()
      await expect(page.getByTestId('arena-board')).toBeVisible({ timeout: 15_000 })
      await expect(page.getByRole('banner')).toContainText(/(Turno|Turn)\s*1/i)
      await expect(page.getByTestId('arena-board')).toContainText('Serra Angel')
      await expect(page.locator('.card-image').first()).toBeVisible()
      await expect(page.locator('.spectator-staging-screen')).toHaveCount(0)
    })
  })
})
