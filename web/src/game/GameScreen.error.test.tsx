// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import GameScreen from './GameScreen'
import { getState, setState } from '../state/state'
import { reset } from '../state/store'
import { makeGameView, makePlayer } from '../__fixtures__/gameViews'
import type { GameView } from '../net/types'

/**
 * "A refused play shows its error":
 * the handler already called setStoreError on !result.ok, but store.error had
 * NO game-phase reader — the refusal never surfaced. This pins the screen
 * contract: a store error shows the `game-error` banner while a game is on.
 */

vi.mock('../net/commands', () => ({
  sendPlayerUUID: vi.fn().mockResolvedValue({ ok: true }),
  sendPlayerBoolean: vi.fn().mockResolvedValue({ ok: true }),
  sendPlayerAction: vi.fn().mockResolvedValue({ ok: true }),
  sendManaPaymentMode: vi.fn().mockResolvedValue({ ok: true }),
  updateManaConfirmPreference: vi.fn().mockResolvedValue({ ok: true }),
  updatePreferences: vi.fn().mockResolvedValue({ ok: true }),
  joinGame: vi.fn().mockResolvedValue(null),
  getGameChatId: vi.fn().mockResolvedValue(null),
  joinChat: vi.fn().mockResolvedValue(null),
  maybeAutoPass: vi.fn(),
  watchGame: vi.fn(),
}))

vi.mock('../audio/soundManager', () => ({
  soundManager: { play: vi.fn(), init: vi.fn(), setMusicVolume: vi.fn() },
}))
vi.mock('../audio/musicEngine', () => ({ musicEngine: { start: vi.fn(), stop: vi.fn(), setIntensity: vi.fn() } }))
vi.mock('./attentionAlerts', () => ({ useAttentionAlerts: vi.fn() }))
vi.mock('../board/useCustomPlaymat', () => ({ useCustomPlaymat: () => null }))
vi.mock('../audio/promptSound', () => ({ notifyFeedbackOpened: vi.fn() }))

function boardGame(): GameView {
  return makeGameView({
    players: [
      makePlayer({ playerId: 'me', name: 'Me', controlled: true, isActive: true, hasPriority: true }),
      makePlayer({ playerId: 'opp', name: 'Foe' }),
    ],
    myPlayerId: 'me',
    activePlayerId: 'me',
    activePlayerName: 'Me',
    priorityPlayerName: 'Me',
  })
}

describe('GameScreen — refused play surfaces its error', () => {
  beforeEach(() => {
    reset()
    setState({
      phase: 'game',
      gameId: 'g-1',
      game: boardGame(),
      playableIds: [],
      feedback: null,
      error: null,
    })
  })

  afterEach(() => {
    cleanup()
    reset()
  })

  it('without an error there is no banner', () => {
    render(<GameScreen />)
    expect(screen.queryByTestId('game-error')).toBeNull()
  })

  it('a store error raised by a refused send renders the banner (role=alert)', async () => {
    const { setStoreError } = await import('../state/store')
    render(<GameScreen />)
    act(() => {
      setStoreError('Not possible to play that card right now')
    })
    await waitFor(() => expect(screen.getByTestId('game-error')).toBeTruthy())
    const banner = screen.getByTestId('game-error')
    expect(banner.getAttribute('role')).toBe('alert')
    expect(banner.textContent).toContain('Not possible to play that card right now')
    // close clears the store error again
    const clear = banner.querySelector('.error-banner-close') as HTMLElement
    expect(clear).toBeTruthy()
    act(() => {
      clear.click()
    })
    await waitFor(() => expect(screen.queryByTestId('game-error')).toBeNull())
    expect(getState().error).toBeNull()
  })
})