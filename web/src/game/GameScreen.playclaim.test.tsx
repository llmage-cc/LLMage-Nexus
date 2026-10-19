// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import GameScreen from './GameScreen'
import { getState, reset, setState } from '../state/store'
import { makeCard, makeGameView, makePlayer } from '../__fixtures__/gameViews'
import * as cmds from '../net/commands'
import type { GameView } from '../net/types'

/**
 * Stale-playable-marker:
 * a hand-card play sent while THIS priority window's answer is already out
 * (a pass, a previous play) does not play — `HumanPlayer.waitResponseOpen`
 * parks it and the engine applies it at the NEXT ask. Live wire evidence:
 * the click returned ok:true with NO hand
 * change, and the same uuid played one main phase later.
 *
 * The fix: the play click shares the pass/auto-pass claim
 * (`claimPriorityAnswer`) and the click is dropped while the request is spent;
 * the carried playables stop re-marking a spent window
 * (`state/events/game.ts` → `consolidatePlayables(currentRequestSpent)`, pinned
 * in `state/gameUtils.playables.test.ts`).
 */

vi.mock('../net/commands', () => ({
  sendPlayerUUID: vi.fn().mockResolvedValue({ ok: true }),
  sendPlayerBoolean: vi.fn().mockResolvedValue({ ok: true }),
  sendPlayerString: vi.fn().mockResolvedValue({ ok: true }),
  sendPlayerInteger: vi.fn().mockResolvedValue({ ok: true }),
  sendPlayerManaType: vi.fn().mockResolvedValue({ ok: true }),
  sendPlayerAction: vi.fn().mockResolvedValue({ ok: true }),
  sendManaPaymentMode: vi.fn().mockResolvedValue({ ok: true }),
  updateManaConfirmPreference: vi.fn().mockResolvedValue({ ok: true }),
  updatePreferences: vi.fn().mockResolvedValue({ ok: true }),
  joinGame: vi.fn().mockResolvedValue(null),
  getGameChatId: vi.fn().mockResolvedValue(null),
  joinChat: vi.fn().mockResolvedValue(null),
  watchGame: vi.fn(),
}))

vi.mock('../audio/soundManager', () => ({
  soundManager: { play: vi.fn(), init: vi.fn(), setMusicVolume: vi.fn() },
}))
vi.mock('../audio/musicEngine', () => ({ musicEngine: { start: vi.fn(), stop: vi.fn(), setIntensity: vi.fn() } }))
vi.mock('./attentionAlerts', () => ({ useAttentionAlerts: vi.fn() }))
vi.mock('../appearance/customPlaymat', () => ({ useCustomPlaymat: () => null }))
vi.mock('../audio/promptSound', () => ({ notifyFeedbackOpened: vi.fn() }))

function landGame(): GameView {
  return makeGameView({
    players: [
      makePlayer({ playerId: 'me', name: 'Me', controlled: true, isActive: true, hasPriority: true, handCount: 1 }),
      makePlayer({ playerId: 'opp', name: 'Foe' }),
    ],
    myPlayerId: 'me',
    myHand: { 'h-1': makeCard({ name: 'Mountain', parentId: 'h-1' }) },
    activePlayerId: 'me',
    activePlayerName: 'Me',
    priorityPlayerName: 'Me',
  })
}

describe('GameScreen — a hand-card play claims the priority window', () => {
  beforeEach(() => {
    reset()
    vi.clearAllMocks()
    setState({
      phase: 'game',
      gameId: 'g-1',
      game: landGame(),
      playableIds: ['h-1'],
      feedback: null,
      error: null,
    })
  })

  afterEach(() => {
    cleanup()
    reset()
  })

  it('the FIRST click on a playable hand card sends the play (unclaimed window)', async () => {
    const { container } = render(<GameScreen />)
    const card = container.querySelector<HTMLElement>('[data-testid="hand-bar"] [data-card-id="h-1"]')
    expect(card).not.toBeNull()
    fireEvent.click(card!)
    await waitFor(() => expect(cmds.sendPlayerUUID).toHaveBeenCalledWith('h-1', 'g-1'))
  })

  it('a SECOND play from the SAME window is dropped (the answer is already out)', async () => {
    // The window was answered by a pass (the dock button): the claim is out.
    const { claimPriorityAnswer } = await import('../state/store')
    expect(claimPriorityAnswer()).toBe(true)
    const { container } = render(<GameScreen />)
    const card = container.querySelector<HTMLElement>('[data-testid="hand-bar"] [data-card-id="h-1"]')
    expect(card).not.toBeNull()
    fireEvent.click(card!)
    await Promise.resolve()
    expect(cmds.sendPlayerUUID).not.toHaveBeenCalled()
  })

  it('a NEW GAME_SELECT (new priorityRequest identity) re-arms the play click', async () => {
    const { claimPriorityAnswer } = await import('../state/store')
    expect(claimPriorityAnswer()).toBe(true)
    // A fresh GAME_SELECT arrives (the engine re-asks after the pass resolved):
    // a new frame identity re-opens the request, so a play can go out again.
    const fresh = landGame()
    setState({ priorityRequest: fresh })
    // the claim compares identity: the new request is NOT the answered one
    const spent = getState().priorityAnsweredRequest
    expect(getState().priorityRequest).not.toBe(spent)
    const { container } = render(<GameScreen />)
    const card = container.querySelector<HTMLElement>('[data-testid="hand-bar"] [data-card-id="h-1"]')
    fireEvent.click(card!)
    await waitFor(() => expect(cmds.sendPlayerUUID).toHaveBeenCalledWith('h-1', 'g-1'))
  })
})