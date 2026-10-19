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
import type { GameView } from '../src/net/types'
import type { Page } from '@playwright/test'
import { parseSent, sentOf } from './support/frames'
import { playableInScene } from './support/scene'

fakeOnly()

const PASS_TABLE = 'pass-priority-test'

/**
 * The player's priority window, with a spell of theirs on the stack: the main
 * button offers to resolve it. XMage consumes exactly ONE answer per ask, and a
 * second one is parked by the server (HumanPlayer.waitResponseOpen) and spent
 * on the NEXT ask — which is how a double-click resolves a window the player
 * never saw. `Pass sent` is the state that says the answer is already out.
 *
 * `canPlayObjects` is part of the frame: the server sets it on every view it
 * prepares for the player who holds priority (GameSessionPlayer.prepareGameView
 * → PlayerImpl.getPlayableObjects(game, Zone.ALL), and getTurnControlledBy()
 * returns the player's own id when nobody controls their turn), and it lists
 * every card that player can legally play — a castable spell under
 * `basicCastAbilities`, a playable land under `basicPlayAbilities`
 * (PlayableObjectStats.java). Recorded proof: in fixtures/recorded/dismember.json
 * (own precombat main, priority, empty stack) all seven hand Forests appear with
 * "Play Forest". A priority frame with a playable card and no listing is a frame
 * the game does not send; without it the hand card is not marked playable and the
 * click must stay dead.
 */
function priorityView(): GameView {
  return makeGameView({
    canPlayObjects: {
      objects: {
        'pp-bolt': {
          basicManaAbilities: [],
          basicPlayAbilities: [],
          basicCastAbilities: [{ id: 'pp-bolt-cast', value: 'Cast Lightning Bolt' }],
          other: [],
        },
      },
    },
    players: [
      makePlayer({
        playerId: HUMAN_PLAYER_ID, name: HUMAN_NAME, controlled: true, isHuman: true,
        isActive: true, hasPriority: true, life: 20,
        battlefield: { 'pp-land': makePermanent({ id: 'pp-land', name: 'Mountain', cardTypes: ['LAND'], controlled: true }) },
      }),
      makePlayer({ playerId: SIM_PLAYER_ID, name: SIM_NAME, isActive: false, hasPriority: false }),
    ],
    myPlayerId: HUMAN_PLAYER_ID,
    myHand: { 'pp-bolt': makeCard({ id: 'pp-bolt', name: 'Lightning Bolt', parentId: 'pp-bolt' }) },
    activePlayerId: HUMAN_PLAYER_ID,
    activePlayerName: HUMAN_NAME,
    priorityPlayerName: HUMAN_NAME,
    phase: 'PRECOMBAT_MAIN',
    step: 'PRECOMBAT_MAIN',
    turn: 2,
    stack: { 'pp-spell': makeCard({ id: 'pp-spell', name: 'Grizzly Bears', controllerId: HUMAN_PLAYER_ID }) },
  })
}

function priorityScenario() {
  return makeBaseScenario({ tableId: TABLE_ID, tableName: PASS_TABLE, gameId: GAME_ID, gameView: priorityView() })
}

let messageId = 100
async function push(page: Page, view: GameView, method = 'GAME_SELECT') {
  await page.evaluate(
    ({ gameView, gameId, method, messageId: id }) => {
      const store = (window as unknown as { __mageStore?: { handleMessage: (m: unknown) => void } }).__mageStore
      if (!store) throw new Error('no __mageStore')
      store.handleMessage({ type: 'event', method, messageId: id, objectId: gameId, data: { gameView, message: 'Main 1: cast spells or activate abilities' } })
    },
    { gameView: view, gameId: GAME_ID, method, messageId: (messageId += 1) },
  )
}

const passes = (page: Page) =>
  parseSent(sentOf(page)).filter((f) => f.action === 'sendPlayerBoolean' && f.args?.value === false).length

