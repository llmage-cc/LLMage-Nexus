import { useEffect, useMemo, useState } from 'react'
import * as cmds from '../net/commands'
import { clearFeedback, recordDungeonRoom, setStoreError, useStore } from '../state/store'
import { getState } from '../state/state'
import type { FeedbackOption, FeedbackPrompt } from './feedback'
import { ventureChoiceFromPrompt } from './dungeons'
import { useTranslation, t as tStatic } from '../i18n'
import { perfMark } from '../system/perfProbe'

export function sendValue(prompt: FeedbackPrompt, value: string) {
  switch (prompt.mode) {
    case 'boolean':
      return cmds.sendPlayerBoolean(value === 'true', prompt.gameId)
    case 'string':
      return cmds.sendPlayerString(value, prompt.gameId)
    case 'uuid':
      return cmds.sendPlayerUUID(value, prompt.gameId)
    case 'mana':
      if (!prompt.playerId) return Promise.resolve({ ok: false, error: tStatic('errors', 'send_failed_mana') })
      return cmds.sendPlayerManaType(prompt.gameId, prompt.playerId, value)
    default:
      return Promise.resolve({ ok: false, error: tStatic('errors', 'generic_error') })
  }
}

// ── Swallowed-answer ledger ("Keep hand" dead 20–90 s) ──────────────────────
//
// Engine fact (verified on the engine): HumanPlayer answers that
// arrive while `responseOpenedForAnswer` is false enter the waitResponseOpen()
// stall (RESPONSE_WAITING_TIME_SECS = 30) and can be dropped. The wire frame
// still resolves `ok` (session.sendPlayerBoolean succeeded), so the web
// claimed the prompt, left it busy-gated/cleared, and the user stared at a
// dead "Keep hand →" until the server re-asked the same question.
//
// Web fix (engine untouchable): when a send resolves `ok` while the prompt
// was consumed only by OUR optimistic claim (or superseded by the server's
// identical re-ask), remember the answer under (gameId, answer mode). When
// the server re-asks the exact same question (same method+message+bounds),
// replay that answer once, automatically. Any other incoming question
// supersedes and simply drops the entry — a stale value never leaks.
const PENDING_ANSWER_MAX_AGE_MS = 90_000
type PendingAnswer = { mode: 'boolean' | 'uuid' | 'string'; value: string; at: number; prompt: FeedbackPrompt }
const pendingAnswers = new Map<string, PendingAnswer>()

function pendingKey(gameId: string, mode: PendingAnswer['mode']): string {
  return `${gameId}|${mode}`
}

/** Only the server's literal re-ask of the same question qualifies for a
 *  replay: same method (query channel), same message text, same bounds. The
 *  engine re-sends the identical message when it asks again (the log kept
 *  showing "¿Take Mulligan (5)?" throughout the stall), while legitimate
 *  follow-up asks always change the text (e.g. "Mulligan down to 5 cards?"
 *  after "(6)"). */
function isSameQuestion(a: FeedbackPrompt | null, b: FeedbackPrompt): boolean {
  return !!a
    && a.gameId === b.gameId
    && a.method === b.method
    && a.mode === b.mode
    && a.message === b.message
    && a.min === b.min
    && a.max === b.max
}

/** Takes and removes the parked answer for `prompt` when the server re-asked
 *  the exact question the parked answer belongs to; null otherwise (or when
 *  the entry aged out). Consuming here is what makes the replay exactly-once. */
export function takeQueuedAnswerFor(prompt: FeedbackPrompt): PendingAnswer | null {
  const mode = prompt.mode
  if (mode !== 'boolean' && mode !== 'uuid' && mode !== 'string') return null
  const key = pendingKey(prompt.gameId, mode)
  const entry = pendingAnswers.get(key)
  if (!entry) return null
  if (Date.now() - entry.at > PENDING_ANSWER_MAX_AGE_MS) {
    pendingAnswers.delete(key)
    return null
  }
  if (!isSameQuestion(prompt, entry.prompt)) {
    // A different question superseded: drop the stale value, never replay it.
    pendingAnswers.delete(key)
    return null
  }
  pendingAnswers.delete(key)
  return entry
}

interface SentAnswer {
  gameId: string
  mode: PendingAnswer['mode']
  value: string
  prompt: FeedbackPrompt
}

/** The value this dialog's send carries (its primary/default option) — used by
 *  callers to build the `sendWithRetry` answer descriptor and by tests to
 *  assert the ledger parks the same value the UI clicked. */
export function sentAnswerOf(prompt: FeedbackPrompt): string | null {
  switch (prompt.mode) {
    case 'boolean': return prompt.options[0]?.value ?? null
    case 'uuid':
    case 'string': return prompt.options[0]?.value ?? null
    default: return null
  }
}

function isResultOk(result: { ok: boolean; error?: string }, fallback: string, answered: FeedbackPrompt | null) {
  if (result.ok) {
    if (getState().feedback === answered) clearFeedback()
    return true
  }
  setStoreError(result.error ?? fallback)
  return false
}

