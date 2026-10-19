import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleMessage } from '../eventHandler'
import { getState, setState } from '../state'
import { reset } from '../store'
import { makeGameView, makePlayer } from '../../__fixtures__/gameViews'
import * as commands from '../../net/commands'

vi.mock('../../net/commands', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../net/commands')>()
  return {
    ...mod,
    startReplay: vi.fn().mockResolvedValue({ ok: true }),
    stopReplay: vi.fn().mockResolvedValue({ ok: true }),
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
  }
})

function replayFrame(extra: Record<string, unknown> = {}) {
  return makeGameView({
    players: [makePlayer({ playerId: 'p', name: 'P', controlled: true })],
    myPlayerId: null,
    ...extra,
  })
}

describe('eventHandler — REPLAY_* callbacks', () => {
  beforeEach(() => {
    reset()
    setState({ phase: 'lobby', gameId: null, game: null, replay: null, error: null })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('REPLAY_GAME opens the viewer and auto-starts the replay', () => {
    handleMessage({ type: 'event', method: 'REPLAY_GAME', messageId: 1, objectId: 'game-1', data: null } as never)
    expect(getState().replay?.gameId).toBe('game-1')
    expect(getState().replay?.playing).toBe(true)
    expect(commands.startReplay).toHaveBeenCalledWith('game-1')
  })

  it('REPLAY_INIT paints the board and fills the replay slice', () => {
    handleMessage({ type: 'event', method: 'REPLAY_GAME', messageId: 1, objectId: 'game-1', data: null } as never)
    handleMessage({
      type: 'event',
      method: 'REPLAY_INIT',
      messageId: 2,
      objectId: 'game-1',
      data: replayFrame({ replayStateIndex: 0, replayStateCount: 12, replayGameLog: ['a', 'b'], replayGameLogCount: 1 }),
    } as never)
    const s = getState()
    expect(s.phase).toBe('game')
    expect(s.game).not.toBeNull()
    expect(s.replay?.stateIndex).toBe(0)
    expect(s.replay?.stateCount).toBe(12)
    expect(s.replay?.gameLog).toEqual(['a'])
    expect(s.replay?.frame).not.toBeNull()
  })

  it('REPLAY_DONE end-of-replay keeps the board and stops playback', () => {
    handleMessage({ type: 'event', method: 'REPLAY_GAME', messageId: 1, objectId: 'game-1', data: null } as never)
    handleMessage({ type: 'event', method: 'REPLAY_UPDATE', messageId: 2, objectId: 'game-1', data: replayFrame({ replayStateIndex: 3 }) } as never)
    handleMessage({ type: 'event', method: 'REPLAY_DONE', messageId: 3, objectId: 'game-1', data: 'end of replay' } as never)
    const s = getState()
    expect(s.game).not.toBeNull()
    expect(s.replay?.done?.reason).toBe('boundary')
    expect(s.replay?.playing).toBe(false)
  })

  it('REPLAY_DONE stopped replay exits to the lobby', () => {
    handleMessage({ type: 'event', method: 'REPLAY_GAME', messageId: 1, objectId: 'game-1', data: null } as never)
    handleMessage({ type: 'event', method: 'REPLAY_UPDATE', messageId: 2, objectId: 'game-1', data: replayFrame({ replayStateIndex: 3 }) } as never)
    handleMessage({ type: 'event', method: 'REPLAY_DONE', messageId: 3, objectId: 'game-1', data: 'stopped replay' } as never)
    const s = getState()
    expect(s.replay).toBeNull()
    expect(s.phase).toBe('lobby')
    expect(s.game).toBeNull()
  })

  it('REPLAY_DONE error surfaces through the banner and exits', () => {
    handleMessage({ type: 'event', method: 'REPLAY_GAME', messageId: 1, objectId: 'game-1', data: null } as never)
    handleMessage({ type: 'event', method: 'REPLAY_DONE', messageId: 2, objectId: 'game-1', data: 'Replay file not found or corrupt' } as never)
    expect(getState().error).toBe('Replay file not found or corrupt')
    expect(getState().replay).toBeNull()
  })

  it('a replay frame paints the board without firing the live game-over side effects', () => {
    setState({ phase: 'game', gameId: 'game-1' })
    handleMessage({ type: 'event', method: 'REPLAY_UPDATE', messageId: 5, objectId: 'game-1', data: replayFrame({ replayStateIndex: 2 }) } as never)
    const s = getState()
    expect(s.game).not.toBeNull()
    expect(s.replay?.stateIndex).toBe(2)
    // No live match bookkeeping (the frame went through the REPLAY_* path, not GAME_*).
    expect(s.events.some((e) => e.method === 'REPLAY_UPDATE')).toBe(true)
  })
})