test('a double-click on pass priority cannot answer a later window @gamefeel', async ({ page }) => {
  await withFakeServer(priorityScenario, async () => {
    const { pageErrors } = await startGame(page, { prefix: 'pass', tableName: PASS_TABLE, deck: DECK.advanced, skipAsks: true })
    const button = page.locator('.big-action-btn')
    await expect(button).toBeEnabled({ timeout: 15_000 })
    await expect(button).toContainText(/Resolve|Resolver/)

    const before = passes(page)
    await button.click()
    await expect.poll(() => passes(page), { timeout: 5_000 }).toBe(before + 1)

    // The impatient second click on the same window, and then two more through
    // the Space shortcut: the answer is already on the wire, so nothing further
    // may go out — the engine parks a repeat and spends it on the NEXT ask,
    // which resolves a window the player never saw.
    await button.click({ force: true })
    await page.waitForTimeout(300)
    await page.keyboard.press('Space')
    await page.waitForTimeout(300)
    await page.keyboard.press('Space')
    await expect.poll(() => passes(page), { timeout: 3_000 }).toBe(before + 1)

    // …and the button says so, instead of looking live and swallowing clicks.
    await expect(button).toBeDisabled()
    await expect(button).toContainText(/Pass sent|Prioridad cedida/)

    expect(pageErrors, `pageerrors: ${pageErrors.map(String).join(' | ')}`).toEqual([])
  })
})

test('the next priority request re-arms the pass @gamefeel', async ({ page }) => {
  await withFakeServer(priorityScenario, async () => {
    const { pageErrors } = await startGame(page, { prefix: 'pass', tableName: PASS_TABLE, deck: DECK.advanced, skipAsks: true })
    const button = page.locator('.big-action-btn')
    await expect(button).toBeEnabled({ timeout: 15_000 })

    const before = passes(page)
    await button.click()
    await expect.poll(() => passes(page), { timeout: 5_000 }).toBe(before + 1)
    await expect(button).toBeDisabled()

    // The game asks again (a fresh GAME_SELECT is a new request): passing is
    // legal once more — the guard must not wedge the player out of the game.
    await push(page, priorityView())
    await expect(button).toBeEnabled()
    await button.click()
    await expect.poll(() => passes(page), { timeout: 5_000 }).toBe(before + 2)
    await expect(button).toBeDisabled()

    expect(pageErrors, `pageerrors: ${pageErrors.map(String).join(' | ')}`).toEqual([])
  })
})

test('a hand-card play is dropped while the same window was already answered @gamefeel', async ({ page }) => {
  await withFakeServer(priorityScenario, async () => {
    const { pageErrors } = await startGame(page, { prefix: 'pass', tableName: PASS_TABLE, deck: DECK.advanced, skipAsks: true })
    const button = page.locator('.big-action-btn')
    await expect(button).toBeEnabled({ timeout: 15_000 })

    // Pass the open priority window: one answer out, the button shows it spent.
    await button.click()
    await expect(button).toBeDisabled()
    await expect(button).toContainText(/Pass sent|Prioridad cedida/)

    // The stale-marker case: the hand card still carries the
    // marker the window was opened with — but the window's answer is already out,
    // so the click must NOT send. A send here parks in the engine and plays a
    // window later: on the live capture the same uuid returned ok:true with no hand
    // change and then played during the NEXT main phase.
    const uuidSends = () => parseSent(sentOf(page)).filter((f) => f.action === 'sendPlayerUUID').length
    const before = uuidSends()
    const card = page.locator('[data-testid="hand-bar"] [data-card-id="pp-bolt"]')
    if (await card.count()) {
      await card.click({ force: true })
      await page.waitForTimeout(300)
      await expect.poll(() => uuidSends(), { timeout: 3_000 }).toBe(before)
    }

    // A fresh GAME_SELECT re-opens the request: the play may go out now — and the
    // card must be genuinely playable for it to be a legal play, i.e. the fresh
    // frame re-marks it (the marker cannot come from the previous window).
    await push(page, priorityView())
    await expect(button).toBeEnabled()
    await expect.poll(() => playableInScene(page, 'pp-bolt')).toBe(true)
    const freshBefore = uuidSends()
    await card.click({ force: true })
    await expect.poll(() => uuidSends(), { timeout: 5_000 }).toBe(freshBefore + 1)

    expect(pageErrors, `pageerrors: ${pageErrors.map(String).join(' | ')}`).toEqual([])
  })
})