export interface UseFeedbackForm {
  prompt: FeedbackPrompt | null
  busy: boolean
  /** A click landed while a send was in flight: the controls stay enabled
   *  ("sending…") and the click is completed once the current send settles. */
  queuedClick: boolean
  amount: number
  setAmount: React.Dispatch<React.SetStateAction<number>>
  selected: string[]
  setSelected: React.Dispatch<React.SetStateAction<string[]>>
  multiAmounts: Record<string, number>
  setMultiAmounts: React.Dispatch<React.SetStateAction<Record<string, number>>>
  textValue: string
  setTextValue: (v: string) => void
  filteredStringOptions: FeedbackOption[]
  send: (action: () => Promise<{ ok: boolean; error?: string }>, fallback: string) => Promise<void>
  /** Like `send`, but registers the concrete answer value in the swallowed-
   *  answer ledger so an identical server re-ask replays it automatically. */
  sendWithRetry: (
    action: () => Promise<{ ok: boolean; error?: string }>,
    fallback: string,
    answer: { gameId: string; mode: PendingAnswer['mode']; value: string; prompt: FeedbackPrompt },
  ) => Promise<void>
  /** Same as `send` but returns whether the action was accepted and skips the
   *  `busy` guard: used to chain the answer to consecutive server prompts. */
  sendNow: (action: () => Promise<{ ok: boolean; error?: string }>, fallback: string) => Promise<boolean>
  cancel: () => void
  finishOptionalTarget: () => void
  selectOption: (option: FeedbackOption) => void
  confirmSelected: () => void
  confirmAmount: () => void
  confirmMultiAmount: () => void
}

