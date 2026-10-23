import { describe, expect, it } from 'vitest'
import { endDialogPresentation } from './endDialogPresentation'
import { makePlayer } from '../__fixtures__/gameViews'
import type { GameEndInfo } from '../net/types'

/** A 4-seat (Commander) table: the seat count must not change the rule. */
function fourSeats(): GameEndInfo['players'] {
  return ['p-hero', 'p-llm-a', 'p-llm-b', 'p-llm-c'].map((playerId) =>
    makePlayer({ playerId, name: playerId }),
  )
}

describe('endDialogPresentation', () => {
  it('llm_failure + won at a 4-player table -> forfeit victory', () => {
    const p = endDialogPresentation(
      { won: true, endReason: 'llm_failure', players: fourSeats() },
      false,
    )
    expect(p).toEqual({
      tone: 'victory',
      variant: 'victory_forfeit',
      kickerIcon: 'trophy',
      titleKey: 'victory_forfeit',
      noteKey: 'end_forfeit_note',
    })
  })

  it('llm_failure + lost -> plain defeat (the failing seat does not forfeit the opponent)', () => {
    const p = endDialogPresentation({ won: false, endReason: 'llm_failure' }, false)
    expect(p.variant).toBe('defeat')
    expect(p.tone).toBe('defeat')
    expect(p.kickerIcon).toBe('skull')
    expect(p.titleKey).toBe('defeat')
    expect(p.noteKey).toBeNull()
  })

  it.each(['concede', 'timeout', 'idle', 'quit', 'unknown'])(
    'endReason %s + won -> ordinary victory, no forfeit note',
    (endReason) => {
      const p = endDialogPresentation({ won: true, endReason }, false)
      expect(p).toEqual({
        tone: 'victory',
        variant: 'victory',
        kickerIcon: 'trophy',
        titleKey: 'victory',
        noteKey: null,
      })
    },
  )

  it('absent/undefined endReason + won -> ordinary victory (older server)', () => {
    for (const end of [{ won: true }, { won: true, endReason: undefined }, undefined] as const) {
      const p = endDialogPresentation(end, false)
      if (end === undefined) {
        // No payload at all: the dialog cannot claim a seated result.
        expect(p.variant).toBe('spectator')
        continue
      }
      expect(p.variant).toBe('victory')
      expect(p.titleKey).toBe('victory')
      expect(p.noteKey).toBeNull()
    }
  })

  it('spectator -> neutral Game Over, even if the payload carries a reason', () => {
    for (const end of [
      { won: true, endReason: 'llm_failure' },
      { won: false, endReason: 'concede' },
    ]) {
      const p = endDialogPresentation(end, true)
      expect(p).toEqual({
        tone: 'neutral',
        variant: 'spectator',
        kickerIcon: 'trophy',
        titleKey: 'game_over',
        noteKey: null,
      })
    }
  })
})
