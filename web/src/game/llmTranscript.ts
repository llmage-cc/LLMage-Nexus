import type { LLMConversationView } from '../net/types'
import { downloadBlob } from '../utils/download'
import { splitAssistantMessage } from './llmTab'

/**
 * Client-side LLM transcript export: the server writes its own .txt under
 * the operator's `transcriptDir`, which a player can neither set nor read; the
 * browser already holds the conversation — untrimmed for a replay.
 *
 * The file is a SIBLING of the server transcript, not a byte-copy: same
 * `player_model_transcript-<stamp>.txt` naming so the two can sit side by side,
 * and one section per stored message instead of the server's per-call grouping
 * (the wire carries a flat message list).
 */

export interface LlmTranscriptMeta {
  gameId: string | null
  /** Injectable clock; tests pin it. */
  now?: Date
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')

function stamp(now: Date): string {
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  )
}

/** Path-hostile characters (and the `:`/`/` the server truncates at) → single `_`. */
function fileSegment(value: string, fallback: string): string {
  const cleaned = value
    .replace(/[:/\\].*$/, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._]+|[._]+$/g, '')
  return cleaned.length > 0 ? cleaned.slice(0, 40) : fallback
}

export function llmTranscriptFilename(llm: LLMConversationView, now: Date = new Date()): string {
  const player = fileSegment(llm.playerName ?? '', 'player')
  const model = fileSegment(llm.modelName ?? '', 'model')
  return `${player}_${model}_transcript-${stamp(now)}.txt`
}

function messageSection(index: number, msg: LLMConversationView['messages'][number]): string {
  const role = msg.role || 'unknown'
  const meta = [msg.promptType, msg.turn != null ? `T${msg.turn}` : null, msg.phaseStep]
    .filter(Boolean)
    .join(' · ')
  const out: string[] = [
    '───────────────────────────────────────────────',
    `MESSAGE #${index + 1} (${role})`,
    '───────────────────────────────────────────────',
  ]
  if (meta) out.push(`[${meta}]`)
  const { decision, reasoning } = splitAssistantMessage(msg.content ?? '', role)
  out.push(decision)
  if (reasoning) out.push('', '--- REASONING ---', reasoning)
  if (msg.compactSummary) out.push('', '--- COMPACTED SUMMARY ---', msg.compactSummary)
  out.push('')
  return `${out.join('\n')}\n`
}

function labeledSection(title: string, body: string): string {
  return `--- ${title} ---\n${body}\n\n`
}

export function buildLlmTranscript(llm: LLMConversationView, meta: LlmTranscriptMeta): string {
  const now = meta.now ?? new Date()
  const messages = llm.messages ?? []
  const parts: string[] = [
    '=== LLM TRANSCRIPT (exported from the web client) ===',
    `Game: ${meta.gameId ?? 'unknown'}`,
    `Player: ${llm.playerName}`,
    `Model: ${llm.modelName}`,
    `Messages: ${messages.length}`,
    `Exchanges: ${llm.exchangeCount}`,
    `Exported: ${now.toISOString()}`,
  ]
  const hidden = llm.messagesHidden ?? 0
  if (hidden > 0) {
    parts.push(
      `PARTIAL: ${hidden} older message(s) were trimmed from this live view before it reached the browser.` +
        ' Open the finished game as a replay and export there for the full conversation.',
    )
  }
  parts.push('')
  if (llm.gamePlan) parts.push(labeledSection('DECK ASSESSMENT', llm.gamePlan))
  for (let i = 0; i < messages.length; i++) parts.push(messageSection(i, messages[i]))
  if (llm.matchReview) parts.push(labeledSection('MATCH REVIEW (for sideboarding)', llm.matchReview))
  if (llm.postGameReflection) parts.push(labeledSection('POST-GAME REFLECTION', llm.postGameReflection))
  return parts.join('\n')
}

/** Triggers the browser download. Returns false when the environment has no DOM. */
export function downloadLlmTranscript(llm: LLMConversationView, meta: LlmTranscriptMeta): boolean {
  const text = buildLlmTranscript(llm, meta)
  return downloadBlob(
    new Blob([text], { type: 'text/plain;charset=utf-8' }),
    llmTranscriptFilename(llm, meta.now),
  )
}
