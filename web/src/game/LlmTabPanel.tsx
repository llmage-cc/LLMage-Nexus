import { useState } from 'react'
import { useStore } from '../state/store'
import { useTranslation } from '../i18n'
import EmptyState from '../ui/EmptyState'
import Button from '../ui/Button'
import type { LLMConversationView } from '../net/types'
import {
  isLlmTabOffered,
  llmTabView,
  llmTabEmptyKey,
  splitAssistantMessage,
  messageWindow,
  LLM_MESSAGE_WINDOW,
} from './llmTab'
import { downloadLlmTranscript } from './llmTranscript'
import './LlmTabPanel.css'

const REASONING_CHARS_CAP = 4000

/**
 * A long message's nested "Reasoning" row can land past the bottom edge of the
 * drawer's scroller: half-clipped, and at that position click-dead (the click
 * falls through to the board layer, so the reasoning can never be expanded).
 * Expanding the message must therefore bring that row into view.
 */
export function revealNestedSummary(message: HTMLDetailsElement): void {
  if (!message.open) return
  const nested = message.querySelector<HTMLElement>('details.llm-reasoning > summary')
  if (nested && typeof nested.scrollIntoView === 'function') nested.scrollIntoView({ block: 'nearest' })
}

function contextPercent(totalContextChars: number, modelContextWindow: number): number {
  return modelContextWindow > 0 ? Math.round((totalContextChars / (modelContextWindow * 2)) * 100) : 0
}

function LlmStreamingBox({ llm }: { llm: LLMConversationView }) {
  const { t } = useTranslation()
  if (!llm.streaming) return null
  const elapsed = llm.streamingStartedAt
    ? ((Date.now() - llm.streamingStartedAt) / 1000).toFixed(1)
    : null
  return (
    <div className="llm-streaming" data-testid="llm-streaming">
      <span className="llm-pulse">●</span> {t('game', 'llm_streaming')}
      {elapsed && <span className="llm-streaming-elapsed">{elapsed}s</span>}
      {llm.streamingReasoning && (
        <div className="llm-streaming-reasoning" data-testid="llm-streaming-reasoning">
          {llm.streamingReasoning}
        </div>
      )}
      {llm.streamingContent && (
        <div className="llm-streaming-content" data-testid="llm-streaming-content">
          {llm.streamingContent}
        </div>
      )}
    </div>
  )
}

