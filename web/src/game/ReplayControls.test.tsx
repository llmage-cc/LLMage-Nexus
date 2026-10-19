import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import ReplayControls from './ReplayControls'
import { replayHotkey, isTypingTarget } from './replayHotkeys'
import { reset, getState } from '../state/store'
import { setState } from '../state/state'
import { makeGameView, makePlayer } from '../__fixtures__/gameViews'
import * as commands from '../net/commands'

vi.mock('../net/commands', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../net/commands')>()
  return {
    ...mod,
    replayNext: vi.fn().mockResolvedValue({ ok: true }),
    replayPrevious: vi.fn().mockResolvedValue({ ok: true }),
    replaySkipForward: vi.fn().mockResolvedValue({ ok: true }),
    replaySeek: vi.fn().mockResolvedValue({ ok: true }),
    stopReplay: vi.fn().mockResolvedValue({ ok: true }),
  }
})

const view = () => makeGameView({
  players: [makePlayer({ playerId: 'p', name: 'P', controlled: true })],
})

/** Two spectator-shaped seats (a replay frame carries no `controlled` seat). */
const twoSeats = () => makeGameView({
  players: [
    makePlayer({ playerId: 'p1', name: 'Alice' }),
    makePlayer({ playerId: 'p2', name: 'Bob' }),
  ],
})

function seedReplay(overrides: Record<string, unknown> = {}) {
  setState({
    capabilities: { llm: true, p1: false, replayScrubber: true, replaySidecar: true, serverVersion: 'x', playerTypes: [] },
    replay: {
      gameId: 'game-1',
      frame: view(),
      stateIndex: 3,
      stateCount: 10,
      frameCount: 4,
      playing: false,
      done: null,
      llmFrames: [],
      gameLog: [],
      hasLlmPlayers: null,
      ...overrides,
    },
  })
}

describe('replayHotkey', () => {
  it('maps space/arrows/escape when nothing else owns the keyboard', () => {
    expect(replayHotkey(' ', { typing: false, dialogOpen: false })).toBe('play')
    expect(replayHotkey('ArrowRight', { typing: false, dialogOpen: false })).toBe('next')
    expect(replayHotkey('ArrowLeft', { typing: false, dialogOpen: false })).toBe('previous')
    expect(replayHotkey('Escape', { typing: false, dialogOpen: false })).toBe('exit')
  })

  it('stands down while typing or a dialog is open', () => {
    expect(replayHotkey(' ', { typing: true, dialogOpen: false })).toBeNull()
    expect(replayHotkey('ArrowRight', { typing: false, dialogOpen: true })).toBeNull()
  })

  it('ignores other keys', () => {
    expect(replayHotkey('a', { typing: false, dialogOpen: false })).toBeNull()
  })

  it('detects a typing target', () => {
    expect(isTypingTarget({ tagName: 'INPUT' } as never)).toBe(true)
    expect(isTypingTarget({ tagName: 'DIV' } as never)).toBe(false)
  })
})

describe('ReplayControls', () => {
  beforeEach(() => {
    reset()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders nothing without a replay', () => {
    const { container } = render(<ReplayControls />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when the server lacks the llm capability', () => {
    seedReplay()
    setState({ capabilities: { llm: false, p1: false, replayScrubber: false, replaySidecar: false, serverVersion: 'x', playerTypes: [] } })
    const { container } = render(<ReplayControls />)
    expect(container.firstChild).toBeNull()
  })

  it('shows the scrubber label as (index+1)/count and steps the server', () => {
    seedReplay()
    render(<ReplayControls />)
    expect(screen.getByTestId('replay-scrubber-label').textContent).toBe('4 / 10')

    const range = screen.getByTestId('replay-scrubber') as HTMLInputElement
    expect(range.min).toBe('0')
    expect(range.max).toBe('9')
    fireEvent.change(range, { target: { value: '7' } })
    expect(commands.replaySeek).toHaveBeenCalledWith('game-1', 7)
  })

  it('sends prev/next/skip and toggles play', () => {
    seedReplay()
    render(<ReplayControls />)
    fireEvent.click(screen.getByText(/Siguiente/))
    expect(commands.replayNext).toHaveBeenCalledWith('game-1')

    fireEvent.click(screen.getByText(/Anterior/))
    expect(commands.replayPrevious).toHaveBeenCalledWith('game-1')

    fireEvent.click(screen.getByText(/Saltar/))
    expect(commands.replaySkipForward).toHaveBeenCalledWith('game-1', 10)

    fireEvent.click(screen.getByTestId('replay-play'))
    fireEvent.click(screen.getByText(/Siguiente/))
    expect(commands.replayNext).toHaveBeenCalled()
  })

  it('renders the loading notice before the first frame', () => {
    seedReplay({ frame: null })
    render(<ReplayControls />)
    expect(screen.getByTestId('replay-loading')).toBeDefined()
  })

  it('offers a "view as" seat picker and applies the clicked seat to the store', () => {
    seedReplay({ frame: twoSeats() })
    render(<ReplayControls />)
    const alice = screen.getByTestId('replay-perspective-p1')
    const bob = screen.getByTestId('replay-perspective-p2')
    // No pick yet → the auto default (players[0], Alice) is the own side.
    expect(alice.getAttribute('aria-pressed')).toBe('true')
    expect(bob.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(bob)

    expect(getState().replay?.perspectivePlayerId).toBe('p2')
    // The highlight follows the store: Bob is now the own side.
    expect(screen.getByTestId('replay-perspective-p2').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('replay-perspective-p1').getAttribute('aria-pressed')).toBe('false')
  })

  it('hides the seat picker when the frame has a single seat', () => {
    seedReplay()
    render(<ReplayControls />)
    expect(screen.queryByTestId('replay-perspective')).toBeNull()
  })
})
