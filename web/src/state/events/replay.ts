import { setState, addLog, getState } from '../state'
import { t as tStatic } from '../../i18n'
import { gameViewFrom } from '../gameUtils'
import { applyReplayFrame, applyReplayDone } from '../slices/replay'
import { classifyReplayDone } from '../replay'
import { setStoreError } from '../actions'
import { startReplay } from '../../net/commands'

/**
 * REPLAY_GAME — the server created a replay session for `objectId`. Open the
 * viewer immediately (a loaded-but-not-started replay is a dead screen) and ask
 * the server for the first frame.
 */
export function handleReplayGame(objectId: string | null): void {
  if (!objectId) return
  const s = getState()
  const base = s.replay && s.replay.gameId === objectId ? s.replay : null
  setState({
    replay: {
      gameId: objectId,
      frame: base?.frame ?? null,
      stateIndex: base?.stateIndex ?? -1,
      stateCount: base?.stateCount ?? -1,
      frameCount: 0,
      playing: true,
      done: null,
      llmFrames: base?.llmFrames ?? [],
      gameLog: base?.gameLog ?? [],
      hasLlmPlayers: base?.hasLlmPlayers ?? null,
      // Same replay re-announced keeps the viewer's "view as" pick; a newly opened
      // replay starts at the automatic default.
      perspectivePlayerId: base?.perspectivePlayerId ?? null,
    },
  })
  addLog('replay', tStatic('game', 'replay_log_loading', { id: objectId.slice(0, 8) }))
  void startReplay(objectId)
}

/**
 * REPLAY_INIT / REPLAY_UPDATE — a new frame. The full GameView paints the board
 * through the normal GameScreen path (exactly like the gallery) and also feeds
 * the replay slice (index/count, LLM buckets, log slice).
 */
export function handleReplayUpdate(objectId: string | null, data: unknown): void {
  const gv = gameViewFrom(data)
  if (!gv) return
  const s = getState()
  const gameId = objectId ?? s.gameId ?? ''
  const prior = s.replay && s.replay.gameId === gameId ? s.replay : null
  const replay = applyReplayFrame(prior, gameId, gv, {
    replayStateIndex: typeof gv.replayStateIndex === 'number' ? gv.replayStateIndex : undefined,
    replayStateCount: typeof gv.replayStateCount === 'number' ? gv.replayStateCount : undefined,
    llmDebug: gv.llmDebug,
    replayLLMBuckets: gv.replayLLMBuckets,
    replayGameLog: gv.replayGameLog,
    replayGameLogCount: gv.replayGameLogCount,
  })
  setState({ game: gv, gameId: gameId || s.gameId, phase: 'game', replay })
}

/**
 * REPLAY_DONE — classify the `data` string: "end of replay" is a
 * boundary (keep the board, allow stepping back), "stopped replay" exits to the
 * lobby, anything else is an error surfaced through the existing error banner.
 */
export function handleReplayDone(objectId: string | null, data: unknown): void {
  const s = getState()
  const { reason, result } = classifyReplayDone(data)
  const replay = applyReplayDone(s.replay, objectId, data)
  if (reason === 'boundary') {
    addLog('replay', result || tStatic('game', 'replay_boundary'))
    setState({ replay })
    return
  }
  if (reason === 'error') {
    setStoreError(result || 'Replay error')
  } else {
    addLog('replay', result || tStatic('game', 'replay_log_stopped'))
  }
  if (replay) {
    setState({ replay })
    return
  }
  // Stopped: leave the viewer back to the lobby.
  setState({
    replay: null,
    phase: 'lobby',
    game: null,
    gameId: null,
    playableIds: [],
    playableWindow: null,
    combat: null,
    feedback: null,
  })
}
