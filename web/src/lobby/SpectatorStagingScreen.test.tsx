import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SpectatorStagingScreen from './SpectatorStagingScreen'
import ConfirmHost from '../ui/ConfirmHost'
import { setState } from '../state/store'
import type { TableView } from '../net/types'

const { swapSeatsMock, startMatchMock, startTournamentMock } = vi.hoisted(() => ({
  swapSeatsMock: vi.fn(async (): Promise<any> => ({ ok: true })),
  startMatchMock: vi.fn(async (): Promise<any> => ({ ok: true })),
  startTournamentMock: vi.fn(async (): Promise<any> => ({ ok: true })),
}))

vi.mock('../net/commands', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../net/commands')>()),
  swapSeats: swapSeatsMock,
  startMatch: startMatchMock,
  startTournament: startTournamentMock,
}))

afterEach(() => {
  cleanup()
  swapSeatsMock.mockClear()
  startMatchMock.mockClear()
  startTournamentMock.mockClear()
  setState({ conn: null, stagingTableId: null, stagingIsTournament: false, lobby: null, phase: 'idle', chatMessages: [] })
})

vi.mock('./ChatBox', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./ChatBox')>()),
  default: () => <div data-testid="chat-box-stub">Chat Stub</div>,
}))

const MOCK_DUEL_TABLE: TableView = {
  tableId: 'table-duel-1',
  tableName: "Alice's Showdown",
  controllerName: 'Alice',
  gameType: 'Two Player Duel',
  deckType: 'Constructed - Modern',
  additionalInfoShort: '',
  additionalInfoFull: '',
  createTime: Date.now(),
  tableState: 'WAITING',
  skillLevel: 'CASUAL',
  tableStateText: 'Waiting for players',
  seatsInfo: '1/2',
  isTournament: false,
  seats: [
    { playerName: 'Alice', seatIndex: 0, playerType: 'HUMAN' },
    { playerName: '', seatIndex: 1, playerType: 'HUMAN' },
  ],
  games: [],
  quitRatio: '0%',
  minimumRating: '0',
  limited: false,
  rated: true,
  passworded: false,
  spectatorsAllowed: true,
}

const MOCK_COMMANDER_TABLE: TableView = {
  tableId: 'table-comm-1',
  tableName: 'Epic Commander Pod',
  controllerName: 'Bob',
  gameType: 'Commander Free For All',
  deckType: 'Constructed - Commander',
  additionalInfoShort: '',
  additionalInfoFull: '',
  createTime: Date.now(),
  tableState: 'READY_TO_START',
  skillLevel: 'SERIOUS',
  tableStateText: 'Ready to start',
  seatsInfo: '4/4',
  isTournament: false,
  seats: [
    { playerName: 'Bob', seatIndex: 0, playerType: 'HUMAN' },
    { playerName: 'Charlie', seatIndex: 1, playerType: 'HUMAN' },
    { playerName: 'Diana', seatIndex: 2, playerType: 'HUMAN' },
    { playerName: 'Evan', seatIndex: 3, playerType: 'HUMAN' },
  ],
  games: [],
  quitRatio: '0%',
  minimumRating: '0',
  limited: false,
  rated: false,
  passworded: true,
  spectatorsAllowed: true,
}