export function useFeedbackForm(): UseFeedbackForm {
  const { t } = useTranslation()
  const prompt = useStore((s) => s.feedback)
  const [busy, setBusy] = useState(false)
  // A click during an in-flight send: completed right after the current send
  // settles (MulliganDialog watches this flag for the Keep/Mulligan buttons).
  const [queuedClick, setQueuedClick] = useState(false)
  const [amount, setAmount] = useState(0)
  const [selected, setSelected] = useState<string[]>([])
  const [multiAmounts, setMultiAmounts] = useState<Record<string, number>>({})
  const [textValue, setTextValue] = useState('')

  useEffect(() => {
    setBusy(false)
    setQueuedClick(false)
    setAmount(prompt?.min ?? 0)
    setSelected([])
    setMultiAmounts(Object.fromEntries((prompt?.items ?? []).map((item) => [item.id, item.defaultValue ?? item.min])))
    setTextValue('')
  }, [prompt])

  const filteredStringOptions = useMemo(() => {
    if (!prompt?.options) return []
    if (!textValue.trim()) return prompt.options
    const q = textValue.trim().toLowerCase()
    return prompt.options.filter((opt) => opt.label.toLowerCase().includes(q) || opt.value.toLowerCase().includes(q))
  }, [prompt?.options, textValue])

  const perform = async (action: () => Promise<{ ok: boolean; error?: string }>, fallback: string): Promise<boolean> => {
    const perfExtra = { method: prompt?.method ?? null, mode: prompt?.mode ?? null }
    perfMark('click', 'prompt', undefined, perfExtra)
    perfMark('ack', 'prompt', undefined, perfExtra)
    const answered = getState().feedback
    try {
      return isResultOk(await action(), fallback, answered) ? true : false
    } catch (error) {
      setStoreError(error instanceof Error ? error.message : fallback)
      return false
    }
  }

  // The send path that can swallow an answer into the server's waitResponseOpen
  // stall (comment at the ledger). When the frame resolves ok but the prompt was
  // only dismissed by our own optimistic claim (isResultOk cleared it) or the
  // server replaced it with the identical re-ask, park the answer: the matching
  // re-ask replays it. `sendNow` (chained answers to consecutive NEW prompts)
  // keeps the plain path — those prompts are freshly asked, never re-asks.
  const performWithRetryLedger = async (
    action: () => Promise<{ ok: boolean; error?: string }>,
    fallback: string,
    sent: SentAnswer | null,
  ): Promise<boolean> => {
    const answered = getState().feedback
    const sentOk = await perform(action, fallback)
    if (sentOk && sent && answered) {
      const now = getState().feedback
      const swallowedShape =
        now == null // our claim dismissed a prompt the server never consumed
        || now === answered // echo lag: prompt not even replaced yet
        || isSameQuestion(now, sent.prompt) // server already re-asked it
      if (swallowedShape) {
        pendingAnswers.set(pendingKey(sent.gameId, sent.mode), { mode: sent.mode, value: sent.value, at: Date.now(), prompt: sent.prompt })
      }
    }
    return sentOk
  }

  const send = async (action: () => Promise<{ ok: boolean; error?: string }>, fallback: string) => {
    await sendTracked(action, fallback, null)
  }

  const sendWithRetry = async (
    action: () => Promise<{ ok: boolean; error?: string }>,
    fallback: string,
    answer: NonNullable<SentAnswer>,
  ) => {
    await sendTracked(action, fallback, answer)
  }

  const sendTracked = async (
    action: () => Promise<{ ok: boolean; error?: string }>,
    fallback: string,
    sent: SentAnswer | null,
  ) => {
    if (busy) {
      // A second click while the first frame is still flying: do not swallow
      // it — flag it ("sending…") and complete it once this send settles.
      setQueuedClick(true)
      return
    }
    setBusy(true)
    setQueuedClick(false)
    try {
      await performWithRetryLedger(action, fallback, sent)
    } finally {
      setBusy(false)
    }
  }

  // The next server prompt can arrive before the previous action's ack (server
  // callbacks travel on another socket), so the chained answers must not be
  // gated on `busy`: each prompt is claimed exactly once by the caller instead.
  const sendNow = async (action: () => Promise<{ ok: boolean; error?: string }>, fallback: string): Promise<boolean> => {
    setBusy(true)
    try {
      return await perform(action, fallback)
    } finally {
      setBusy(false)
    }
  }

  // The server re-asked the question whose answer was swallowed: replay the
  // parked answer once, ungated (the arriving prompt may preempt a busy
  // send). The replay itself is ledger-aware, so a re-swallowed answer parks
  // again and survives until the server actually consumes it.
  const replaySource = useStore((s) => s.feedback)
  useEffect(() => {
    if (busy || !replaySource) return
    const queued = takeQueuedAnswerFor(replaySource)
    if (!queued) return
    const current = replaySource
    setBusy(true)
    performWithRetryLedger(() => sendValue(current, queued.value), tStatic('errors', 'send_failed'), {
      gameId: current.gameId,
      mode: queued.mode,
      value: queued.value,
      prompt: current,
    })
      .finally(() => setBusy(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- performWithRetryLedger is stable closure state (recreated each render like `send`)
  }, [replaySource, busy])

  const cancel = () => {
    void sendTracked(() => cmds.sendPlayerBoolean(false, prompt!.gameId), t('errors', 'send_failed'), prompt
      ? { gameId: prompt.gameId, mode: 'boolean', value: 'false', prompt }
      : null)
  }

  const finishOptionalTarget = () => {
    void sendTracked(() => cmds.sendPlayerBoolean(false, prompt!.gameId), t('errors', 'send_failed'), prompt
      ? { gameId: prompt.gameId, mode: 'boolean', value: 'false', prompt }
      : null)
  }

  const selectOption = (option: FeedbackOption) => {
    if (!prompt) return
    if (prompt.mode === 'uuid' && prompt.max > 1) {
      setSelected((current) => current.includes(option.value)
        ? current.filter((value) => value !== option.value)
        : current.length < prompt.max ? [...current, option.value] : current)
      return
    }
    const current = prompt
    const venture = current.method === 'GAME_ASK' ? ventureChoiceFromPrompt(current.message, option.label) : null
    void sendTracked(async () => {
      const result = await sendValue(current, option.value)
      if (result.ok && venture) {
        const me = getState().game?.players?.find((p) => p.controlled)?.name ?? ''
        recordDungeonRoom(current.gameId, me, venture.dungeon, venture.room)
      }
      return result
    }, t('errors', 'send_failed'), {
      gameId: current.gameId,
      mode: current.mode as 'boolean' | 'uuid' | 'string',
      value: option.value,
      prompt: current,
    })
  }

  const confirmSelected = () => {
    if (!prompt) return
    const current = prompt
    void sendTracked(async () => {
      let result: { ok: boolean; error?: string } = { ok: true }
      for (const value of selected) {
        result = await sendValue(current, value)
        if (!result.ok) break
      }
      return result
    }, t('errors', 'send_failed'), selected.length === 1
      ? {
          gameId: current.gameId,
          mode: current.mode as 'boolean' | 'uuid' | 'string',
          value: selected[0],
          prompt: current,
        }
      : null)
  }

  const confirmAmount = () => {
    if (!prompt) return
    if (prompt.mode === 'mana') {
      void send(() => cmds.sendPlayerManaType(prompt.gameId, prompt.playerId as string, String(amount)), t('errors', 'send_failed_mana'))
      return
    }
    void send(() => cmds.sendPlayerInteger(amount, prompt.gameId), t('errors', 'send_failed_amount'))
  }

  const confirmMultiAmount = () => {
    if (!prompt) return
    const values = (prompt.items ?? []).map((item) => {
      const value = Math.max(item.min, Math.min(item.max, multiAmounts[item.id] ?? item.min))
      return value
    })
    const total = values.reduce((sum, value) => sum + value, 0)
    if (total < prompt.min || total > prompt.max) {
      setStoreError(t('game', 'sum_between', { min: prompt.min, max: prompt.max }))
      return
    }
    void send(() => cmds.sendPlayerString(values.join(' '), prompt.gameId), t('errors', 'send_failed_amount'))
  }

  return {
    prompt,
    busy,
    queuedClick,
    amount,
    setAmount,
    selected,
    setSelected,
    multiAmounts,
    setMultiAmounts,
    textValue,
    setTextValue,
    filteredStringOptions,
    send,
    sendWithRetry,
    sendNow,
    cancel,
    finishOptionalTarget,
    selectOption,
    confirmSelected,
    confirmAmount,
    confirmMultiAmount,
  }
}