function LlmPlayerBlock({ llm, gameId }: { llm: LLMConversationView; gameId: string | null }) {
  const { t } = useTranslation()
  const pct = contextPercent(llm.totalContextChars, llm.modelContextWindow)
  const messages = llm.messages ?? []
  const [shown, setShown] = useState(LLM_MESSAGE_WINDOW)
  const win = messageWindow(messages.length, shown)
  const visible = messages.slice(win.start, win.end)
  const wireHidden = llm.messagesHidden ?? 0

  return (
    <details className="llm-player" open data-testid="llm-player">
      <summary className="llm-player-summary">
        <span className="llm-player-name">{llm.playerName}</span>
        <span className="llm-player-model">{llm.modelName}</span>
      </summary>
      <div className="llm-player-body">
        <div className="llm-player-meta">
          <span>{t('game', 'llm_messages', { count: String(messages.length) })}</span>
          {llm.totalContextChars > 0 && (
            <span>
              {t('game', 'llm_context', { chars: String(llm.totalContextChars) })}
              {llm.modelContextWindow > 0 &&
                ` ${t('game', 'llm_context_window', { tokens: String(llm.modelContextWindow), percent: String(pct) })}`}
            </span>
          )}
          {/* The server writes its own transcript under an operator-owned path; this
              exports what THIS browser holds — untrimmed on the replay path, a trimmed
              tail live (the file then says PARTIAL). */}
          <Button
            variant="link"
            className="llm-transcript-download"
            data-testid="llm-download-transcript"
            onClick={() => downloadLlmTranscript(llm, { gameId })}
          >
            {t('game', 'llm_download_transcript')}
          </Button>
        </div>

        <LlmStreamingBox llm={llm} />

        {llm.gamePlan && (
          <details className="llm-section">
            <summary>{t('game', 'llm_section_gameplan')}</summary>
            <div className="llm-section-body">{llm.gamePlan}</div>
          </details>
        )}
        {llm.matchReview && (
          <details className="llm-section">
            <summary>{t('game', 'llm_section_matchreview')}</summary>
            <div className="llm-section-body">{llm.matchReview}</div>
          </details>
        )}

        {wireHidden > 0 && (
          <div className="llm-messages-hidden" data-testid="llm-messages-hidden">
            {t('game', 'llm_messages_hidden', { count: String(wireHidden) })}
          </div>
        )}

        <div className="llm-messages">
          {win.hiddenBefore > 0 && (
            <Button
              variant="link"
              className="llm-show-older"
              data-testid="llm-show-older"
              onClick={() => setShown((s) => s + LLM_MESSAGE_WINDOW)}
            >
              {t('game', 'llm_show_older', { count: String(win.hiddenBefore) })}
            </Button>
          )}
          {visible.map((msg, idx) => {
            const { decision, reasoning } = splitAssistantMessage(msg.content ?? '', msg.role)
            const preview = (msg.content ?? '').split('\n').find((l) => l.trim().length > 0)?.slice(0, 80) ?? ''
            const meta = msg.role === 'user'
              ? [msg.promptType, msg.turn != null ? `T${msg.turn}` : null, msg.phaseStep].filter(Boolean).join(' · ')
              : ''
            return (
              <details
                className={`llm-message llm-role-${msg.role || 'unknown'}`}
                key={win.start + idx}
                data-testid="llm-message"
                onToggle={(e) => revealNestedSummary(e.currentTarget)}
              >
                <summary className="llm-message-summary">
                  <span className="llm-role">{msg.role || '?'}</span>
                  {preview && <span className="llm-preview">{preview}{(msg.content ?? '').length > 80 ? '…' : ''}</span>}
                </summary>
                <div className="llm-message-body">
                  {meta && <div className="llm-message-meta">{meta}</div>}
                  <div className="llm-message-decision">{decision}</div>
                  {reasoning && (
                    <details className="llm-reasoning">
                      <summary>{t('game', 'llm_reasoning')}</summary>
                      <div className="llm-reasoning-body">
                        {reasoning.length > REASONING_CHARS_CAP ? reasoning.slice(0, REASONING_CHARS_CAP) + '…' : reasoning}
                      </div>
                    </details>
                  )}
                </div>
              </details>
            )
          })}
        </div>

        {llm.postGameReflection && (
          <details className="llm-section">
            <summary>{t('game', 'llm_section_postgame')}</summary>
            <div className="llm-section-body">{llm.postGameReflection}</div>
          </details>
        )}
      </div>
    </details>
  )
}

/**
 * The drawer's LLM chat/decision panel.
 *
 * Live: renders the current game frame's own `llmDebug` (the wire already carries
 * it — no fetch, no new slice). Replay: renders the cumulative conversation the
 * merged replay helper rebuilds for the current frame. Both paths are gated by
 * `isLlmTabOffered`; the panel renders nothing when the tab is not
 * offered so a stale active tab can never paint a panel.
 */
export default function LlmTabPanel() {
  const { t } = useTranslation()
  const capabilities = useStore((s) => s.capabilities)
  const game = useStore((s) => s.game)
  const storeGameId = useStore((s) => s.gameId)
  const replay = useStore((s) => s.replay)

  const source = { capabilities, game, replay }
  if (!isLlmTabOffered(source)) return null

  const gameId = replay ? replay.gameId : storeGameId

  const views = llmTabView(source)
  if (views.length === 0) {
    const key = llmTabEmptyKey(source)
    return (
      <div className="llm-tab" data-testid="llm-tab">
        <EmptyState fill italic icon="bot" iconSize={18} data-testid="llm-empty">
          {t('game', key)}
        </EmptyState>
      </div>
    )
  }

  return (
    <div className="llm-tab" data-testid="llm-tab">
      <div className="llm-tab-list scroll-pane">
        {views.map((llm, idx) => (
          <LlmPlayerBlock key={`${llm.playerName}-${idx}`} llm={llm} gameId={gameId} />
        ))}
      </div>
    </div>
  )
}
