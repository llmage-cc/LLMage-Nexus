import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { handleMessage } from '../eventHandler'
import { getState, setState } from '../state'
import { makeGameView, makePlayer } from '../../__fixtures__/gameViews'
import { startCardFlight, getActiveFlights, clearFlights } from '../../board/flightManager'
import type { CardView, LLMConversationView } from '../../net/types'

function llmView(playerName: string): LLMConversationView {
  return {
    playerName,
    modelName: 'deepseek-v4.1',
    exchangeCount: 1,
    totalContextChars: 100,
    modelContextWindow: 1000,
    streaming: false,
    streamingStartedAt: 0,
    messages: [{ role: 'assistant', content: 'I cast Lightning Bolt.' }],
  }
}

vi.mock('../../net/commands', () => ({
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
  sendPlayerBoolean: vi.fn().mockResolvedValue(null),
  sendPlayerUUID: vi.fn().mockResolvedValue(null),
  sendManaPaymentMode: vi.fn().mockResolvedValue(null),
  updateManaConfirmPreference: vi.fn().mockResolvedValue(null),
  updatePreferences: vi.fn().mockResolvedValue(null),
  watchGame: vi.fn().mockResolvedValue(null),
  getRoomChatId: vi.fn().mockResolvedValue(null),
}))

const CARD: CardView = {
  id: 'bolt-1',
  name: 'Lightning Bolt',
  manaValue: 1,
  expansionSetCode: 'LEA',
  cardNumber: '161',
}

const fromRect = {
  left: 100,
  top: 500,
  right: 200,
  bottom: 640,
  width: 100,
  height: 140,
  x: 100,
  y: 500,
  toJSON: () => {},
} as DOMRect

const toRect = {
  left: 400,
  top: 200,
  right: 500,
  bottom: 340,
  width: 100,
  height: 140,
  x: 400,
  y: 200,
  toJSON: () => {},
} as DOMRect

function readableGameView() {
  return makeGameView({
    players: [
      makePlayer({ playerId: 'me', name: 'Me', controlled: true, isHuman: true, isActive: true, hasPriority: true }),
      makePlayer({ playerId: 'opp', name: 'Opp' }),
    ],
    myPlayerId: 'me',
    activePlayerId: 'me',
    activePlayerName: 'Me',
    priorityPlayerName: 'Me',
  })
}

describe('handleGameUpdate — GAME_INIT', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    clearFlights()
    setState({ phase: 'game', gameId: 'g-init', game: null })
  })

  afterEach(() => {
    clearFlights()
    vi.useRealTimers()
  })

  it('limpia los vuelos activos al recibir GAME_INIT (resume tras recarga o reconexión)', () => {
    const flightId = startCardFlight(CARD, fromRect, toRect, 10_000)
    expect(flightId).not.toBeNull()
    expect(getActiveFlights()).toHaveLength(1)

    handleMessage({
      type: 'event',
      method: 'GAME_INIT',
      messageId: 1,
      objectId: 'g-init',
      data: { gameView: readableGameView() },
    } as never)

    expect(getActiveFlights()).toHaveLength(0)
    expect(getState().game).not.toBeNull()
  })

  it('no toca los vuelos en un GAME_UPDATE normal', () => {
    const flightId = startCardFlight(CARD, fromRect, toRect, 10_000)
    expect(flightId).not.toBeNull()

    handleMessage({
      type: 'event',
      method: 'GAME_UPDATE',
      messageId: 2,
      objectId: 'g-init',
      data: { gameView: readableGameView() },
    } as never)

    expect(getActiveFlights()).toHaveLength(1)
  })
})

describe('END_GAME_INFO — gameEndLlmSeats capture', () => {
  beforeEach(() => {
    setState({ phase: 'game', gameId: 'g-llm', game: null, gameEnd: null, gameEndLlmSeats: null })
  })

  afterEach(() => {
    cleanup()
  })

  it('captures the LLM seats of the finished game BEFORE clearing the board (match over)', () => {
    setState({
      capabilities: { llm: true } as never,
      game: makeGameView({
        players: [makePlayer({ playerId: 'me', name: 'Me', controlled: true })],
        myPlayerId: 'me',
        llmChatPublic: true,
        llmDebug: [llmView('DeepSeek Bot')],
      }),
    })

    handleMessage({
      type: 'event',
      method: 'END_GAME_INFO',
      messageId: 3,
      data: {
        gameInfo: 'You have won the game',
        matchInfo: 'You won the match!',
        matchView: { endTime: '2026-08-29T23:50:00Z' },
      },
    } as never)

    const s = getState()
    expect(s.game).toBeNull()
    expect(s.gameEnd).not.toBeNull()
    expect(s.gameEndLlmSeats?.gameId).toBe('g-llm')
    expect(s.gameEndLlmSeats?.seats).toHaveLength(1)
    expect(s.gameEndLlmSeats?.seats[0]?.playerName).toBe('DeepSeek Bot')
  })

  it('captures nothing for a non-LLM game (or a hidden-chat table)', () => {
    setState({
      capabilities: { llm: false } as never,
      game: makeGameView({
        players: [makePlayer({ playerId: 'me', name: 'Me', controlled: true })],
        myPlayerId: 'me',
      }),
    })

    handleMessage({
      type: 'event',
      method: 'END_GAME_INFO',
      messageId: 4,
      data: {
        gameInfo: 'You have won the game',
        matchInfo: 'You won the match!',
        matchView: { endTime: '2026-08-29T23:50:00Z' },
      },
    } as never)

    expect(getState().gameEndLlmSeats).toBeNull()
  })
})
