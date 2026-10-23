import { useEffect } from 'react'
import { useStore } from '../state/store'
import { useTranslation } from '../i18n'
import Button from '../ui/Button'
import * as cmds from '../net/commands'
import { setReplayPlaying, setReplayPerspective, exitReplay } from '../state/actions'
import { REPLAY_SKIP_MOVES, REPLAY_TICK_MS } from '../state/replay'
import { pickPerspectivePlayer } from '../board/useBoardPresenter'
import { isTypingTarget, replayDialogOpen, replayHotkey } from './replayHotkeys'
import './ReplayControls.css'

/**
 * Replay viewer chrome — Prev / Play·Pause / Next / Skip / Stop plus a position
 * control. Playback is step-driven: Play runs a 1 s interval of replayNext and
 * the server's REPLAY_UPDATE is what advances the board (never a local cursor),
 * so a slow frame cannot desync the viewer.
 *
 * Rendered whenever a replay is open. Only the position scrubber needs a
 * capability: `replayScrubber` gates the fork-only seek RPC, while
 * Prev / Play / Next / Skip / Stop work on any server that serves a replay.
 */
export default function ReplayControls() {
  const { t } = useTranslation()
  const replay = useStore((s) => s.replay)
  const capabilities = useStore((s) => s.capabilities)
  const username = useStore((s) => s.conn?.username ?? null)

  const gameId = replay?.gameId ?? null
  const playing = replay?.playing ?? false
  const stateIndex = replay?.stateIndex ?? -1
  const stateCount = replay?.stateCount ?? -1
  const done = replay?.done ?? null
  const frameCount = replay?.frameCount ?? 0
  const hasFrame = !!replay?.frame

  // Playback timer: one replayNext per second; the server's frame advances the
  // board. Re-arms only when `playing` or the game id flips.
  useEffect(() => {
    if (!playing || !gameId) return
    const id = setInterval(() => void cmds.replayNext(gameId), REPLAY_TICK_MS)
    return () => clearInterval(id)
  }, [playing, gameId])

  // Keyboard: Space toggles play/pause, arrows step, Escape exits. Stand down
  // while typing in a field or while a modal dialog is open.
  useEffect(() => {
    if (!gameId) return
    const onKeydown = (e: KeyboardEvent) => {
      const action = replayHotkey(e.key, { typing: isTypingTarget(e.target), dialogOpen: replayDialogOpen() })
      if (!action) return
      e.preventDefault()
      if (action === 'play') setReplayPlaying(!playing)
      else if (action === 'next') void cmds.replayNext(gameId)
      else if (action === 'previous') void cmds.replayPrevious(gameId)
      else if (action === 'exit') exitReplay()
    }
    window.addEventListener('keydown', onKeydown)
    return () => window.removeEventListener('keydown', onKeydown)
  }, [gameId, playing])

  if (!replay) return null

  const canSeek = capabilities?.replayScrubber === true
  const lastIndex = stateCount > 0 ? stateCount - 1 : 0
  const sliderValue = Math.min(Math.max(stateIndex, 0), lastIndex)
  const disabled = !hasFrame

  // "View as" seats: the frame's players, one button each. The default (no pick)
  // is resolved by the same helper the board uses, so the highlighted seat always
  // matches the side actually rendered as own; an unknown/absent pick falls back
  // there too (never a blank board).
  const seats = replay.frame?.players ?? []
  const activeSeat = seats.length > 0
    ? pickPerspectivePlayer(seats, {
        replay: true,
        username,
        perspectivePlayerId: replay.perspectivePlayerId ?? null,
      })
    : undefined

  return (
    <div className="replay-controls" data-testid="replay-controls">
      <Button variant="secondary" size="sm" disabled={disabled} onClick={() => void cmds.replayPrevious(replay.gameId)} title={t('game', 'replay_prev')}>
        {'⏮ '}{t('game', 'replay_prev')}
      </Button>
      <Button variant="primary" size="sm" disabled={disabled} onClick={() => setReplayPlaying(!playing)} title={t('game', playing ? 'replay_pause' : 'replay_play')} data-testid="replay-play">
        {playing ? '⏸ ' : '▶ '}{t('game', playing ? 'replay_pause' : 'replay_play')}
      </Button>
      <Button variant="secondary" size="sm" disabled={disabled} onClick={() => void cmds.replayNext(replay.gameId)} title={t('game', 'replay_next')}>
        {'⏭ '}{t('game', 'replay_next')}
      </Button>
      <Button variant="secondary" size="sm" disabled={disabled} onClick={() => void cmds.replaySkipForward(replay.gameId, REPLAY_SKIP_MOVES)} title={t('game', 'replay_skip', { count: String(REPLAY_SKIP_MOVES) })}>
        {'⏩ '}{t('game', 'replay_skip', { count: String(REPLAY_SKIP_MOVES) })}
      </Button>
      <Button variant="danger" size="sm" onClick={exitReplay} title={t('game', 'replay_stop')} data-testid="replay-stop">
        {'⏹ '}{t('game', 'replay_stop')}
      </Button>
      {seats.length > 1 && (
        <div className="replay-perspective" data-testid="replay-perspective" role="group" aria-label={t('game', 'you')}>
          <span className="replay-perspective-label">{t('game', 'you')}</span>
          {seats.map((p) => {
            const isActive = p.playerId === activeSeat?.playerId
            return (
              <Button
                key={p.playerId}
                variant={isActive ? 'primary' : 'secondary'}
                size="sm"
                aria-pressed={isActive}
                title={p.name}
                data-seat-id={p.playerId}
                data-testid={`replay-perspective-${p.playerId}`}
                onClick={() => setReplayPerspective(p.playerId)}
              >
                {p.name}
              </Button>
            )
          })}
        </div>
      )}
      {done?.reason === 'boundary' && (
        <span className="replay-boundary" data-testid="replay-boundary">{t('game', 'replay_boundary')}</span>
      )}
      {canSeek && (
        <div className="replay-scrubber">
          <input
            type="range"
            className="replay-scrubber-range"
            min={0}
            max={lastIndex}
            step={1}
            value={sliderValue}
            disabled={disabled || stateCount <= 0}
            onChange={(e) => void cmds.replaySeek(replay.gameId, Number(e.currentTarget.value))}
            aria-label={t('game', 'replay_position')}
            data-testid="replay-scrubber"
          />
          <span className="replay-scrubber-label" data-testid="replay-scrubber-label">
            {hasFrame
              ? stateCount > 0
                ? t('game', 'replay_position_label', { current: String(sliderValue + 1), total: String(stateCount) })
                : t('game', 'replay_frame', { frame: String(frameCount) })
              : ''}
          </span>
        </div>
      )}
      {!hasFrame && <span className="replay-loading" data-testid="replay-loading">{t('game', 'replay_loading')}</span>}
    </div>
  )
}
