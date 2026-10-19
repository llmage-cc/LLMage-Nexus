import { describe, expect, it } from 'vitest'
import { consolidatePlayables } from './gameUtils'
import type { FeedbackPrompt } from '../game/feedback'
import type { GameView } from '../net/types'
import { makeGameView, makePlayer } from '../__fixtures__/gameViews'

/**
 * Playables window regression:
 * the consolidation must not strand `playable` markers when a dialog-mode
 * prompt is open or the play window is gone — a stale marker makes the next
 * hand-card click send a play the server only refuses (now visible, but it
 * must not even fire knowingly).
 */

function landGame(objects: Record<string, unknown>, overrides: Partial<GameView> = {}): GameView {
  const view = makeGameView({
    players: [
      makePlayer({ playerId: 'me', name: 'Me', controlled: true, isActive: true, hasPriority: true }),
      makePlayer({ playerId: 'opp', name: 'Foe' }),
    ],
    myPlayerId: 'me',
    activePlayerId: 'me',
    myHand: { 'land-1': { id: 'land-1', name: 'Mountain', manaValue: 0, expansionSetCode: 'TEST', cardNumber: '0' } },
    ...overrides,
  })
  ;(view as unknown as { canPlayObjects: { objects: Record<string, unknown> } }).canPlayObjects = { objects }
  return view
}

function prompt(mode: FeedbackPrompt['mode'], overrides: Partial<FeedbackPrompt> = {}): FeedbackPrompt {
  return {
    method: 'GAME_ASK',
    gameId: 'g-1',
    title: 'P',
    message: 'Question?',
    mode,
    options: [],
    min: 0,
    max: 0,
    ...overrides,
  } as FeedbackPrompt
}

describe('consolidatePlayables — stale-window tightening', () => {
  it('a same turn+phase GAME_UPDATE without canPlayObjects keeps the previous ids (unchanged baseline)', () => {
    const game = landGame({}) // no objects on this push
    const out = consolidatePlayables(game, 'GAME_UPDATE', null, ['land-1'], { turn: 1, phase: 'MAIN' })
    expect(out.ids).toEqual(['land-1'])
  })

  it('a dialog-mode prompt open during the same-turn push CLEARS the stale playables', () => {
    const game = landGame({})
    // uuid prompt (mulligan/london/discard/target): a hand click belongs to THAT dialog
    const out = consolidatePlayables(game, 'GAME_UPDATE', prompt('uuid'), ['land-1'], { turn: 1, phase: 'MAIN' })
    expect(out.ids).toEqual([])
    expect(out.window).toBeNull()
  })

  it('boolean/string/integer prompts clear the playables too', () => {
    const game = landGame({})
    for (const mode of ['boolean', 'string', 'integer', 'multiString'] as const) {
      const out = consolidatePlayables(game, 'GAME_UPDATE', prompt(mode), ['land-1'], { turn: 1, phase: 'MAIN' })
      expect(out.ids, mode).toEqual([])
    }
  })

  it('mana-mode prompts keep the playables (mana payment clicks the board)', () => {
    const game = landGame({})
    const out = consolidatePlayables(game, 'GAME_UPDATE', prompt('mana'), ['land-1'], { turn: 1, phase: 'MAIN' })
    expect(out.ids).toEqual(['land-1'])
  })

  it('combat-mode prompts keep the playables (combat rides the board)', () => {
    const game = landGame({})
    const out = consolidatePlayables(game, 'GAME_UPDATE', prompt('combat'), ['land-1'], { turn: 1, phase: 'MAIN' })
    expect(out.ids).toEqual(['land-1'])
  })

  it('a fresh canPlayObjects push recomputes even with a dialog prompt open (server truth wins)', () => {
    const game = landGame({ 'land-1': { id: 'land-1' } })
    const out = consolidatePlayables(game, 'GAME_UPDATE', prompt('uuid'), ['land-1'], { turn: 1, phase: 'MAIN' })
    expect(out.ids).toEqual(['land-1'])
  })

  it('a fresh GAME_SELECT recomputes even with a dialog prompt open (the select may BE the choice set)', () => {
    const game = landGame({ 'land-1': { id: 'land-1' } })
    const out = consolidatePlayables(game, 'GAME_SELECT', prompt('uuid'), [], null)
    expect(out.ids).toEqual(['land-1'])
  })

  it('a spent window: a same-position GAME_UPDATE re-push does NOT carry the ids forward', () => {
    const game = landGame({})
    const out = consolidatePlayables(game, 'GAME_UPDATE', null, ['land-1'], { turn: 1, phase: 'MAIN' }, true)
    expect(out.ids).toEqual([])
    expect(out.window).toBeNull()
  })

  it('a spent window: a re-push WITH canPlayObjects does not re-mark either (only a new GAME_SELECT opens)', () => {
    const game = landGame({ 'land-1': { id: 'land-1' } })
    const out = consolidatePlayables(game, 'GAME_UPDATE', null, [], null, true)
    expect(out.ids).toEqual([])
    expect(out.window).toBeNull()
  })

  it('a spent window: a NEW GAME_SELECT re-marks (the ask re-opened the window)', () => {
    const game = landGame({ 'land-1': { id: 'land-1' } })
    const out = consolidatePlayables(game, 'GAME_SELECT', null, ['land-1'], { turn: 1, phase: 'MAIN' }, true)
    expect(out.ids).toEqual(['land-1'])
  })
})