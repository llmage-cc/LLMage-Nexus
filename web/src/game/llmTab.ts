import type { Capabilities } from '../state/slices/session'
import type { ReplayState } from '../state/slices/replay'
import type { GameView, LLMConversationView } from '../net/types'
import { replayLLMHistoryFor } from '../state/replay'

/**
 * The stable inputs the LLM tab reads: the connected server's feature flags and
 * the two boards the drawer can be looking at (a live game, a replay frame).
 */
export interface LlmTabSource {
  capabilities: Capabilities | null
  game: GameView | null
  replay: ReplayState | null
}

/**
 * The exact LLM-tab offer rule, mirroring `RightRail.visibleRightTabs`
 * (Mage.WebProxy/.../RightRail.tsx:41-52): the participant/public visibility
 * half plus the capability check.
 *
 *  - `capabilities.llm` false (stock server, old proxy, not connected) → never.
 *  - `hasLlmPlayers` false → never. On a LIVE board this is the root-level flag
 *    the serializer emits (unfiltered: true iff a game has an LLM seat). It is
 *    deliberately NOT derived from the per-viewer FILTERED `llmDebug.length`, which
 *    is empty for an opponent when the table is not llmChatPublic even though the
 *    game HAS LLM players.
 *  - otherwise the viewer must be allowed to see LLM chat: a seated participant,
 *    or a table the match marked `llmChatPublic`. A replay frame always sets
 *    `llmChatPublic` true (the match is over) so the replay path only needs the
 *    LLM-presence half.
 */
export function llmTabVisible(sig: {
  llmCapable: boolean
  hasLlmPlayers: boolean
  llmChatPublic: boolean
  isParticipant: boolean
}): boolean {
  if (!sig.llmCapable) return false
  if (!sig.hasLlmPlayers) return false
  return sig.llmChatPublic || sig.isParticipant
}

/**
 * Live LLM presence. The merged contract models `llmChatPublic` but not a live
 * `hasLlmPlayers`; the running proxy serializes the raw `GameView` fields with
 * JsonUtil reflection, where `llmDebug` is `null unless LLM players present`.
 * So when the flag is absent we fall back to that non-empty list (the raw field
 * is unfiltered on the proxy, unlike our own serializer's per-viewer list).
 */
export function liveHasLlmPlayers(game: GameView | null): boolean {
  if (!game) return false
  const flag = (game as { hasLlmPlayers?: unknown }).hasLlmPlayers
  if (typeof flag === 'boolean') return flag
  return (game.llmDebug?.length ?? 0) > 0
}

/** True when the viewer is a seated participant of the live game. */
export function isSeated(game: GameView | null): boolean {
  if (!game) return false
  if (game.myPlayerId != null) return true
  return game.players?.some((p) => p.controlled) === true
}

export function isLlmTabOffered(source: LlmTabSource): boolean {
  const inReplay = source.replay != null
  return llmTabVisible({
    llmCapable: source.capabilities?.llm === true,
    hasLlmPlayers: inReplay ? source.replay!.hasLlmPlayers === true : liveHasLlmPlayers(source.game),
    llmChatPublic: inReplay ? true : source.game?.llmChatPublic === true,
    isParticipant: inReplay ? false : isSeated(source.game),
  })
}

const EMPTY_VIEWS: LLMConversationView[] = []

/**
 * The conversation views the panel renders. Live: the frame's own `llmDebug`
 * (the wire already carries it — no slice, no fetch). Replay: the CUMULATIVE
 * view rebuilt by the merged replay helper, so scrubbing shows every exchange
 * recorded at or before the current frame.
 */
export function llmTabView(source: Pick<LlmTabSource, 'game' | 'replay'>): LLMConversationView[] {
  if (source.replay) return replayLLMHistoryFor(source.replay.llmFrames, source.replay.stateIndex)
  return source.game?.llmDebug ?? EMPTY_VIEWS
}

