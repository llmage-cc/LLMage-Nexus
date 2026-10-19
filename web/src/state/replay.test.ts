import { describe, expect, it } from 'vitest'
import {
  classifyReplayDone,
  mergeReplayLLMFrames,
  replayLLMHistoryFor,
  replayLogSliceFor,
  REPLAY_SKIP_MOVES,
  REPLAY_TICK_MS,
} from './replay'
import type { ReplayLLMFrame } from './replay'
import type { LLMConversationView } from '../net/types'

function view(playerName: string, messages: { role: string; content: string }[]): LLMConversationView {
  return {
    playerName,
    modelName: 'test-model',
    exchangeCount: messages.length,
    totalContextChars: 0,
    modelContextWindow: 0,
    streaming: false,
    streamingStartedAt: 0,
    messages,
  }
}

describe('replayLogSliceFor', () => {
  it('slices entries 0..count-1 of the flat final log', () => {
    expect(replayLogSliceFor({ replayGameLog: ['a', 'b', 'c'], replayGameLogCount: 2 })).toEqual(['a', 'b'])
  })

  it('clamps a count above the log length and defaults to the whole log', () => {
    expect(replayLogSliceFor({ replayGameLog: ['a', 'b'], replayGameLogCount: 99 })).toEqual(['a', 'b'])
    expect(replayLogSliceFor({ replayGameLog: ['a', 'b'] })).toEqual(['a', 'b'])
  })

  it('returns [] for a frame without a log (pre-capture save)', () => {
    expect(replayLogSliceFor(null)).toEqual([])
    expect(replayLogSliceFor({ replayGameLog: [], replayGameLogCount: 0 })).toEqual([])
  })
})

describe('mergeReplayLLMFrames', () => {
  it('keys the frame own llmDebug at its state index', () => {
    const merged = mergeReplayLLMFrames([], { replayStateIndex: 3, llmDebug: [view('A', [])] }, -1)
    expect(merged).toHaveLength(1)
    expect(merged[0].stateIndex).toBe(3)
  })

  it('overwrites the same state index idempotently (no duplicates)', () => {
    const first = mergeReplayLLMFrames([], { replayStateIndex: 2, llmDebug: [view('A', [{ role: 'user', content: 'x' }])] }, -1)
    const second = mergeReplayLLMFrames(first, { replayStateIndex: 2, llmDebug: [view('A', [{ role: 'user', content: 'y' }])] }, -1)
    expect(second).toHaveLength(1)
    expect(second[0].entries[0].messages[0].content).toBe('y')
  })

  it('merges skipped-range buckets under their own true indexes', () => {
    const merged = mergeReplayLLMFrames([], {
      replayStateIndex: 9,
      llmDebug: [view('A', [])],
      replayLLMBuckets: {
        '4': { entries: [view('A', [])] },
        '7': { entries: [view('A', [])] },
      },
    }, -1)
    expect(merged.map((f) => f.stateIndex).sort((a, b) => a - b)).toEqual([4, 7, 9])
  })

  it('drops empty buckets and never writes an empty frame', () => {
    const merged = mergeReplayLLMFrames([], { replayStateIndex: 5, llmDebug: [] }, -1)
    expect(merged).toEqual([])
  })
})

describe('replayLLMHistoryFor', () => {
  const frames: ReplayLLMFrame[] = [
    { stateIndex: 0, entries: [view('Llm', [{ role: 'system', content: 'sys' }, { role: 'user', content: 'a' }])] },
    { stateIndex: 2, entries: [view('Llm', [{ role: 'system', content: 'sys' }, { role: 'assistant', content: 'b' }])] },
    { stateIndex: 5, entries: [view('Llm', [{ role: 'user', content: 'c' }])] },
  ]

  it('filters to frames at or before the cursor, ordered by index', () => {
    const at2 = replayLLMHistoryFor(frames, 2)
    expect(at2).toHaveLength(1)
    expect(at2[0].messages.map((m) => m.content)).toEqual(['sys', 'a', 'b'])
  })

  it('drops later exchanges when scrubbing backward', () => {
    const at0 = replayLLMHistoryFor(frames, 0)
    expect(at0[0].messages.map((m) => m.content)).toEqual(['sys', 'a'])
  })

  it('keeps only the FIRST system message per player on merge', () => {
    const all = replayLLMHistoryFor(frames, 5)
    const systems = all[0].messages.filter((m) => m.role === 'system')
    expect(systems).toHaveLength(1)
    expect(all[0].messages.map((m) => m.content)).toEqual(['sys', 'a', 'b', 'c'])
  })

  it('merges buckets per player independently', () => {
    const two: ReplayLLMFrame[] = [
      { stateIndex: 0, entries: [view('A', [{ role: 'user', content: 'a0' }])] },
      { stateIndex: 1, entries: [view('B', [{ role: 'user', content: 'b1' }])] },
    ]
    const merged = replayLLMHistoryFor(two, 1)
    expect(merged.map((e) => e.playerName).sort()).toEqual(['A', 'B'])
  })
})

describe('classifyReplayDone', () => {
  it('classifies "end of replay" as a boundary', () => {
    expect(classifyReplayDone('end of replay')).toEqual({ reason: 'boundary', result: 'end of replay' })
  })

  it('classifies "stopped replay" as stopped', () => {
    expect(classifyReplayDone('stopped replay').reason).toBe('stopped')
  })

  it('classifies anything else as an error and reads an object payload', () => {
    expect(classifyReplayDone('Replay file not found or corrupt').reason).toBe('error')
    expect(classifyReplayDone({ message: 'end of replay' }).reason).toBe('boundary')
    expect(classifyReplayDone(null).reason).toBe('error')
  })
})

describe('replay constants', () => {
  it('exposes the desktop parity tick and skip count', () => {
    expect(REPLAY_TICK_MS).toBe(1000)
    expect(REPLAY_SKIP_MOVES).toBe(10)
  })
})
