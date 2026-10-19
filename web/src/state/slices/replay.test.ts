import { describe, expect, it } from 'vitest'
import { applyReplayDone, applyReplayFrame } from './replay'
import type { ReplayState } from './replay'
import { makeGameView, makePlayer } from '../../__fixtures__/gameViews'
import type { GameView, LLMConversationView } from '../../net/types'

function gameView(extra: Partial<GameView> = {}): GameView {
  return makeGameView({
    players: [
      makePlayer({ playerId: 'me', name: 'Me', controlled: true }),
      makePlayer({ playerId: 'opp', name: 'Opp' }),
    ],
    myPlayerId: null,
    ...extra,
  })
}

function llmView(playerName: string, content: string): LLMConversationView {
  return {
    playerName,
    modelName: 'm',
    exchangeCount: 1,
    totalContextChars: 0,
    modelContextWindow: 0,
    streaming: false,
    streamingStartedAt: 0,
    messages: [{ role: 'user', content }],
  }
}

describe('applyReplayFrame', () => {
  it('builds the replay state from a frame (index/count/log/llm)', () => {
    const gv = gameView({
      replayStateIndex: 4,
      replayStateCount: 20,
      replayHasLlmPlayers: true,
      replayGameLog: ['l0', 'l1', 'l2'],
      replayGameLogCount: 2,
      llmDebug: [llmView('A', 'hi')],
    })
    const replay = applyReplayFrame(null, 'game-1', gv, {
      replayStateIndex: 4,
      replayStateCount: 20,
      replayGameLog: gv.replayGameLog,
      replayGameLogCount: gv.replayGameLogCount,
      llmDebug: gv.llmDebug,
    })
    expect(replay.gameId).toBe('game-1')
    expect(replay.stateIndex).toBe(4)
    expect(replay.stateCount).toBe(20)
    expect(replay.frameCount).toBe(1)
    expect(replay.done).toBeNull()
    expect(replay.gameLog).toEqual(['l0', 'l1'])
    expect(replay.hasLlmPlayers).toBe(true)
    expect(replay.llmFrames).toHaveLength(1)
  })

  it('increments frameCount and keeps playing on a same-game update', () => {
    const first = applyReplayFrame(null, 'g', gameView({ replayStateIndex: 0 }), { replayStateIndex: 0 })
    const second = applyReplayFrame({ ...first, playing: true }, 'g', gameView({ replayStateIndex: 1 }), { replayStateIndex: 1 })
    expect(second.frameCount).toBe(2)
    expect(second.playing).toBe(true)
    expect(second.stateIndex).toBe(1)
  })

  it('resets accumulators when a different replay id arrives', () => {
    const first = applyReplayFrame(null, 'g1', gameView({ replayStateIndex: 1, llmDebug: [llmView('A', 'x')] }), {
      replayStateIndex: 1,
      llmDebug: [llmView('A', 'x')],
    })
    const other = applyReplayFrame(first, 'g2', gameView({ replayStateIndex: 0 }), { replayStateIndex: 0 })
    expect(other.gameId).toBe('g2')
    expect(other.llmFrames).toEqual([])
    expect(other.frameCount).toBe(1)
    expect(other.playing).toBe(false)
  })

  it('clears a prior done notice when a fresh frame arrives', () => {
    const prior: ReplayState = {
      ...applyReplayFrame(null, 'g', gameView({ replayStateIndex: 0 }), { replayStateIndex: 0 }),
      done: { reason: 'boundary', result: 'end of replay' },
    }
    const next = applyReplayFrame(prior, 'g', gameView({ replayStateIndex: 1 }), { replayStateIndex: 1 })
    expect(next.done).toBeNull()
  })

  it('defaults the "view as" pick to null (the automatic perspective)', () => {
    expect(applyReplayFrame(null, 'g', gameView(), {}).perspectivePlayerId).toBeNull()
  })

  it('keeps the "view as" pick across frames of one replay and resets it on a new replay', () => {
    const first: ReplayState = {
      ...applyReplayFrame(null, 'g1', gameView({ replayStateIndex: 0 }), { replayStateIndex: 0 }),
      perspectivePlayerId: 'opp',
    }
    const sameGame = applyReplayFrame(first, 'g1', gameView({ replayStateIndex: 1 }), { replayStateIndex: 1 })
    expect(sameGame.perspectivePlayerId).toBe('opp')
    const otherGame = applyReplayFrame(sameGame, 'g2', gameView({ replayStateIndex: 0 }), { replayStateIndex: 0 })
    expect(otherGame.perspectivePlayerId).toBeNull()
  })
})

describe('applyReplayDone', () => {
  const prior: ReplayState = {
    ...applyReplayFrame(null, 'g', gameView({ replayStateIndex: 3 }), { replayStateIndex: 3 }),
    playing: true,
  }

  it('keeps the board and stops playback on a boundary', () => {
    const next = applyReplayDone(prior, 'g', 'end of replay')
    expect(next).not.toBeNull()
    expect(next?.playing).toBe(false)
    expect(next?.done).toEqual({ reason: 'boundary', result: 'end of replay' })
  })

  it('exits (null slice) on a stop', () => {
    expect(applyReplayDone(prior, 'g', 'stopped replay')).toBeNull()
  })

  it('exits (null slice) on an error', () => {
    expect(applyReplayDone(prior, 'g', 'Replay file not found or corrupt')).toBeNull()
  })
})
