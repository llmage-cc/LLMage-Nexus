import { describe, expect, it } from 'vitest'
import {
  llmTabVisible,
  liveHasLlmPlayers,
  isSeated,
  isLlmTabOffered,
  llmTabView,
  llmTabEmptyKey,
  effectiveDrawerTab,
  splitAssistantMessage,
  messageWindow,
  LLM_MESSAGE_WINDOW,
} from './llmTab'
import type { LlmTabSource } from './llmTab'
import { makeGameView, makePlayer } from '../__fixtures__/gameViews'
import type { GameView, LLMConversationView } from '../net/types'
import type { ReplayState } from '../state/slices/replay'

const CAPS = { llm: true, p1: false, replayScrubber: true, replaySidecar: true, serverVersion: 'x', playerTypes: [] }
const NO_LLM_CAPS = { ...CAPS, llm: false }

function conv(playerName: string, content = 'hi'): LLMConversationView {
  return {
    playerName,
    modelName: 'model-x',
    exchangeCount: 1,
    totalContextChars: 10,
    modelContextWindow: 8000,
    streaming: false,
    streamingStartedAt: 0,
    messages: [{ role: 'user', content }],
  }
}

function liveGame(extra: Partial<GameView> = {}): GameView {
  return makeGameView({
    players: [
      makePlayer({ playerId: 'me', name: 'Me', controlled: true }),
      makePlayer({ playerId: 'opp', name: 'Opp' }),
    ],
    myPlayerId: 'me',
    ...extra,
  })
}

/** A GameView with an explicit (non-contract) hasLlmPlayers flag, as a future proxy might emit it. */
function withLlmFlag(gv: GameView, flag: boolean): GameView {
  return { ...gv, hasLlmPlayers: flag } as GameView
}

function replayState(extra: Partial<ReplayState> = {}): ReplayState {
  return {
    gameId: 'g',
    frame: null,
    stateIndex: 2,
    stateCount: 5,
    frameCount: 1,
    playing: false,
    done: null,
    llmFrames: [],
    gameLog: [],
    hasLlmPlayers: true,
    ...extra,
  }
}

describe('llmTabVisible', () => {
  it('requires the llm capability first', () => {
    expect(llmTabVisible({ llmCapable: false, hasLlmPlayers: true, llmChatPublic: true, isParticipant: true })).toBe(false)
  })

  it('requires LLM players present', () => {
    expect(llmTabVisible({ llmCapable: true, hasLlmPlayers: false, llmChatPublic: true, isParticipant: true })).toBe(false)
  })

  it('is offered to a participant even when chat is private', () => {
    expect(llmTabVisible({ llmCapable: true, hasLlmPlayers: true, llmChatPublic: false, isParticipant: true })).toBe(true)
  })

  it('is offered to a spectator only when chat is public', () => {
    expect(llmTabVisible({ llmCapable: true, hasLlmPlayers: true, llmChatPublic: true, isParticipant: false })).toBe(true)
    expect(llmTabVisible({ llmCapable: true, hasLlmPlayers: true, llmChatPublic: false, isParticipant: false })).toBe(false)
  })
})

describe('live presence + seating helpers', () => {
  it('prefers the explicit hasLlmPlayers flag, else the raw llmDebug list', () => {
    expect(liveHasLlmPlayers(withLlmFlag(liveGame({ llmDebug: [conv('A')] }), false))).toBe(false)
    expect(liveHasLlmPlayers(withLlmFlag(liveGame(), true))).toBe(true)
    expect(liveHasLlmPlayers(liveGame({ llmDebug: [conv('A')] }))).toBe(true)
    expect(liveHasLlmPlayers(liveGame())).toBe(false)
    expect(liveHasLlmPlayers(null)).toBe(false)
  })

  it('detects a seated participant by myPlayerId or a controlled seat', () => {
    expect(isSeated(liveGame())).toBe(true)
    expect(isSeated(makeGameView({ players: [makePlayer({ playerId: 'o', name: 'O' })], myPlayerId: null }))).toBe(false)
  })
})

describe('isLlmTabOffered', () => {
  const base: LlmTabSource = { capabilities: CAPS, game: withLlmFlag(liveGame({ llmChatPublic: false }), true), replay: null }

  it('offers the live tab to a participant of an LLM game', () => {
    expect(isLlmTabOffered(base)).toBe(true)
  })

  it('hides the live tab without the capability', () => {
    expect(isLlmTabOffered({ ...base, capabilities: NO_LLM_CAPS })).toBe(false)
  })

  it('hides the live tab when the game has no LLM players', () => {
    expect(isLlmTabOffered({ ...base, game: liveGame() })).toBe(false)
  })

  it('hides the live tab for a spectator on a private table', () => {
    const spectating = withLlmFlag(
      makeGameView({ players: [makePlayer({ playerId: 'o', name: 'O' })], myPlayerId: null, llmChatPublic: false }),
      true,
    )
    expect(isLlmTabOffered({ ...base, game: spectating })).toBe(false)
  })

  it('offers the replay tab to a spectator of an LLM replay', () => {
    const spectating = makeGameView({ players: [makePlayer({ playerId: 'o', name: 'O' })], myPlayerId: null })
    expect(isLlmTabOffered({ capabilities: CAPS, game: spectating, replay: replayState({ hasLlmPlayers: true }) })).toBe(true)
  })

  it('hides the replay tab when the replay has no LLM seat', () => {
    expect(isLlmTabOffered({ capabilities: CAPS, game: null, replay: replayState({ hasLlmPlayers: false }) })).toBe(false)
  })

  it('hides the replay tab when the seat presence is still unknown', () => {
    expect(isLlmTabOffered({ capabilities: CAPS, game: null, replay: replayState({ hasLlmPlayers: null }) })).toBe(false)
  })
})

