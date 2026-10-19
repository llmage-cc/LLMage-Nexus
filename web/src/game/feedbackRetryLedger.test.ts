// @vitest-environment jsdom
// Regression: the first "Keep hand" click sends the
// boolean frame (wire-verified `sendPlayerBoolean value:false`) but the server
// keeps asking the same mulligan question for 20–90 s — the answer was
// swallowed by HumanPlayer's waitResponseOpen stall. The web must queue the
// un-consumed answer and replay it on the identical re-asked prompt instead of
// leaving a claimed, busy-gated dead prompt.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { useFeedbackForm, takeQueuedAnswerFor, sentAnswerOf } from './useFeedbackForm'
import { getState, setState } from '../state/state'
import type { FeedbackPrompt } from './feedback'

let autoResolve = true
const sentFrames: { fn: string; args: unknown[] }[] = []

vi.mock('../net/commands', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../net/commands')>()),
  sendPlayerBoolean: vi.fn((_value: boolean, gameId: string) => {
    sentFrames.push({ fn: 'sendPlayerBoolean', args: [_value, gameId] })
    return autoResolve ? Promise.resolve({ ok: true }) : new Promise(() => {})
  }),
  sendPlayerUUID: vi.fn((value: string, gameId: string) => {
    sentFrames.push({ fn: 'sendPlayerUUID', args: [value, gameId] })
    return autoResolve ? Promise.resolve({ ok: true }) : new Promise(() => {})
  }),
}))

const mulliganPrompt = (overrides: Partial<FeedbackPrompt> = {}): FeedbackPrompt =>
  ({
    method: 'GAME_ASK',
    gameId: 'g-1',
    title: 'Mulligan',
    message: 'Take Mulligan (6)?',
    mode: 'boolean',
    options: [
      { id: 'mulligan', label: 'Mulligan', value: 'true' },
      { id: 'keep', label: 'Keep Hand', value: 'false' },
    ],
    min: 0,
    max: 0,
    required: true,
    isMulligan: true,
    ...overrides,
  }) as FeedbackPrompt

const londonPrompt = (overrides: Partial<FeedbackPrompt> = {}): FeedbackPrompt =>
  ({
    method: 'GAME_TARGET',
    gameId: 'g-1',
    title: 'London Mulligan',
    message: 'Select a card (1 more) to put on the bottom of your library',
    mode: 'uuid',
    options: [
      { id: 'h-1', label: 'Mountain', value: 'h-1' },
      { id: 'h-2', label: 'Forest', value: 'h-2' },
    ],
    min: 1,
    max: 1,
    required: true,
    isMulligan: false,
    isMulliganLondon: true,
    ...overrides,
  }) as FeedbackPrompt

function framesOf(fn: string) {
  return sentFrames.filter((f) => f.fn === fn)
}

function freshForm() {
  return renderHook(() => useFeedbackForm())
}

describe('useFeedbackForm — swallowed-answer ledger (keep-hand)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sentFrames.length = 0
    autoResolve = true
  })
  afterEach(() => {
    cleanup()
    setState({ feedback: null })
  })

  it('queues the keep answer when the ack lands with the same prompt still up', async () => {
    const first = mulliganPrompt()
    setState({ feedback: first })
    const { result } = freshForm()
    act(() => result.current.selectOption({ id: 'keep', label: 'Keep Hand', value: 'false' }))
    // ack arrives ok, but the SAME prompt is still on screen (server swallow):
    // the optimistic claim dismisses it and the answer is PARKED.
    await act(async () => { await Promise.resolve() })
    expect(framesOf('sendPlayerBoolean')).toHaveLength(1)
    // the re-asked prompt (fresh object, same question) replays the keep answer
    const reask = mulliganPrompt()
    setState({ feedback: reask })
    await waitFor(() => expect(framesOf('sendPlayerBoolean')).toHaveLength(2))
    expect(framesOf('sendPlayerBoolean')[1].args).toEqual([false, 'g-1'])
    // the replay is protected the same way: a second non-consumption parks it again
    expect(takeQueuedAnswerFor(reask)?.value).toBe('false')
    expect(framesOf('sendPlayerBoolean')).toHaveLength(2) // no third send without a new re-ask
  })

  it('an intervening DIFFERENT prompt supersedes the queued value — no stale leak', async () => {
    const first = mulliganPrompt()
    setState({ feedback: first })
    const { result } = freshForm()
    act(() => result.current.selectOption({ id: 'keep', label: 'Keep Hand', value: 'false' }))
    await act(async () => { await Promise.resolve() })
    // the server moved on: a DIFFERENT ask (not a re-ask of the mulligan)
    const other = mulliganPrompt({ message: 'Pay 2 life?', isMulligan: false }) as FeedbackPrompt
    setState({ feedback: other })
    await act(async () => { await Promise.resolve() })
    expect(framesOf('sendPlayerBoolean')).toHaveLength(1) // nothing replayed into the other ask
    expect(getState().feedback).toBe(other)
  })

  it('a same-value double click during the in-flight frame queues and completes once more', async () => {
    const first = mulliganPrompt()
    setState({ feedback: first })
    const { result } = freshForm()
    act(() => result.current.selectOption({ id: 'keep', label: 'Keep Hand', value: 'false' }))
    // Second click while the first frame is still in flight: parked (queuedClick)
    act(() => result.current.selectOption({ id: 'keep', label: 'Keep Hand', value: 'false' }))
    expect(framesOf('sendPlayerBoolean')).toHaveLength(1)
    expect(result.current.queuedClick).toBe(true)
  })

  it('London bottoming: a single-card uuid re-ask replays the exact uid', async () => {
    const first = londonPrompt({ options: [{ id: 'h-2', label: 'Forest', value: 'h-2' }] })
    setState({ feedback: first })
    const { result } = freshForm()
    act(() => result.current.selectOption(first.options[0]))
    await act(async () => { await Promise.resolve() })
    expect(framesOf('sendPlayerUUID')).toHaveLength(1)
    // the pick was swallowed: the server re-asks the identical bottoming question
    setState({ feedback: londonPrompt({ options: [{ id: 'h-2', label: 'Forest', value: 'h-2' }] }) })
    await waitFor(() => expect(framesOf('sendPlayerUUID')).toHaveLength(2))
    expect(framesOf('sendPlayerUUID')[1].args).toEqual(['h-2', 'g-1'])
  })

  it('the ledger parks the explicit sent value on the swallowed-shape', async () => {
    const first = londonPrompt({ options: [{ id: 'h-2', label: 'Forest', value: 'h-2' }] })
    expect(sentAnswerOf(londonPrompt({ options: [{ id: 'h-9', label: 'X', value: 'h-9' }] }))).toBe('h-9')
    expect(sentAnswerOf(first)).toBe('h-2')
    // boolean asks: primary option (index 0) — the dialog passes the explicit
    // clicked value in `answer.value`; `sentAnswerOf` only mirrors the default.
    expect(sentAnswerOf(mulliganPrompt())).toBe('true')
  })
})

describe('takeQueuedAnswerFor — ledger invariants', () => {
  it('returns null for a prompt with no queued entry (ledger is module-global, keyed per game)', () => {
    const probe = londonPrompt({ gameId: 'g-no-entry' })
    expect(takeQueuedAnswerFor(probe)).toBeNull()
  })
})