describe('SpectatorStagingScreen', () => {
  it('renders 1v1 duel staging with player and VS indicator', () => {
    const { getByText } = render(<SpectatorStagingScreen table={MOCK_DUEL_TABLE} />)

    expect(getByText("Alice's Showdown")).not.toBeNull()
    expect(getByText('MODO ESPECTADOR')).not.toBeNull()
    expect(getByText('Alice')).not.toBeNull()
    expect(getByText('VS')).not.toBeNull()
    expect(getByText('Esperando oponente…')).not.toBeNull()
    expect(getByText('Esperando a que se completen las plazas de la mesa…')).not.toBeNull()
  })

  it('renders multiplayer Commander pod with all 4 players and ready banner', () => {
    const { getByText } = render(<SpectatorStagingScreen table={MOCK_COMMANDER_TABLE} />)

    expect(getByText('Epic Commander Pod')).not.toBeNull()
    expect(getByText('Bob')).not.toBeNull()
    expect(getByText('Charlie')).not.toBeNull()
    expect(getByText('Diana')).not.toBeNull()
    expect(getByText('Evan')).not.toBeNull()
    expect(getByText('Privada')).not.toBeNull()
    expect(getByText('Todos los jugadores están listos. Esperando a que el anfitrión inicie la partida…')).not.toBeNull()
  })

  it('triggers onLeave when clicking Leave button', () => {
    const onLeaveSpy = vi.fn()
    const { getByText } = render(<SpectatorStagingScreen table={MOCK_DUEL_TABLE} onLeave={onLeaveSpy} />)

    const leaveBtn = getByText('Volver al Lobby')
    fireEvent.click(leaveBtn)
    expect(onLeaveSpy).toHaveBeenCalled()
  })

  it('modo jugador: muestra acciones (salir/eliminar) y gatea Empezar por dueño+ready', () => {
    setState({
      conn: { username: 'Bob' } as never,
      stagingTableId: MOCK_COMMANDER_TABLE.tableId,
      lobby: { type: 'lobby', tables: [MOCK_COMMANDER_TABLE] } as never,
    })
    const { getByTestId, getByText } = render(<SpectatorStagingScreen mode="player" />)

    expect(getByTestId('staging-player-actions')).not.toBeNull()
    expect(getByTestId('staging-start')).not.toBeNull()
    expect(getByTestId('staging-remove')).not.toBeNull()
    expect(getByTestId('staging-leave')).not.toBeNull()
    expect(getByText(/MODO JUGADOR/)).not.toBeNull()
  })

  it('modo jugador: reconoce al dueño cuando controllerName concatena jugadores con comas (formato real del servidor XMage)', () => {
    const tableWithJoinedPlayers: TableView = {
      ...MOCK_COMMANDER_TABLE,
      controllerName: 'Bob, Charlie, Diana, Evan',
    }
    setState({
      conn: { username: 'Bob' } as never,
      stagingTableId: tableWithJoinedPlayers.tableId,
      lobby: { type: 'lobby', tables: [tableWithJoinedPlayers] } as never,
    })
    const { getByTestId, getAllByTitle } = render(<SpectatorStagingScreen mode="player" />)

    expect(getByTestId('staging-start')).not.toBeNull()
    expect(getByTestId('staging-remove')).not.toBeNull()
    expect(getAllByTitle(/anfitrión/i).length).toBeGreaterThan(0)
  })

  it('modo jugador: no owner no ve Empezar ni Eliminar', () => {
    setState({
      conn: { username: 'Charlie' } as never,
      stagingTableId: MOCK_COMMANDER_TABLE.tableId,
      lobby: { type: 'lobby', tables: [MOCK_COMMANDER_TABLE] } as never,
    })
    const { queryByTestId } = render(<SpectatorStagingScreen mode="player" />)

    expect(queryByTestId('staging-player-actions')).not.toBeNull()
    expect(queryByTestId('staging-start')).toBeNull()
    expect(queryByTestId('staging-remove')).toBeNull()
    expect(queryByTestId('staging-leave')).not.toBeNull()
  })

  it('permite alternar estado de preparación (Listo / No listo) y refleja Preparándose', () => {
    setState({
      conn: { username: 'Bob' } as never,
      stagingTableId: MOCK_COMMANDER_TABLE.tableId,
      lobby: { type: 'lobby', tables: [MOCK_COMMANDER_TABLE] } as never,
    })
    const { getByTestId, getByText } = render(<SpectatorStagingScreen mode="player" />)

    const toggleBtn = getByTestId('staging-toggle-ready')
    expect(toggleBtn.textContent).toContain('No estoy listo')

    fireEvent.click(toggleBtn)
    expect(toggleBtn.textContent).toContain('Estoy listo')
    expect(getByText(/Preparándose/i)).not.toBeNull()
  })

  it('ignora marcadores de listo que no van anclados al inicio del mensaje', () => {
    setState({
      conn: { username: 'Bob' } as never,
      stagingTableId: MOCK_COMMANDER_TABLE.tableId,
      lobby: { type: 'lobby', tables: [MOCK_COMMANDER_TABLE] } as never,
      chatMessages: [
        { chatId: 'c1', username: 'Charlie', message: 'hola [NEXUS_NOT_READY] Charlie' },
      ],
    })
    const { queryByText } = render(<SpectatorStagingScreen mode="player" />)

    expect(queryByText(/Preparándose/i)).toBeNull()
  })

  it('ignora marcadores cuyo usuario embebido no coincide con el remitente (anti-spoof)', () => {
    setState({
      conn: { username: 'Bob' } as never,
      stagingTableId: MOCK_COMMANDER_TABLE.tableId,
      lobby: { type: 'lobby', tables: [MOCK_COMMANDER_TABLE] } as never,
      chatMessages: [
        { chatId: 'c1', username: 'Charlie', message: '[NEXUS_NOT_READY] Diana' },
      ],
    })
    const { queryByText } = render(<SpectatorStagingScreen mode="player" />)

    expect(queryByText(/Preparándose/i)).toBeNull()
  })

  it('acepta variantes de espacios dentro de los corchetes (como el saneador)', () => {
    setState({
      conn: { username: 'Bob' } as never,
      stagingTableId: MOCK_COMMANDER_TABLE.tableId,
      lobby: { type: 'lobby', tables: [MOCK_COMMANDER_TABLE] } as never,
      chatMessages: [
        { chatId: 'c1', username: 'Charlie', message: '[ NEXUS_NOT_READY ] Charlie' },
      ],
    })
    const { getByText } = render(<SpectatorStagingScreen mode="player" />)

    expect(getByText(/Preparándose/i)).not.toBeNull()
  })

  it('Empezar sigue habilitado sin readys pero pide confirmación (aviso, no bloqueo)', async () => {
    setState({
      conn: { username: 'Bob' } as never,
      stagingTableId: MOCK_COMMANDER_TABLE.tableId,
      lobby: { type: 'lobby', tables: [MOCK_COMMANDER_TABLE] } as never,
      chatMessages: [
        { chatId: 'c1', username: 'Charlie', message: '[NEXUS_NOT_READY] Charlie' },
      ],
    })
    const { getByTestId, findByTestId } = render(<><SpectatorStagingScreen mode="player" /><ConfirmHost /></>)

    const startBtn = getByTestId('staging-start') as HTMLButtonElement
    expect(startBtn.disabled).toBe(false)
    fireEvent.click(startBtn)
    expect(await findByTestId('confirm-modal')).not.toBeNull()
    fireEvent.click(getByTestId('confirm-modal-ok'))
    await waitFor(() => expect(startMatchMock).toHaveBeenCalledWith(MOCK_COMMANDER_TABLE.tableId))
  })

  it('cancelar la confirmación no arranca la partida', async () => {
    setState({
      conn: { username: 'Bob' } as never,
      stagingTableId: MOCK_COMMANDER_TABLE.tableId,
      lobby: { type: 'lobby', tables: [MOCK_COMMANDER_TABLE] } as never,
      chatMessages: [
        { chatId: 'c1', username: 'Charlie', message: '[NEXUS_NOT_READY] Charlie' },
      ],
    })
    const { getByTestId, findByTestId, queryByTestId } = render(<><SpectatorStagingScreen mode="player" /><ConfirmHost /></>)

    fireEvent.click(getByTestId('staging-start'))
    expect(await findByTestId('confirm-modal')).not.toBeNull()
    fireEvent.click(getByTestId('confirm-modal-cancel'))
    await waitFor(() => expect(queryByTestId('confirm-modal')).toBeNull())
    expect(startMatchMock).not.toHaveBeenCalled()
  })

  it('mesa de torneo arranca con startTournament', () => {
    const tourneyTable: TableView = { ...MOCK_COMMANDER_TABLE, isTournament: true }
    setState({
      conn: { username: 'Bob' } as never,
      stagingTableId: tourneyTable.tableId,
      stagingIsTournament: true,
      lobby: { type: 'lobby', tables: [tourneyTable] } as never,
    })
    const { getByTestId } = render(<SpectatorStagingScreen mode="player" />)

    fireEvent.click(getByTestId('staging-start'))
    expect(startTournamentMock).toHaveBeenCalledWith(tourneyTable.tableId)
    expect(startMatchMock).not.toHaveBeenCalled()
  })

  it('arranque fallido muestra el error en staging (antes: silencio)', async () => {
    startTournamentMock.mockResolvedValueOnce({ ok: false, error: 'Command failed' })
    const tourneyTable: TableView = { ...MOCK_COMMANDER_TABLE, isTournament: true }
    setState({
      conn: { username: 'Bob' } as never,
      stagingTableId: tourneyTable.tableId,
      stagingIsTournament: true,
      lobby: { type: 'lobby', tables: [tourneyTable] } as never,
    })
    const { getByTestId, findByTestId } = render(<SpectatorStagingScreen mode="player" />)

    fireEvent.click(getByTestId('staging-start'))
    expect(await findByTestId('staging-error')).not.toBeNull()
  })

  it('abre el diálogo de cambiar baraja al pulsar Cambiar baraja', () => {
    setState({
      conn: { username: 'Bob' } as never,
      stagingTableId: MOCK_COMMANDER_TABLE.tableId,
      lobby: { type: 'lobby', tables: [MOCK_COMMANDER_TABLE] } as never,
    })
    const { getByTestId, getByText } = render(<SpectatorStagingScreen mode="player" />)

    const changeDeckBtn = getByTestId('staging-change-deck')
    fireEvent.click(changeDeckBtn)

    expect(getByText(/CAMBIAR BARAJA DE LA MESA/i)).not.toBeNull()
  })

  it('dueño en READY ve botones de orden por asiento con bordes deshabilitados', () => {
    setState({
      conn: { username: 'Bob' } as never,
      stagingTableId: MOCK_COMMANDER_TABLE.tableId,
      lobby: { type: 'lobby', tables: [MOCK_COMMANDER_TABLE] } as never,
    })
    const { getByTestId } = render(<SpectatorStagingScreen mode="player" />)

    expect((getByTestId('staging-seat-up-0') as HTMLButtonElement).disabled).toBe(true)
    expect((getByTestId('staging-seat-down-0') as HTMLButtonElement).disabled).toBe(false)
    expect((getByTestId('staging-seat-up-3') as HTMLButtonElement).disabled).toBe(false)
    expect((getByTestId('staging-seat-down-3') as HTMLButtonElement).disabled).toBe(true)
  })

  it('pulsar bajar en el asiento 0 llama a swapSeats con (0, 1)', () => {
    setState({
      conn: { username: 'Bob' } as never,
      stagingTableId: MOCK_COMMANDER_TABLE.tableId,
      lobby: { type: 'lobby', tables: [MOCK_COMMANDER_TABLE] } as never,
    })
    const { getByTestId } = render(<SpectatorStagingScreen mode="player" />)

    fireEvent.click(getByTestId('staging-seat-down-0'))
    expect(swapSeatsMock).toHaveBeenCalledWith(MOCK_COMMANDER_TABLE.tableId, 0, 1)
  })

  it('arrastrar el asiento 3 sobre el 0 llama a swapSeats con (3, 0)', () => {
    setState({
      conn: { username: 'Bob' } as never,
      stagingTableId: MOCK_COMMANDER_TABLE.tableId,
      lobby: { type: 'lobby', tables: [MOCK_COMMANDER_TABLE] } as never,
    })
    const { container } = render(<SpectatorStagingScreen mode="player" />)

    const store: Record<string, string> = {}
    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      setData: (k: string, v: string) => { store[k] = v },
      getData: (k: string) => store[k] ?? '',
    }
    const occupied = container.querySelectorAll('.ring-seat.occupied')
    expect(occupied.length).toBe(4)
    fireEvent.dragStart(occupied[3], { dataTransfer } as never)
    fireEvent.dragOver(occupied[0], { dataTransfer } as never)
    expect(occupied[0].className).toContain('seat-drop-target')
    fireEvent.drop(occupied[0], { dataTransfer } as never)
    expect(swapSeatsMock).toHaveBeenCalledWith(MOCK_COMMANDER_TABLE.tableId, 3, 0)
  })

  it('no dueño no ve botones de orden', () => {
    setState({
      conn: { username: 'Charlie' } as never,
      stagingTableId: MOCK_COMMANDER_TABLE.tableId,
      lobby: { type: 'lobby', tables: [MOCK_COMMANDER_TABLE] } as never,
    })
    const { queryByTestId } = render(<SpectatorStagingScreen mode="player" />)

    expect(queryByTestId('staging-seat-up-0')).toBeNull()
    expect(queryByTestId('staging-seat-down-0')).toBeNull()
  })

  it('dueño en WAITING ve botones de orden deshabilitados con aviso (no ocultos)', () => {
    setState({
      conn: { username: 'Alice' } as never,
      stagingTableId: MOCK_DUEL_TABLE.tableId,
      lobby: { type: 'lobby', tables: [MOCK_DUEL_TABLE] } as never,
    })
    const { getByTestId } = render(<SpectatorStagingScreen mode="player" />)

    const up = getByTestId('staging-seat-up-0') as HTMLButtonElement
    expect(up.disabled).toBe(true)
    expect(up.title).toMatch(/completa/i)
  })

  it('anima solo la plaza que acaba de ocuparse, no las que ya estaban', () => {
    const { container, rerender } = render(<SpectatorStagingScreen table={MOCK_DUEL_TABLE} />)
    expect(container.querySelectorAll('.seat-just-joined').length).toBe(0)

    const withJoiner: TableView = {
      ...MOCK_DUEL_TABLE,
      seats: [MOCK_DUEL_TABLE.seats[0], { playerName: 'Zoe', seatIndex: 1, playerType: 'HUMAN' }],
    }
    rerender(<SpectatorStagingScreen table={withJoiner} />)

    const joined = container.querySelectorAll('.seat-just-joined')
    expect(joined.length).toBe(1)
    expect(joined[0].textContent).toContain('Zoe')
  })

  it('no anima las plazas ya ocupadas al montar la sala', () => {
    const { container } = render(<SpectatorStagingScreen table={MOCK_COMMANDER_TABLE} />)
    expect(container.querySelectorAll('.seat-just-joined').length).toBe(0)
  })

  it('muestra rating, historial y bandera de cada asiento ocupado', () => {
    const richTable: TableView = {
      ...MOCK_COMMANDER_TABLE,
      seats: [
        { playerName: 'Bob', seatIndex: 0, playerType: 'HUMAN', flagName: 'es', constructedRating: 1720, history: '12-3' },
        ...MOCK_COMMANDER_TABLE.seats.slice(1),
      ],
    }
    setState({
      conn: { username: 'Zed' } as never,
      stagingTableId: richTable.tableId,
      lobby: { type: 'lobby', tables: [richTable] } as never,
    })
    const { container, getByText } = render(<SpectatorStagingScreen mode="player" />)

    expect(getByText('(1720)')).not.toBeNull()
    expect(getByText('12-3')).not.toBeNull()
    expect(container.querySelector('img[alt="ES"]')).not.toBeNull()
  })

  it('mesa limited muestra el rating limited', () => {
    const limitedTable: TableView = {
      ...MOCK_COMMANDER_TABLE,
      limited: true,
      seats: [
        { playerName: 'Bob', seatIndex: 0, playerType: 'HUMAN', constructedRating: 1600, limitedRating: 1480 },
        ...MOCK_COMMANDER_TABLE.seats.slice(1),
      ],
    }
    setState({
      conn: { username: 'Zed' } as never,
      stagingTableId: limitedTable.tableId,
      lobby: { type: 'lobby', tables: [limitedTable] } as never,
    })
    const { getByText, queryByText } = render(<SpectatorStagingScreen mode="player" />)

    expect(getByText('(1480)')).not.toBeNull()
    expect(queryByText('(1600)')).toBeNull()
  })
})

