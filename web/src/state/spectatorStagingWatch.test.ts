import { beforeEach, describe, expect, it, vi } from 'vitest'
import { watchGame } from '../net/commands'
import { makeGameView } from '../__fixtures__/gameViews'
import { getState } from './state'
import { handleMessage, reset, setWatchingTable } from './store'
import type { TableView } from '../net/types'

vi.mock('../net/commands', () => ({
  setGateway: vi.fn(),
  getGateway: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  getGameTypes: vi.fn(),
  getPlayerTypes: vi.fn(),
  getDeckTypes: vi.fn(),
  getRoomChatId: vi.fn(),
  getGameChatId: vi.fn().mockResolvedValue(undefined),
  getTableChatId: vi.fn().mockResolvedValue(undefined),
  getTournamentChatId: vi.fn().mockResolvedValue(undefined),
  joinChat: vi.fn(),
  leaveChat: vi.fn(),
  sendChatMessage: vi.fn(),
  createTable: vi.fn(),
  joinTable: vi.fn(),
  startMatch: vi.fn(),
  watchTable: vi.fn(),
  watchGame: vi.fn(),
  joinGame: vi.fn(),
  stopWatching: vi.fn(),
  leaveTable: vi.fn(),
  removeTable: vi.fn(),
  submitDeck: vi.fn().mockResolvedValue({ ok: true }),
  updateDeck: vi.fn(),
  updatePreferences: vi.fn().mockResolvedValue({ ok: true }),
  quitMatch: vi.fn(),
  sendPlayerAction: vi.fn(),
  sendPlayerBoolean: vi.fn(),
  sendPlayerInteger: vi.fn(),
  sendPlayerString: vi.fn(),
  sendPlayerUUID: vi.fn(),
  sendManaPaymentMode: vi.fn(),
  updateManaConfirmPreference: vi.fn(),
}))

const TABLE_ID = 't-stg'

/** The watched table as `TableView` publishes it: the seat roster is always
 *  there; `games` only appears once the match has actually created a game. */
function table(over: Partial<TableView> = {}): TableView {
  return {
    tableId: TABLE_ID,
    gameType: 'Two Player Duel',
    deckType: 'Limited',
    tableName: 'staging-watch',
    controllerName: 'host',
    additionalInfoShort: '2/2',
    additionalInfoFull: '',
    createTime: 1,
    tableState: 'READY_TO_START',
    skillLevel: 'CASUAL',
    tableStateText: 'READY_TO_START (2/2)',
    seatsInfo: '2/2',
    isTournament: false,
    seats: [
      { playerName: 'host', seatIndex: 0, playerType: 'HUMAN' },
      { playerName: 'sim', seatIndex: 1, playerType: 'SIM' },
    ],
    games: [],
    quitRatio: '100',
    minimumRating: '0',
    limited: true,
    rated: false,
    passworded: false,
    spectatorsAllowed: true,
    ...over,
  }
}

const lobby = (tables: TableView[]) => ({
  type: 'lobby',
  roomId: 'room-1',
  tables,
  users: { usersView: [] },
  serverMessages: [],
}) as never

const frame = (method: string, messageId: number, objectId: string, data: unknown) => ({
  type: 'event',
  method,
  messageId,
  objectId,
  data,
}) as never

