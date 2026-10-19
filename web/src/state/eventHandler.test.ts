import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { handleMessage } from './eventHandler'
import { questionLogLine } from './events/prompts'
import { getState, setState } from './state'
import { clearSeatKeys, setSeatKey } from '../lobby/CreateTable/llmSeatKeys'

vi.mock('../net/commands', () => ({
  joinGame: vi.fn().mockResolvedValue(null),
  getGameChatId: vi.fn().mockResolvedValue(null),
  joinChat: vi.fn().mockResolvedValue(null),
  leaveChat: vi.fn().mockResolvedValue(null),
  stopWatching: vi.fn().mockResolvedValue(null),
  quitMatch: vi.fn().mockResolvedValue(null),
  leaveTable: vi.fn().mockResolvedValue(null),
  removeTable: vi.fn().mockResolvedValue(null),
  startMatch: vi.fn().mockResolvedValue(null),
  sendPlayerAction: vi.fn().mockResolvedValue(null),
  llmDecision: vi.fn().mockResolvedValue(null),
  llmError: vi.fn().mockResolvedValue(null),
}))

import { llmDecision, llmError } from '../net/commands'

beforeEach(() => {
  setState({ userRequest: null, viewer: null, error: null, game: null, gameId: null })
})

describe('eventHandler — callbacks críticos', () => {
  it('parsea USER_REQUEST_DIALOG en userRequest con sus botones', () => {
    handleMessage({
      type: 'event',
      method: 'USER_REQUEST_DIALOG',
      objectId: 'g1',
      data: {
        title: 'Confirmar acción',
        message: '¿Qué quieres hacer?',
        button1Text: 'Rebobinar turno',
        button1Action: 'ROLLBACK_TURN',
        button2Text: 'Detener al final del turno',
        button2Action: 'STOP_UNTIL_END_OF_TURN',
        gameId: 'g1',
      },
    } as never)
    const req = getState().userRequest
    expect(req).not.toBeNull()
    expect(req?.gameId).toBe('g1')
    expect(req?.buttons).toHaveLength(2)
    expect(req?.buttons[0]).toEqual({ text: 'Rebobinar turno', action: 'ROLLBACK_TURN' })
  })

  it('propaga relatedUserId del USER_REQUEST_DIALOG (permiso de mano)', () => {
    handleMessage({
      type: 'event',
      method: 'USER_REQUEST_DIALOG',
      objectId: 'g1',
      data: {
        title: 'User request',
        message: 'Allow user X to see your hand cards?',
        relatedUserId: '123e4567-e89b-12d3-a456-426614174000',
        button1Text: 'Accept',
        button1Action: 'ADD_PERMISSION_TO_SEE_HAND_CARDS',
        button2Text: 'Reject',
        button2Action: 'DENY_PERMISSION_TO_SEE_HAND_CARDS',
        gameId: 'g1',
      },
    } as never)
    const req = getState().userRequest
    expect(req?.relatedUserId).toBe('123e4567-e89b-12d3-a456-426614174000')
    expect(req?.buttons[0]).toEqual({ text: 'Accept', action: 'ADD_PERMISSION_TO_SEE_HAND_CARDS' })
  })

  it('registra GAME_ERROR en el estado de error', () => {
    handleMessage({ type: 'event', method: 'GAME_ERROR', objectId: 'g1', data: { message: 'Mana pool vacío' } } as never)
    expect(getState().error).toBe('Mana pool vacío')
  })

  it('questionLogLine no duplica el "?" si el signo queda tras etiquetas HTML del servidor', () => {
    expect(questionLogLine('You still have mana in your mana pool and it will be lost. Pass anyway?')).toBe(
      'You still have mana in your mana pool and it will be lost. Pass anyway?'
    )
    expect(questionLogLine('Pass anyway?<font color="#ffaa00"></font>')).toBe('Pass anyway?<font color="#ffaa00"></font>')
    expect(questionLogLine('Elige objetivo')).toBe('¿Elige objetivo?')
    expect(questionLogLine('Elige objetivo.')).toBe('Elige objetivo.')
  })

  it('JOINED_TABLE abre la sala de espera (staging) con la mesa del payload real', () => {
    setState({ phase: 'lobby' })
    handleMessage({
      type: 'event',
      method: 'JOINED_TABLE',
      objectId: null,
      data: { roomId: 'room-1', currentTableId: 'table-9', parentTableId: null, flag: false },
    } as never)
    expect(getState().phase).toBe('staging')
    expect(getState().stagingTableId).toBe('table-9')
    expect(getState().stagingIsTournament).toBe(false)
  })

  it('JOINED_TABLE propaga el flag de torneo al staging', () => {
    setState({ phase: 'lobby' })
    handleMessage({
      type: 'event',
      method: 'JOINED_TABLE',
      objectId: null,
      data: { roomId: 'room-1', currentTableId: 'table-t', parentTableId: null, flag: true },
    } as never)
    expect(getState().phase).toBe('staging')
    expect(getState().stagingTableId).toBe('table-t')
    expect(getState().stagingIsTournament).toBe(true)
  })

  it('JOINED_TABLE no interrumpe una partida en curso', () => {
    setState({ phase: 'game', gameId: 'g1', stagingTableId: null })
    handleMessage({
      type: 'event',
      method: 'JOINED_TABLE',
      objectId: null,
      data: { roomId: 'room-1', currentTableId: 'table-9', flag: false },
    } as never)
    expect(getState().phase).toBe('game')
    expect(getState().stagingTableId).toBeNull()
  })

  it('START_GAME limpia el staging al entrar en la partida', () => {
    setState({ phase: 'staging', stagingTableId: 'table-9' })
    handleMessage({ type: 'event', method: 'START_GAME', objectId: null, data: { gameId: 'g2', tableName: 'T' } } as never)
    expect(getState().phase).toBe('game')
    expect(getState().stagingTableId).toBeNull()
  })

  it('abre el visor con el sideboard del jugador desde el GameView', () => {
    setState({
      game: {
        players: [{ playerId: 'p1', sideboard: { 'c1': { id: 'c1', name: 'Forest' } } }],
      } as never,
    })
    handleMessage({ type: 'event', method: 'VIEW_SIDEBOARD', objectId: 'g1', data: { gameId: 'g1', playerId: 'p1' } } as never)
    expect(getState().viewer?.title).toBe('Sideboard')
    expect(getState().viewer?.cards).toHaveLength(1)
  })

  it('abre el visor de mazo limitado con las cartas del deck', () => {
    handleMessage({
      type: 'event',
      method: 'VIEW_LIMITED_DECK',
      objectId: 'g1',
      data: { deck: { cards: { 'c1': { id: 'c1', name: 'Island' } } } },
    } as never)
    expect(getState().viewer?.title).toBe('Mis Mazos')
    expect(getState().viewer?.cards).toHaveLength(1)
  })
})

