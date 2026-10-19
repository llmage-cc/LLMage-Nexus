// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import GameScreen from './GameScreen'
import { getState, reset, setState } from '../state/store'
import { makeCard, makeGameView, makePlayer } from '../__fixtures__/gameViews'
import * as cmds from '../net/commands'
import type { GameView } from '../net/types'
import type { FeedbackPrompt } from './feedback'

/**
 * "Hand-card clicks are a no-op while a card-choice prompt is open".
 *
 * Live-proven: with a required
 * uuid-mode card-choice prompt open (cleanup "Choose a card to discard"), the
 * hand strip paints the legal card as `targetable` but a real pointer click
 * sends ZERO wire frames, so the board can never answer the prompt — only the
 * dock/grid path works.
 *
 * Source anchor (GameScreen.tsx:231): `onPlayableClick` drops the click for any
 * feedback mode other than mana/combat. The hand strip routes EVERY hand card
 * click through `onPlayableClick` (GameBoard handBar.onCardClick), so a
 * targetable hand card that is a legal answer never reaches the choice verb.
 *
 * The dialog grid answers the same prompt with `sendPlayerUUID(cardId)` — the
 * hand click must reach that same verb.
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
  maybeAutoPass: vi.fn(),
  watchGame: vi.fn(),
}))

vi.mock('../audio/soundManager', () => ({
  soundManager: { play: vi.fn(), init: vi.fn(), setMusicVolume: vi.fn() },
}))
vi.mock('../audio/musicEngine', () => ({ musicEngine: { start: vi.fn(), stop: vi.fn(), setIntensity: vi.fn() } }))
vi.mock('./attentionAlerts', () => ({ useAttentionAlerts: vi.fn() }))
vi.mock('../appearance/customPlaymat', () => ({ useCustomPlaymat: () => null }))
vi.mock('../audio/promptSound', () => ({ notifyFeedbackOpened: vi.fn() }))

function boardGame(): GameView {
  return makeGameView({
    players: [
      makePlayer({ playerId: 'me', name: 'Me', controlled: true, isActive: true, hasPriority: true, handCount: 1 }),
      makePlayer({ playerId: 'opp', name: 'Foe' }),
    ],
    myPlayerId: 'me',
    myHand: { 'h-1': makeCard({ name: 'Grizzly Bears', parentId: 'h-1' }) },
    activePlayerId: 'me',
    activePlayerName: 'Me',
    priorityPlayerName: 'Me',
  })
}

/** The cleanup discard: a required uuid-mode GAME_TARGET whose only legal
 *  candidate is a card in the controller's hand. */
function discardPrompt(): FeedbackPrompt {
  return {
    method: 'GAME_TARGET',
    gameId: 'g-1',
    title: 'Discard',
    message: 'Choose a card to discard',
    mode: 'uuid',
    options: [{ id: 'h-1', label: 'Grizzly Bears', value: 'h-1' }],
    min: 1,
    max: 1,
    required: true,
    cards: [{ id: 'h-1', name: 'Grizzly Bears' }],
  }
}

function plainBooleanPrompt(): FeedbackPrompt {
  return {
    method: 'GAME_ASK',
    gameId: 'g-1',
    title: 'Confirm',
    message: 'Pay 2 life?',
    mode: 'boolean',
    options: [
      { id: 'yes', label: 'Yes', value: 'true' },
      { id: 'no', label: 'No', value: 'false' },
    ],
    min: 0,
    max: 1,
    required: true,
  }
}

describe('GameScreen — hand-card click answers a card-choice prompt', () => {
  beforeEach(() => {
    reset()
    vi.clearAllMocks()
    setState({
      phase: 'game',
      gameId: 'g-1',
      game: boardGame(),
      playableIds: ['h-1'],
      feedback: null,
      error: null,
    })
  })

  afterEach(() => {
    cleanup()
    reset()
  })

  it('a targetable hand card click sends the choice verb (sendPlayerUUID) while a uuid prompt is open', async () => {
    setState({ feedback: discardPrompt() })
    const { container } = render(<GameScreen />)

    const card = container.querySelector<HTMLElement>('[data-testid="hand-bar"] [data-card-id="h-1"]')
    expect(card).not.toBeNull()
    // The legal answer is painted as a target (the class the live repro saw).
    expect(card!.className).toContain('targetable')

    fireEvent.click(card!)
    await waitFor(() => expect(cmds.sendPlayerUUID).toHaveBeenCalledWith('h-1', 'g-1'))
  })

  it('a plain boolean prompt still consumes the hand click (no card frame) — intentional', async () => {
    setState({ feedback: plainBooleanPrompt() })
    const { container } = render(<GameScreen />)

    const card = container.querySelector<HTMLElement>('[data-testid="hand-bar"] [data-card-id="h-1"]')
    expect(card).not.toBeNull()

    fireEvent.click(card!)
    // The boolean ask is dialog-only: a stray playable/uuid frame must not fire.
    await Promise.resolve()
    expect(cmds.sendPlayerUUID).not.toHaveBeenCalled()
  })

  it('sanity: the store is really in the choice state the handler reads', () => {
    setState({ feedback: discardPrompt() })
    const f = getState().feedback
    expect(f?.mode).toBe('uuid')
    expect(f?.options.some((o) => o.id === 'h-1')).toBe(true)
  })
})