describe('llmTabView', () => {
  it('reads a live frame\u2019s own llmDebug', () => {
    expect(llmTabView({ game: liveGame({ llmDebug: [conv('A')] }), replay: null })).toHaveLength(1)
  })

  it('returns an empty list for a live game without llmDebug', () => {
    expect(llmTabView({ game: liveGame(), replay: null })).toEqual([])
    expect(llmTabView({ game: null, replay: null })).toEqual([])
  })

  it('rebuilds the cumulative view for a replay cursor, dropping later frames', () => {
    const early = conv('A', 'early')
    const late = conv('A', 'late')
    const replay = replayState({
      stateIndex: 1,
      llmFrames: [
        { stateIndex: 1, entries: [early] },
        { stateIndex: 4, entries: [late] },
      ],
    })
    const views = llmTabView({ game: null, replay })
    expect(views).toHaveLength(1)
    expect(views[0].messages.map((m) => m.content)).toEqual(['early'])
  })
})

describe('llmTabEmptyKey', () => {
  it('claims no LLM players only when the live game truly has none', () => {
    expect(llmTabEmptyKey({ capabilities: CAPS, game: liveGame(), replay: null })).toBe('llm_empty_no_players')
    expect(llmTabEmptyKey({ capabilities: CAPS, game: withLlmFlag(liveGame(), true), replay: null })).toBe('llm_empty_private')
  })

  it('distinguishes a replay with seats from one without', () => {
    expect(llmTabEmptyKey({ capabilities: CAPS, game: null, replay: replayState({ hasLlmPlayers: true }) })).toBe('llm_empty_replay')
    expect(llmTabEmptyKey({ capabilities: CAPS, game: null, replay: replayState({ hasLlmPlayers: false }) })).toBe('llm_empty_no_players')
    expect(llmTabEmptyKey({ capabilities: CAPS, game: null, replay: replayState({ hasLlmPlayers: null }) })).toBe('llm_empty_replay')
  })
})

describe('effectiveDrawerTab', () => {
  const offered = ['stack', 'log'] as const
  it('keeps an offered choice', () => {
    expect(effectiveDrawerTab('log', offered)).toBe('log')
  })
  it('falls back to closed for a choice no longer offered', () => {
    expect(effectiveDrawerTab('llm', offered)).toBeNull()
  })
  it('stays closed when nothing is stored', () => {
    expect(effectiveDrawerTab(null, offered)).toBeNull()
  })
})

describe('splitAssistantMessage', () => {
  it('never splits non-assistant messages', () => {
    expect(splitAssistantMessage('Reasoning: x', 'user')).toEqual({ decision: 'Reasoning: x', reasoning: '' })
  })

  it('splits a [model_reasoning] fence', () => {
    expect(splitAssistantMessage('Answer A\n[model_reasoning]why[/model_reasoning]', 'assistant')).toEqual({
      decision: 'Answer A',
      reasoning: 'why',
    })
  })

  it('keeps an unterminated fence as reasoning', () => {
    const { decision, reasoning } = splitAssistantMessage('Answer\n[model_reasoning]still thinking', 'assistant')
    expect(decision).toBe('Answer')
    expect(reasoning).toBe('still thinking')
  })

  it('splits the legacy Reasoning: shape (case-insensitive)', () => {
    const { decision, reasoning } = splitAssistantMessage('Decision: 3\nreasoning: because', 'assistant')
    expect(decision).toBe('Decision: 3')
    expect(reasoning).toBe('reasoning: because')
  })

  it('leaves a plain assistant message intact', () => {
    expect(splitAssistantMessage('just an answer', 'assistant')).toEqual({ decision: 'just an answer', reasoning: '' })
  })
})

describe('messageWindow (drawer bounding)', () => {
  it('shows the whole list when it fits in the window', () => {
    expect(messageWindow(30, LLM_MESSAGE_WINDOW)).toEqual({ start: 0, end: 30, hiddenBefore: 0 })
  })

  it('shows the LAST `shown` messages of a long list', () => {
    expect(messageWindow(300, LLM_MESSAGE_WINDOW)).toEqual({ start: 300 - LLM_MESSAGE_WINDOW, end: 300, hiddenBefore: 300 - LLM_MESSAGE_WINDOW })
  })

  it('never exceeds the list length when `shown` grows past it', () => {
    expect(messageWindow(300, 1000)).toEqual({ start: 0, end: 300, hiddenBefore: 0 })
  })

  it('handles an empty list', () => {
    expect(messageWindow(0, LLM_MESSAGE_WINDOW)).toEqual({ start: 0, end: 0, hiddenBefore: 0 })
  })
})
