import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Gateway } from '../net/Gateway'
import { setGateway } from '../net/commands'
import { attachGateway } from './gateway'
import { makeGameView, makePlayer } from '../__fixtures__/gameViews'
import { getState, setState } from './state'
import { returnToLobby, reset } from './store'
import type { TableView } from '../net/types'

vi.mock('./persistence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./persistence')>()
  return {
    ...actual,
    saveSmartStops: vi.fn(),
  }
})

/** WebSocket simulado (patrón Gateway.test.ts): estáticos de readyState y
 *  helpers para disparar onopen; los frames salientes quedan en `sent`. */
class FakeWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances: FakeWebSocket[] = []

  readonly url: string
  readyState = FakeWebSocket.CONNECTING
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onclose: ((ev: { reason?: string; code?: number }) => void) | null = null
  onerror: (() => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED
  }

  triggerOpen() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }
}

function sentActions(ws: FakeWebSocket): Array<{ action: string; args: Record<string, unknown> }> {
  return ws.sent.map((m) => JSON.parse(m) as { action: string; args: Record<string, unknown> })
}

/** Gateway real sobre el socket falso: los `cmds.*` de returnToLobby escriben
 *  frames de verdad en el transporte (sin mocking de commands). */
function attachFakeTransport(): FakeWebSocket {
  const g = new Gateway()
  attachGateway(g)
  setGateway(g)
  void g.connect('ws://proxy.test:8787')
  const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
  ws.triggerOpen()
  return ws
}

const spectatorView = () =>
  makeGameView({
    players: [
      makePlayer({ playerId: 'p1', name: 'Alice', controlled: false, isHuman: true }),
      makePlayer({ playerId: 'p2', name: 'Bob', controlled: false, isHuman: true }),
    ],
  })

function makeTable(partial: Omit<Partial<TableView>, 'tableId'> & { tableId: string }): TableView {
  return {
    gameType: 'Two Player Duel',
    deckType: 'Constructed',
    tableName: 'Mesa test',
    controllerName: 'Alice',
    additionalInfoShort: '',
    additionalInfoFull: '',
    createTime: Date.now(),
    tableState: 'DUELING',
    skillLevel: 'CASUAL',
    tableStateText: 'DUELING',
    seatsInfo: '2/2',
    isTournament: false,
    seats: [],
    games: [],
    quitRatio: '0%',
    minimumRating: '0',
    limited: false,
    rated: false,
    passworded: false,
    spectatorsAllowed: true,
    ...partial,
  }
}

describe('returnToLobby — espectador de una partida en marcha', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
    reset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    setGateway(null)
    vi.restoreAllMocks()
  })

  it('watchingTable set + gameId set + sin asiento controlado: Leave envía stopWatching + leaveTable y monta el lobby', () => {
    const ws = attachFakeTransport()
    setState({
      phase: 'game',
      gameId: 'game-run-1',
      game: spectatorView(),
      watchingTable: makeTable({ tableId: 'table-run-1', games: ['game-run-1'] }),
      gameChatId: 'chat-game-1',
    })

    returnToLobby()

    const actions = sentActions(ws).map((f) => f.action)
    expect(actions).toContain('stopWatching')
    expect(actions).toContain('leaveTable')
    expect(sentActions(ws).find((f) => f.action === 'stopWatching')?.args).toMatchObject({ gameId: 'game-run-1' })
    expect(sentActions(ws).find((f) => f.action === 'leaveTable')?.args).toMatchObject({ tableId: 'table-run-1' })
    expect(actions).not.toContain('quitMatch')
    expect(getState().phase).toBe('lobby')
    expect(getState().gameId).toBeNull()
    expect(getState().game).toBeNull()
    expect(getState().watchingTable).toBeNull()
  })

  it('gameId ausente (la forma inerte observada): el id vigente sale de la mesa espectada y los mismos envíos ocurren', () => {
    const ws = attachFakeTransport()
    setState({
      phase: 'game',
      gameId: null,
      game: spectatorView(),
      watchingTable: makeTable({ tableId: 'table-run-2', games: ['game-old', 'game-current'] }),
    })

    returnToLobby()

    const actions = sentActions(ws).map((f) => f.action)
    expect(actions).toContain('stopWatching')
    expect(sentActions(ws).find((f) => f.action === 'stopWatching')?.args).toMatchObject({ gameId: 'game-current' })
    expect(actions).toContain('leaveTable')
    expect(sentActions(ws).find((f) => f.action === 'leaveTable')?.args).toMatchObject({ tableId: 'table-run-2' })
    expect(getState().phase).toBe('lobby')
    expect(getState().game).toBeNull()
  })

  it('la forma ambigua (vista sin id, sin mesa espectada ni encolada) NO es un no-op silencioso: deja rastro en el log', () => {
    const ws = attachFakeTransport()
    setState({
      phase: 'game',
      gameId: null,
      game: spectatorView(),
      watchingTable: null,
      stagingTableId: null,
    })

    returnToLobby()

    const logged = getState().log.some((e) => e.from === 'error' && e.text.includes('spectator leave'))
    expect(logged).toBe(true)
    expect(getState().phase).toBe('lobby')
    expect(sentActions(ws).find((f) => f.action === 'stopWatching')).toBeUndefined()
  })

  it('jugador con asiento controlado + gameId: quitMatch y sin stopWatching (el camino previo se conserva)', () => {
    const ws = attachFakeTransport()
    setState({
      phase: 'game',
      gameId: 'game-mine-1',
      game: makeGameView({
        players: [makePlayer({ playerId: 'me-1', name: 'Me', controlled: true })],
      }),
    })

    returnToLobby()

    const actions = sentActions(ws).map((f) => f.action)
    expect(actions).toContain('quitMatch')
    expect(sentActions(ws).find((f) => f.action === 'quitMatch')?.args).toMatchObject({ gameId: 'game-mine-1' })
    expect(actions).not.toContain('stopWatching')
    expect(getState().phase).toBe('lobby')
  })
})