/**
 * How many of a conversation's messages the drawer renders at once. A LIVE frame is already
 * bounded on the wire (proxy {@code LlmDebugBounds.LLM_DEBUG_MAX_MESSAGES}, 40), so a trimmed live
 * conversation is never window-clipped; the window matters for the replay path, whose cumulative
 * history is unbounded. Rendering a bounded tail keeps the drawer responsive on a long
 * conversation.
 */
export const LLM_MESSAGE_WINDOW = 50

export interface MessageWindow {
  /** Index of the first rendered message. */
  start: number
  /** Index one past the last rendered message. */
  end: number
  /** How many messages at the front of the list are not rendered. */
  hiddenBefore: number
}

/**
 * The rendered slice of a conversation's messages: the LAST `shown` of them (newest kept visible,
 * so an ongoing stream keeps growing at the bottom). `shown` starts at {@link LLM_MESSAGE_WINDOW}
 * and grows by a page as the user asks for older messages, so a very long conversation never
 * renders every node at once.
 */
export function messageWindow(total: number, shown: number): MessageWindow {
  const visible = Math.max(0, Math.min(shown, total))
  const start = total - visible
  return { start, end: total, hiddenBefore: start }
}

export type LlmEmptyKey = 'llm_empty_private' | 'llm_empty_no_players' | 'llm_empty_replay'

/**
 * The empty-state key. `hasLlmPlayers` and the (possibly filtered) `llmDebug`
 * are different signals: an LLM game can legitimately have an empty list for this
 * viewer. So "no LLM players" is only claimed when the game truly has none;
 * otherwise the copy says the exchanges are not visible here yet.
 */
export function llmTabEmptyKey(source: LlmTabSource): LlmEmptyKey {
  if (source.replay) {
    return source.replay.hasLlmPlayers === false ? 'llm_empty_no_players' : 'llm_empty_replay'
  }
  return liveHasLlmPlayers(source.game) ? 'llm_empty_private' : 'llm_empty_no_players'
}

/**
 * The drawer tab the UI actually shows, given the user's stored choice — ports
 * `effectiveRightTab` (RightRail.tsx:65-74): a stored tab this board does not
 * offer is never shown. The drawer is a toggled dropdown, so the safe fallback
 * is "closed" (null) rather than an arbitrary other panel.
 */
export function effectiveDrawerTab<T extends string>(stored: T | null, offered: readonly T[]): T | null {
  if (stored == null) return null
  return offered.includes(stored) ? stored : null
}

const REASONING_FENCE_OPEN = '[model_reasoning]'
const REASONING_FENCE_CLOSE = '[/model_reasoning]'

/**
 * Split an assistant message into its visible answer and its reasoning, porting
 * `splitAssistantMessage` (RightRail.tsx:535-563). Two stored shapes exist:
 * a `[model_reasoning]…[/model_reasoning]` fence (a missing closing
 * fence keeps the rest as reasoning) and the legacy `Reasoning:` line. Non
 * assistant messages are never split.
 */
export function splitAssistantMessage(content: string, role: string): { decision: string; reasoning: string } {
  if (role !== 'assistant') return { decision: content, reasoning: '' }

  const openIdx = content.indexOf(REASONING_FENCE_OPEN)
  if (openIdx >= 0) {
    const decision = content.slice(0, openIdx).trimEnd()
    const afterOpen = content.slice(openIdx + REASONING_FENCE_OPEN.length)
    const closeIdx = afterOpen.indexOf(REASONING_FENCE_CLOSE)
    const reasoning = (closeIdx >= 0 ? afterOpen.slice(0, closeIdx) : afterOpen).trim()
    return { decision, reasoning }
  }

  const reasoningIdx = content.search(/^Reasoning:/im)
  if (reasoningIdx >= 0) {
    return { decision: content.slice(0, reasoningIdx).trimEnd(), reasoning: content.slice(reasoningIdx) }
  }
  return { decision: content, reasoning: '' }
}
