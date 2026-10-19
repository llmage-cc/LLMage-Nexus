import type { GameView } from '../../net/types'
import type { ReplayLLMFrame, ReplayFrameInput, ReplayDoneReason } from '../replay'
import { mergeReplayLLMFrames, replayLogSliceFor, classifyReplayDone } from '../replay'

/**
 * Replay viewer mode. Non-null while a saved game is being replayed; the board
 * it paints is the same `game` GameView fed to GameScreen, so everything that
 * keys off `replay` (viewer chrome, transition/sound/alert suppression,
 * player-action belt-and-braces) reads its presence, not its contents.
 */
export interface ReplaySlice {
  replay: ReplayState | null
}

export interface ReplayState {
  /** Game id of the loaded replay (from REPLAY_GAME / REPLAY_INIT). */
  gameId: string
  /** Full GameView of the current frame (mirrors `game`); null until the first frame. */
  frame: GameView | null
  /** True position in the saved state list (server replayStateIndex). */
  stateIndex: number
  /** Total states in the saved game (server replayStateCount); -1 when absent. */
  stateCount: number
  /** Frame counter — increments on every INIT/UPDATE (position may move back). */
  frameCount: number
  /** True while playback is running (the play button's 1 s timer). */
  playing: boolean
  /** Last REPLAY_DONE classification; 'boundary' keeps the session alive. */
  done: { reason: ReplayDoneReason; result: string } | null
  /** Per-index LLM buckets, accumulated idempotently as frames arrive. */
  llmFrames: ReplayLLMFrame[]
  /** Game-log lines to render for THIS frame (0..gameLogCount-1 of the frame log). */
  gameLog: string[]
  /** Frame-independent "this replay's game has an LLM seat" flag (null = unknown). */
  hasLlmPlayers: boolean | null
  /**
   * Explicit "view as" seat picked in the replay chrome (a `PlayerView.playerId`),
   * or null/absent for the automatic default (the username-matching seat, else the
   * first seat). Session-scoped: opening a replay starts at the default, and the
   * choice survives frame updates. An id that names no seat in the frame falls back
   * to the default — never to a blank board.
   */
  perspectivePlayerId?: string | null
}

export const initialReplay: ReplaySlice = {
  replay: null,
}

/** The replay a REPLAY_INIT/REPLAY_UPDATE frame opens or advances. */
export function applyReplayFrame(
  prior: ReplayState | null,
  gameId: string,
  gv: GameView,
  input: ReplayFrameInput,
): ReplayState {
  // A different replay id starts a fresh accumulator; the same id (or the first
  // frame) keeps whatever buckets already arrived.
  const sameReplay = prior != null && prior.gameId === gameId
  const frameCount = sameReplay ? prior.frameCount + 1 : 1
  const fallbackIndex = typeof input.replayStateIndex === 'number' ? input.replayStateIndex : -1
  const llmFrames = mergeReplayLLMFrames(sameReplay ? prior.llmFrames : [], input, fallbackIndex)
  return {
    gameId,
    frame: gv,
    stateIndex: fallbackIndex,
    stateCount: typeof input.replayStateCount === 'number' ? input.replayStateCount : -1,
    frameCount,
    playing: sameReplay ? prior.playing : false,
    // A frame arriving proves the replay is alive: clear a prior boundary notice
    // (the user stepped back from the end, or forward past a marker).
    done: null,
    llmFrames,
    gameLog: replayLogSliceFor(input),
    hasLlmPlayers: typeof gv.replayHasLlmPlayers === 'boolean'
      ? gv.replayHasLlmPlayers
      : (sameReplay ? prior.hasLlmPlayers : null),
    // The "view as" pick is per open replay: a different replay starts at the
    // automatic default, frame updates within the same replay keep the choice.
    perspectivePlayerId: sameReplay ? (prior.perspectivePlayerId ?? null) : null,
  }
}

/** REPLAY_DONE classification → next slice (boundary keeps the board). */
export function applyReplayDone(
  prior: ReplayState | null,
  gameId: string | null,
  data: unknown,
): ReplayState | null {
  const { reason, result } = classifyReplayDone(data)
  if (reason === 'boundary') {
    // The session stays alive server-side; keep the viewer open, stop playback.
    if (!prior) return null
    return { ...prior, playing: false, done: { reason, result } }
  }
  // 'stopped' or 'error': the session is over — leave the viewer.
  void gameId
  return null
}