/**
 * Hand-card click:
 * wire-verified twice — a click on a hand card the app does NOT paint `playable`
 * still sent `sendPlayerUUID`, and the refusal was total silence (the proxy answers
 * ok:true, so no error path fires). Without an open prompt the click can only be a
 * play, so the click path must consult the playable set the slot is already tinted
 * from. The uuid-choice branch above it and the mana/combat prompt modes are
 * untouched: those keep answering their prompt.
 */

/** A two-card hand where only the second card is marked playable. */
function twoCardGame(): GameView {
  return makeGameView({
    players: [
      makePlayer({ playerId: 'me', name: 'Me', controlled: true, isActive: true, hasPriority: true, handCount: 2 }),
      makePlayer({ playerId: 'opp', name: 'Foe' }),
    ],
    myPlayerId: 'me',
    myHand: {
      'h-1': makeCard({ name: 'Mountain', parentId: 'h-1' }),
      'h-2': makeCard({ name: 'Lightning Bolt', parentId: 'h-2' }),
    },
    activePlayerId: 'me',
    activePlayerName: 'Me',
    priorityPlayerName: 'Me',
  })
}

function handCard(container: HTMLElement, id: string): HTMLElement {
  const card = container.querySelector<HTMLElement>(`[data-testid="hand-bar"] [data-card-id="${id}"]`)
  expect(card).not.toBeNull()
  return card!
}

/** Drains the microtask queue: sends are chained promises. */
async function flushSends() {
  for (let i = 0; i < 4; i++) await Promise.resolve()
}

describe('GameScreen — a hand-card click is gated on the playable marker', () => {
  beforeEach(() => {
    reset()
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
    reset()
  })

  it('a click on a hand card NOT marked playable, with no prompt open, sends nothing', async () => {
    setState({ phase: 'game', gameId: 'g-1', game: boardGame(), playableIds: [], feedback: null, error: null })
    const { container } = render(<GameScreen />)

    fireEvent.click(handCard(container, 'h-1'))
    await flushSends()
    expect(cmds.sendPlayerUUID).not.toHaveBeenCalled()
    expect(cmds.sendPlayerAction).not.toHaveBeenCalled()
  })

  it('positive control: a card that IS marked playable still sends exactly one play, with id and gameId', async () => {
    setState({ phase: 'game', gameId: 'g-1', game: boardGame(), playableIds: ['h-1'], feedback: null, error: null })
    const { container } = render(<GameScreen />)

    fireEvent.click(handCard(container, 'h-1'))
    await waitFor(() => expect(cmds.sendPlayerUUID).toHaveBeenCalledWith('h-1', 'g-1'))
    expect(cmds.sendPlayerUUID).toHaveBeenCalledTimes(1)
  })

  it('positive control: a dropped click does not spend the priority claim (the next playable click still plays)', async () => {
    setState({ phase: 'game', gameId: 'g-1', game: twoCardGame(), playableIds: ['h-2'], feedback: null, error: null })
    const { container } = render(<GameScreen />)

    fireEvent.click(handCard(container, 'h-1'))
    await flushSends()
    expect(cmds.sendPlayerUUID).not.toHaveBeenCalled()

    fireEvent.click(handCard(container, 'h-2'))
    await waitFor(() => expect(cmds.sendPlayerUUID).toHaveBeenCalledWith('h-2', 'g-1'))
    expect(cmds.sendPlayerUUID).toHaveBeenCalledTimes(1)
  })

  it('positive control: a hand card that is a legal option of an open uuid prompt still routes to the choice verb', async () => {
    setState({ phase: 'game', gameId: 'g-1', game: boardGame(), playableIds: [], feedback: discardPrompt(), error: null })
    const { container } = render(<GameScreen />)

    fireEvent.click(handCard(container, 'h-1'))
    await waitFor(() => expect(cmds.sendPlayerUUID).toHaveBeenCalledWith('h-1', 'g-1'))
    expect(cmds.sendPlayerUUID).toHaveBeenCalledTimes(1)
  })
})
