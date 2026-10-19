import { render, fireEvent, screen, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GameMenu from './GameMenu'
import ConfirmHost from '../ui/ConfirmHost'
import { reset } from '../state/store'
import { setState } from '../state/state'
import { setLanguage } from '../i18n'
import { makeGameView, makePlayer } from '../__fixtures__/gameViews'
import { Gateway } from '../net/Gateway'
import { setGateway } from '../net/commands'
import { attachGateway } from '../state/gateway'
import type { TableView } from '../net/types'

/** WebSocket simulado (patrón Gateway.test.ts): los envíos de la acción Leave
 *  (stopWatching/leaveTable) caen aquí como frames reales del transporte. */
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

describe('GameMenu — Leave de un espectador (transporte falso)', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
    setLanguage('es')
    reset()
    const g = new Gateway()
    attachGateway(g)
    setGateway(g)
    void g.connect('ws://proxy.test:8787')
    FakeWebSocket.instances[FakeWebSocket.instances.length - 1].triggerOpen()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    setGateway(null)
  })

  function renderMenu() {
    return render(
      <>
        <GameMenu />
        <ConfirmHost />
      </>,
    )
  }

  it('Leave (espectador, watchingTable + gameId): confirm Sí → stopWatching + leaveTable en el wire y lobby montado', async () => {
    setState({
      phase: 'game',
      gameId: 'game-live-1',
      game: spectatorView(),
      watchingTable: makeTable({ tableId: 'table-live-1', games: ['game-live-1'] }),
    })
    const { container } = renderMenu()

    fireEvent.click(container.querySelector('[data-testid="game-menu-btn"]')!)
    fireEvent.click(container.querySelector('.leave-match-btn')!)
    // el confirm del espectador («Stop spectating…») está en pantalla
    expect(screen.getByTestId('confirm-modal')).not.toBeNull()
    fireEvent.click(screen.getByTestId('confirm-modal-ok'))
    await screen.findByTestId('confirm-modal', {}, { timeout: 1 }).catch(() => {})

    const actions = sentActions(FakeWebSocket.instances[0]).map((f) => f.action)
    expect(actions).toContain('stopWatching')
    expect(sentActions(FakeWebSocket.instances[0]).find((f) => f.action === 'stopWatching')?.args).toMatchObject({ gameId: 'game-live-1' })
    expect(actions).toContain('leaveTable')
    expect(sentActions(FakeWebSocket.instances[0]).find((f) => f.action === 'leaveTable')?.args).toMatchObject({ tableId: 'table-live-1' })
    expect(actions).not.toContain('quitMatch')
  })

  it('Leave (espectador): confirm No/cancelar no envía nada', async () => {
    setState({
      phase: 'game',
      gameId: 'game-live-2',
      game: spectatorView(),
      watchingTable: makeTable({ tableId: 'table-live-2' }),
    })
    const { container } = renderMenu()

    fireEvent.click(container.querySelector('[data-testid="game-menu-btn"]')!)
    fireEvent.click(container.querySelector('.leave-match-btn')!)
    expect(screen.getByTestId('confirm-modal')).not.toBeNull()
    fireEvent.click(screen.getByTestId('confirm-modal-cancel'))
    await new Promise((r) => setTimeout(r, 0))

    expect(FakeWebSocket.instances[0].sent).toEqual([])
    // permanece en la partida
    expect(screen.queryByTestId('confirm-modal')).toBeNull()
  })
})