// The timers that end the swap/join highlights only ever clear local state, so they must not fire
// into a root that is already gone. In CI vitest tears jsdom down while they are still armed and the
// late dispatch dies in react-dom's `resolveUpdatePriority` (`window.event`) as an uncaught
// `ReferenceError` that reds the whole run although every assertion passed. These tests reproduce
// that exact state: unmount first, drop the global so any dispatch would throw, then let the timer
// run. Green therefore means "nothing was dispatched", not "the error was swallowed".
describe('SpectatorStagingScreen: nada se despacha después del desmontaje', () => {
  const withoutWindow = (run: () => void) => {
    const saved = globalThis.window
    delete (globalThis as { window?: Window }).window
    try {
      expect(run).not.toThrow()
    } finally {
      Object.defineProperty(globalThis, 'window', { configurable: true, enumerable: true, writable: true, value: saved })
    }
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  it('no despacha el resaltado del intercambio si se desmonta antes de los 700 ms', async () => {
    vi.useFakeTimers()
    setState({
      conn: { username: 'Bob' } as never,
      stagingTableId: MOCK_COMMANDER_TABLE.tableId,
      lobby: { type: 'lobby', tables: [MOCK_COMMANDER_TABLE] } as never,
    })
    const view = render(<SpectatorStagingScreen mode="player" />)

    fireEvent.click(view.getByTestId('staging-seat-down-0'))
    // swapSeats resolves in a microtask; flush it so the 700 ms timer is really armed.
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(view.container.querySelectorAll('.seat-just-moved').length, 'el intercambio debe haber resaltado dos plazas').toBe(2)
    expect(vi.getTimerCount(), 'el resaltado debe dejar un temporizador armado').toBe(1)

    view.unmount()
    withoutWindow(() => vi.advanceTimersByTime(700))
    expect(vi.getTimerCount(), 'el desmontaje debe cancelarlo').toBe(0)
  })

  it('no despacha el resaltado de una plaza ocupada si se desmonta antes de los 1400 ms', () => {
    vi.useFakeTimers()
    const view = render(<SpectatorStagingScreen table={MOCK_DUEL_TABLE} />)
    const withJoiner: TableView = {
      ...MOCK_DUEL_TABLE,
      seats: [MOCK_DUEL_TABLE.seats[0], { playerName: 'Zoe', seatIndex: 1, playerType: 'HUMAN' }],
    }
    view.rerender(<SpectatorStagingScreen table={withJoiner} />)
    expect(view.container.querySelectorAll('.seat-just-joined').length, 'la plaza nueva debe estar resaltada').toBe(1)
    expect(vi.getTimerCount(), 'la animación de entrada debe dejar un temporizador armado').toBe(1)

    view.unmount()
    withoutWindow(() => vi.advanceTimersByTime(1400))
    expect(vi.getTimerCount(), 'el desmontaje debe cancelarlo').toBe(0)
  })

  it('no arma el resaltado si el intercambio resuelve con la pantalla ya desmontada', async () => {
    vi.useFakeTimers()
    let resolveSwap: (v: { ok: boolean }) => void = () => {}
    swapSeatsMock.mockImplementationOnce(() => new Promise((res) => { resolveSwap = res }))
    setState({
      conn: { username: 'Bob' } as never,
      stagingTableId: MOCK_COMMANDER_TABLE.tableId,
      lobby: { type: 'lobby', tables: [MOCK_COMMANDER_TABLE] } as never,
    })
    const view = render(<SpectatorStagingScreen mode="player" />)

    fireEvent.click(view.getByTestId('staging-seat-down-0'))
    await act(async () => { await Promise.resolve() })
    view.unmount()

    // The continuation runs on the promise queue; a mounted-guard makes it a no-op, so the late
    // success neither sets state nor arms the 700 ms timer on a dead root.
    await act(async () => { resolveSwap({ ok: true }); await Promise.resolve(); await Promise.resolve() })
    withoutWindow(() => vi.advanceTimersByTime(700))
    expect(vi.getTimerCount()).toBe(0)
  })
})
