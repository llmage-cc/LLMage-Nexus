import type { GameEndInfo } from '../net/types'

export type EndTone = 'victory' | 'defeat' | 'neutral'

/** Which title the end dialog shows. */
export type EndVariant = 'spectator' | 'victory' | 'victory_forfeit' | 'defeat'

export interface EndDialogPresentation {
  tone: EndTone
  variant: EndVariant
  kickerIcon: 'trophy' | 'skull'
  /** i18n key (category `game`) for the dialog title. */
  titleKey: 'game_over' | 'victory' | 'victory_forfeit' | 'defeat'
  /** i18n key (category `game`) for the explanatory note, null when there is none. */
  noteKey: 'end_forfeit_note' | null
}

/**
 * Title/note rule for END_GAME_INFO, kept pure (no `t`, no store) so it is
 * testable at any seat count. `end.endReason` is the engine's per-viewer
 * reason (GameEndReason): only `llm_failure` means the game did not play out —
 * concede/timeout/idle/quit are ordinary defeats for the seat that dropped, so
 * the winner still sees a plain Victory (a click-concede is not a technical
 * failure). An absent reason (watcher, older server) keeps the pre-endReason
 * behavior exactly.
 *
 * Precedence: spectator > defeated > forfeit win > plain win.
 */
export function endDialogPresentation(
  end: GameEndInfo | null | undefined,
  isSpectator: boolean,
): EndDialogPresentation {
  if (isSpectator || !end) {
    return {
      tone: 'neutral',
      variant: 'spectator',
      kickerIcon: 'trophy',
      titleKey: 'game_over',
      noteKey: null,
    }
  }

  if (!end.won) {
    return { tone: 'defeat', variant: 'defeat', kickerIcon: 'skull', titleKey: 'defeat', noteKey: null }
  }

  if (end.endReason === 'llm_failure') {
    return {
      tone: 'victory',
      variant: 'victory_forfeit',
      kickerIcon: 'trophy',
      titleKey: 'victory_forfeit',
      noteKey: 'end_forfeit_note',
    }
  }

  return { tone: 'victory', variant: 'victory', kickerIcon: 'trophy', titleKey: 'victory', noteKey: null }
}