describe('a spectator who starts watching during staging', () => {
  beforeEach(() => {
    reset()
    vi.clearAllMocks()
  })

  it('promotes the table watch to a game watch when the lobby reports the started match, and the board takes over', () => {
    setWatchingTable(table())
    expect(getState().phase).toBe('spectating_pending')
    expect(getState().watchingTable?.tableId).toBe(TABLE_ID)

    // Host has not pressed Start Match yet: the table carries no game, so there
    // is nothing to subscribe to and the staging screen stays put.
    handleMessage(lobby([table()]))
    expect(watchGame).not.toHaveBeenCalled()
    expect(getState().phase).toBe('spectating_pending')
    expect(getState().watchingTable?.tableId).toBe(TABLE_ID)

    // Host starts: the table turns DUELING and publishes the new game id. XMage
    // refused the staging-time table watch (TableController.watchTable only
    // accepts DUELING) and SessionImpl.watchTable swallowed that false, so this
    // lobby update is the first and only signal that the game exists.
    handleMessage(lobby([table({ tableState: 'DUELING', games: ['g-start'] })]))
    expect(watchGame).toHaveBeenCalledWith('g-start')
    expect(getState().gameId).toBe('g-start')
    expect(getState().phase).toBe('spectating_pending')
    // The table is kept while the first frame is in flight: the staging screen
    // must not fall back to "Preparing to start…" with 0 seats.
    expect(getState().watchingTable?.tableId).toBe(TABLE_ID)

    // The watcher seed is the cached turn-0 view: discarded (unchanged policy).
    handleMessage(frame('GAME_INIT', 1, 'g-start', makeGameView({ turn: 0, phase: null, step: null })))
    expect(getState().game).toBeNull()
    expect(getState().phase).toBe('spectating_pending')

    // First live frame: the board replaces the staging screen.
    const live = makeGameView({ turn: 1, step: 'UPKEEP' })
    handleMessage(frame('GAME_UPDATE', 2, 'g-start', live))
    expect(getState().phase).toBe('game')
    expect(getState().game?.turn).toBe(1)
  })

  it('does not re-subscribe to the game it is already watching', () => {
    setWatchingTable(table())
    handleMessage(lobby([table({ tableState: 'DUELING', games: ['g-start'] })]))
    expect(watchGame).toHaveBeenCalledTimes(1)

    handleMessage(lobby([table({ tableState: 'DUELING', games: ['g-start'] })]))
    handleMessage(lobby([table({ tableState: 'DUELING', games: ['g-start'] })]))
    expect(watchGame).toHaveBeenCalledTimes(1)
  })

  it('does not jump into a finished game of the same table while it is staging again', () => {
    // Bo3: after game 1 the table is back to READY_TO_START but TableView still
    // lists the match's games. Only a DUELING table has a watchable game.
    setWatchingTable(table({ tableState: 'READY_TO_START', games: ['g-finished'] }))
    handleMessage(lobby([table({ tableState: 'READY_TO_START', games: ['g-finished'] })]))
    expect(watchGame).not.toHaveBeenCalled()
    expect(getState().gameId).toBeNull()
    expect(getState().phase).toBe('spectating_pending')
  })

  it('picks the newest game when the match already lists more than one', () => {
    // Bo3 in progress elsewhere: `games` grows per game, so the watch must land
    // on the last one, not on the game that started the match.
    setWatchingTable(table())
    handleMessage(lobby([table({ tableState: 'DUELING', games: ['g-1', 'g-2'] })]))
    expect(watchGame).toHaveBeenCalledWith('g-2')
    expect(getState().gameId).toBe('g-2')

    const live = makeGameView({ turn: 2 })
    handleMessage(frame('GAME_INIT', 1, 'g-2', live))
    expect(getState().phase).toBe('game')
    expect(getState().game?.turn).toBe(2)
  })
})

describe('the late-watch path (spectator joins a running game)', () => {
  beforeEach(() => {
    reset()
    vi.clearAllMocks()
  })

  it('keeps flipping to the board on the first real frame after the cached turn-0 init', () => {
    setWatchingTable(table({ tableState: 'DUELING', games: ['g-live'] }))
    // WATCHGAME from the server for the already-running game.
    handleMessage(frame('WATCHGAME', 1, 'g-live', { tableId: TABLE_ID }))
    expect(getState().phase).toBe('spectating_pending')
    expect(watchGame).toHaveBeenCalledWith('g-live')
    expect(getState().watchingTable?.tableId).toBe(TABLE_ID)

    handleMessage(frame('GAME_INIT', 2, 'g-live', makeGameView({ turn: 0, phase: null, step: null })))
    expect(getState().game).toBeNull()

    const live = makeGameView({ turn: 4, step: 'DECLARE_ATTACKERS' })
    handleMessage(frame('GAME_UPDATE', 3, 'g-live', live))
    expect(getState().phase).toBe('game')
    expect(getState().game?.turn).toBe(4)
  })
})
