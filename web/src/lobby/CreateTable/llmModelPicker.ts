import type { LlmListResult } from '../../net/commands'

/**
 * Loading/error/success state for the LLM list pickers (the Model and Personality
 * fields of a COMPUTER_LLM seat). Pure, so the transitions are unit-tested
 * without a live socket.
 *
 * The loading flag is cleared on BOTH a success and a FAILURE: the proxy answers
 * the list verbs with typed frames (`models_error` / `personalities_error`) and a
 * plain `result` on success, and a consumer that only cleared the flag on success
 * would spin forever after a rejected fetch. That is exactly why the typed frames
 * exist and why the generic `error` frame is never used here.
 */

export interface LlmListState {
  /** Fetched entries (models / personalities); empty until a successful fetch. */
  items: string[]
  loading: boolean
  /** Player-facing failure text, or null. Cleared on every new attempt. */
  error: string | null
}

export const initialLlmList: LlmListState = { items: [], loading: false, error: null }

export type LlmListAction =
  | { kind: 'start' }
  | { kind: 'success'; items: string[] }
  | { kind: 'error'; message: string }

/**
 * The picker state machine. `start` sets the loading flag; BOTH `success` and
 * `error` clear it — the pitfall this whole module exists to prevent.
 */
export function llmListReducer(state: LlmListState, action: LlmListAction): LlmListState {
  switch (action.kind) {
    case 'start':
      return { ...state, loading: true, error: null }
    case 'success':
      return { items: action.items, loading: false, error: null }
    case 'error':
      return { items: [], loading: false, error: action.message }
  }
}

/** Maps a list-verb answer (from `fetchLlmModels` / `fetchLlmPersonalities`) to an action. */
export function listActionFromResult(res: LlmListResult): LlmListAction {
  return res.ok
    ? { kind: 'success', items: res.items }
    : { kind: 'error', message: res.error || 'request failed' }
}

/** Any thrown value as a player-facing string (the verb wrappers never throw, but a caller may). */
export function listErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return String(error ?? 'request failed')
}
