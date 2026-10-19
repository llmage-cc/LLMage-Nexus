import type { LLMConversationView } from '../net/types'

/**
 * One frame's LLM conversation data, retained as it arrived.
 *
 * A replay frame carries only the exchanges recorded at ITS OWN state index, so
 * the cumulative "conversation as of frame N" view is rebuilt client-side by a
 * pure filter over the accumulated per-index buckets (replayLLMHistoryFor).
 */
export interface ReplayLLMFrame {
  /** The frame's true position in the saved game (server-sent replayStateIndex). */
  stateIndex: number
  /** The frame's own llmDebug (or a skipped-range bucket) — never an empty list. */
  entries: LLMConversationView[]
}

/** A raw replay GameView frame's replay/LLM fields, as they arrive on the wire. */
export interface ReplayFrameInput {
  replayStateIndex?: number
  replayStateCount?: number
  llmDebug?: LLMConversationView[]
  replayLLMBuckets?: Record<string, { entries: LLMConversationView[] }> | null
  replayGameLog?: string[]
  replayGameLogCount?: number
}

/** Playback tick interval — one frame per second, matching the desktop ReplayTask. */
export const REPLAY_TICK_MS = 1000

/** How many frames the skip-forward button advances (desktop uses 10). */
export const REPLAY_SKIP_MOVES = 10

export type ReplayDoneReason = 'boundary' | 'stopped' | 'error'

/**
 * The log lines to render for a replay frame: entries 0..count-1 of the saved
 * game's final log, where `count` is the server-reported per-frame count (flat
 * capture: every frame carries the same complete log plus the number of entries
 * that existed at that frame). Empty when the frame carries no log (a save
 * written before log capture).
 */
export function replayLogSliceFor(frame: ReplayFrameInput | null): string[] {
  const log = frame?.replayGameLog
  if (!log || log.length === 0) return []
  const count = frame?.replayGameLogCount ?? log.length
  return log.slice(0, Math.max(0, Math.min(count, log.length)))
}

/**
 * Accumulate a replay frame's LLM buckets into the per-index store, idempotently.
 *
 * The frame's own `llmDebug` is keyed at its true state index and overwrites any
 * prior entry with that key (a re-delivered frame replaces its own key, so no
 * duplicates on any path). A forward jump (skip / seek) delivers ONE frame plus
 * the buckets of the indices in between; each bucket is merged under its own
 * index with the same overwrite rule.
 */
export function mergeReplayLLMFrames(
  prior: ReplayLLMFrame[],
  frame: ReplayFrameInput,
  fallbackIndex: number,
): ReplayLLMFrame[] {
  const idx = typeof frame.replayStateIndex === 'number' ? frame.replayStateIndex : fallbackIndex
  let next = prior.filter((f) => f.stateIndex !== idx)
  if (frame.llmDebug && frame.llmDebug.length > 0) {
    next = [...next, { stateIndex: idx, entries: frame.llmDebug }]
  }
  const buckets = frame.replayLLMBuckets
  if (buckets && typeof buckets === 'object') {
    const bucketIndexes = new Set(Object.keys(buckets).map((k) => Number(k)))
    const kept = next.filter((f) => !bucketIndexes.has(f.stateIndex))
    for (const [key, bucket] of Object.entries(buckets)) {
      const stateIndex = Number(key)
      if (bucket?.entries && bucket.entries.length > 0) {
        kept.push({ stateIndex, entries: bucket.entries })
      }
    }
    next = kept
  }
  return next
}

/**
 * The cumulative LLM conversation view for a replay frame — every exchange
 * recorded at or before `cursor`, ordered by frame, merged per player name.
 *
 * Ordered by frame index and filtered to `stateIndex <= cursor`, so scrubbing
 * backward drops the later exchanges and forward re-adds them; the cursor filter
 * makes seeking O(1) (no replay of the frame stream).
 *
 * System-prompt dedupe: the server attaches the game's system prompt as the
 * LEADING message of every bucket it emits (so any single frame is
 * self-sufficient). The cumulative merge therefore keeps only the FIRST system
 * message per player, or the merged view would interleave the same system prompt
 * between every exchange.
 */
export function replayLLMHistoryFor(
  frames: ReplayLLMFrame[],
  cursor: number,
): LLMConversationView[] {
  const ordered = [...frames]
    .filter((f) => f.stateIndex <= cursor)
    .sort((a, b) => a.stateIndex - b.stateIndex)
  const byPlayer = new Map<string, LLMConversationView>()
  const seenSystem = new Set<string>()
  for (const frame of ordered) {
    for (const entry of frame.entries) {
      const prev = byPlayer.get(entry.playerName)
      let incoming = entry.messages
      if (seenSystem.has(entry.playerName)) {
        incoming = incoming.filter((m) => m.role !== 'system')
      } else if (incoming.some((m) => m.role === 'system')) {
        seenSystem.add(entry.playerName)
      }
      byPlayer.set(entry.playerName, prev
        ? { ...prev, messages: [...prev.messages, ...incoming] }
        : { ...entry, messages: [...incoming] })
    }
  }
  return [...byPlayer.values()]
}

/**
 * Classify a REPLAY_DONE `data` string: "end of replay" is the
 * boundary (the session survives, so the board stays and stepping back works);
 * "stopped replay" is a user stop (leave the viewer); anything else is an error
 * to surface through the error banner.
 */
export function classifyReplayDone(data: unknown): { reason: ReplayDoneReason; result: string } {
  const result = typeof data === 'string'
    ? data
    : (data as { message?: string } | null)?.message ?? ''
  const lower = result.toLowerCase()
  if (lower.includes('end of replay')) return { reason: 'boundary', result }
  if (lower.includes('stopped replay')) return { reason: 'stopped', result }
  return { reason: 'error', result: result || 'Replay error' }
}