describe('eventHandler — llm_prompt (client-key bridge)', () => {
  const frame = (over: Record<string, unknown> = {}) => ({
    type: 'llm_prompt',
    requestId: '11111111-1111-4111-8111-111111111111',
    seatId: 'seat-1',
    gameId: 'g1',
    playerName: 'LLM Seat',
    requestBody: '{}',
    apiEndpoint: 'https://api.openai.com/v1/chat/completions',
    stream: false,
    timeoutSeconds: 600,
    clientKeyTag: 'tag-1',
    ...over,
  })

  beforeEach(() => {
    vi.mocked(llmDecision).mockClear()
    vi.mocked(llmError).mockClear()
    setState({ capabilities: { llm: true } as never, log: [] })
    setSeatKey('tag-1', 'XXXXXX-not-a-real-key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, text: () => Promise.resolve('{}') }))
  })

  afterEach(() => {
    clearSeatKeys()
    vi.unstubAllGlobals()
  })

  it('without capabilities.llm it drops the frame, logs, and never bridges', () => {
    setState({ capabilities: null })
    handleMessage(frame() as never)
    expect(vi.mocked(llmError)).not.toHaveBeenCalled()
    expect(vi.mocked(llmDecision)).not.toHaveBeenCalled()
    const lines = getState().log.map((l) => l.text)
    expect(lines.some((l) => /llm_prompt|LLM capability/i.test(l))).toBe(true)
    const entry = getState().log.find((l) => l.from === 'error')
    expect(entry).toBeDefined()
  })

  it('with capabilities.llm it invokes the bridge (provider call → llm_decision)', async () => {
    handleMessage(frame() as never)
    await vi.waitFor(() => expect(vi.mocked(llmDecision)).toHaveBeenCalledTimes(1))
    expect(vi.mocked(llmError)).not.toHaveBeenCalled()
    expect(vi.mocked(llmDecision)).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: '11111111-1111-4111-8111-111111111111', httpStatus: 200 }),
    )
  })

  it('a missing key produces an immediate llm_error, not a provider call', async () => {
    clearSeatKeys()
    handleMessage(frame() as never)
    await vi.waitFor(() => expect(vi.mocked(llmError)).toHaveBeenCalledTimes(1))
    expect(vi.mocked(llmDecision)).not.toHaveBeenCalled()
    expect(vi.mocked(llmError).mock.calls[0][0]).toMatchObject({ retryable: false })
  })
})

describe('eventHandler — who the game is waiting for', () => {
  beforeEach(() => setState({ waitingFor: null, feedback: null }))

  it('remembers the name from the server "Waiting for" inform and clears it when a prompt reaches us', () => {
    handleMessage({ type: 'event', method: 'GAME_UPDATE_AND_INFORM', objectId: 'g1', data: { message: "Waiting for <font color='#20B2AA'>Ana</font>" } } as never)
    expect(getState().waitingFor).toBe('Ana')

    handleMessage({ type: 'event', method: 'GAME_UPDATE_AND_INFORM', objectId: 'g1', data: { message: 'Upkeep - Waiting for Bo' } } as never)
    expect(getState().waitingFor).toBe('Bo')

    handleMessage({ type: 'event', method: 'GAME_ASK', objectId: 'g1', data: { question: 'Pay {1}?', gameId: 'g1' } } as never)
    expect(getState().waitingFor).toBeNull()
  })
})
