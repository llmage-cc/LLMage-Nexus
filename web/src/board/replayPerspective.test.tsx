import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import GameBoard from './GameBoard'
import ArenaBoard from './ArenaBoard'
import PodBoard from './PodBoard'
import { pickPerspectivePlayer } from './useBoardPresenter'
import { makeGameView, makePlayer } from '../__fixtures__/gameViews'
import { reset, setState } from '../state/store'
import type { GameView } from '../net/types'

const replaySlice = {
  gameId: 'g1',
  frame: null,
  stateIndex: 0,
  stateCount: 1,
  frameCount: 1,
  playing: false,
  done: null,
  llmFrames: [],
  gameLog: [],
  hasLlmPlayers: null,
}

/** Two-player replay frame: no seat is `controlled` (the proxy watches the replay). */
function replayFrame(first = 'Alice', second = 'Bob'): GameView {
  return makeGameView({
    players: [
      makePlayer({ playerId: 'p1', name: first, life: 20 }),
      makePlayer({ playerId: 'p2', name: second, life: 18 }),
    ],
    activePlayerId: 'p2',
    activePlayerName: second,
    turn: 3,
  })
}

describe('pickPerspectivePlayer', () => {
  const players = [makePlayer({ playerId: 'p1', name: 'Alice' }), makePlayer({ playerId: 'p2', name: 'Bob' })]
  const controlled = [
    makePlayer({ playerId: 'p1', name: 'Alice' }),
    makePlayer({ playerId: 'p2', name: 'Bob', controlled: true }),
  ]

  it('a controlled seat always wins, replay or not', () => {
    expect(pickPerspectivePlayer(controlled, { replay: true, username: 'Alice' })).toBe(controlled[1])
    expect(pickPerspectivePlayer(controlled, { replay: false })).toBe(controlled[1])
  })

  it('a replay with no controlled seat picks players[0] by default', () => {
    expect(pickPerspectivePlayer(players, { replay: true })).toBe(players[0])
  })

  it('a replay prefers the seat whose name matches the signed-in username', () => {
    expect(pickPerspectivePlayer(players, { replay: true, username: 'Bob' })).toBe(players[1])
    expect(pickPerspectivePlayer(players, { replay: true, username: '  bob ' })).toBe(players[1])
  })

  it('an explicit "view as" pick wins over the username match and the default', () => {
    expect(pickPerspectivePlayer(players, { replay: true, perspectivePlayerId: 'p2' })).toBe(players[1])
    expect(
      pickPerspectivePlayer(players, { replay: true, username: 'Alice', perspectivePlayerId: 'p2' }),
    ).toBe(players[1])
  })

  it('an unknown or absent pick id falls back to the automatic default', () => {
    expect(pickPerspectivePlayer(players, { replay: true, perspectivePlayerId: 'ghost' })).toBe(players[0])
    expect(
      pickPerspectivePlayer(players, { replay: true, username: 'Bob', perspectivePlayerId: 'ghost' }),
    ).toBe(players[1])
    expect(pickPerspectivePlayer(players, { replay: true, perspectivePlayerId: null })).toBe(players[0])
  })

  it('a controlled seat beats an explicit pick (a live game is never swapped)', () => {
    expect(pickPerspectivePlayer(controlled, { replay: true, perspectivePlayerId: 'p1' })).toBe(controlled[1])
  })

  it('a username that matches no seat falls back to players[0]', () => {
    expect(pickPerspectivePlayer(players, { replay: true, username: 'Carol' })).toBe(players[0])
    expect(pickPerspectivePlayer(players, { replay: true, username: '' })).toBe(players[0])
  })

  it('a non-replay game with no controlled seat stays spectator (no perspective)', () => {
    expect(pickPerspectivePlayer(players, { replay: false })).toBeUndefined()
    expect(pickPerspectivePlayer([], { replay: true })).toBeUndefined()
  })
})

describe('replay viewing perspective on the board', () => {
  beforeEach(() => {
    reset()
  })
  afterEach(() => {
    reset()
    cleanup()
  })

  const conn = (username: string) => ({ wsHost: 'h', proxyPort: 8787, serverHost: 's', port: 17171, username, password: '' })

  it('a replay renders players[0] as the own side (player-zone) and the other as opponent', () => {
    setState({ game: replayFrame(), replay: replaySlice, conn: null })
    const { container } = render(<GameBoard game={replayFrame()} />)
    const bottom = container.querySelector('.game-board > .player-zone') as HTMLElement | null
    expect(bottom).not.toBeNull()
    expect(bottom!.getAttribute('data-player-name')).toBe('Alice')
    expect(bottom!.getAttribute('data-role')).toBe('player')
    // the other seat stays an opponent
    expect(container.querySelector('.game-board > .opponent-zone')?.getAttribute('data-player-name')).toBe('Bob')
  })

  it('the signed-in username selects the matching seat for the own side', () => {
    setState({ conn: conn('Bob'), game: replayFrame(), replay: replaySlice })
    const { container } = render(<GameBoard game={replayFrame()} />)
    expect(container.querySelector('.game-board > .player-zone')?.getAttribute('data-player-name')).toBe('Bob')
    expect(container.querySelector('.game-board > .opponent-zone')?.getAttribute('data-player-name')).toBe('Alice')
  })

  it('an explicit "view as" pick swaps which seat renders as own', () => {
    setState({ conn: null, game: replayFrame(), replay: { ...replaySlice, perspectivePlayerId: 'p2' } })
    const { container } = render(<GameBoard game={replayFrame()} />)
    expect(container.querySelector('.game-board > .player-zone')?.getAttribute('data-player-name')).toBe('Bob')
    expect(container.querySelector('.game-board > .opponent-zone')?.getAttribute('data-player-name')).toBe('Alice')
  })

  it('an unknown pick id falls back to the default own seat (never a blank board)', () => {
    setState({ conn: conn('Bob'), game: replayFrame(), replay: { ...replaySlice, perspectivePlayerId: 'ghost' } })
    const { container } = render(<GameBoard game={replayFrame()} />)
    // 'ghost' names no seat → the auto default runs (the username-matching Bob).
    expect(container.querySelector('.game-board > .player-zone')?.getAttribute('data-player-name')).toBe('Bob')
    expect(container.querySelector('.game-board > .opponent-zone')?.getAttribute('data-player-name')).toBe('Alice')
  })

  it('a non-replay spectator game keeps the spectator layout (no own side)', () => {
    setState({ conn: null, replay: null })
    const { container } = render(<GameBoard game={replayFrame()} />)
    expect(container.querySelector('.game-board > .player-zone')).toBeNull()
    expect(container.querySelector('.game-board > .opponent-zone')).not.toBeNull()
  })

  it('a controlled live game is untouched by the perspective logic', () => {
    const live = makeGameView({
      players: [
        makePlayer({ playerId: 'p1', name: 'Alice', controlled: true }),
        makePlayer({ playerId: 'p2', name: 'Bob' }),
      ],
      myPlayerId: 'p1',
    })
    setState({ replay: null, conn: null })
    const { container } = render(<GameBoard game={live} />)
    expect(container.querySelector('.game-board > .player-zone')?.getAttribute('data-player-name')).toBe('Alice')
    expect(container.querySelector('.game-board > .opponent-zone')?.getAttribute('data-player-name')).toBe('Bob')
  })

  it('arena replay: the perspective seat is the full-width own zone, the rest opponent columns', () => {
    const replay = makeGameView({
      players: [
        makePlayer({ playerId: 'p1', name: 'Alice', life: 40 }),
        makePlayer({ playerId: 'p2', name: 'Bob', life: 40 }),
        makePlayer({ playerId: 'p3', name: 'Carol', life: 40 }),
      ],
      activePlayerId: 'p2',
    })
    setState({ replay: replaySlice, conn: null })
    const { container } = render(<ArenaBoard game={replay} />)
    const bottom = container.querySelector('.arena-board > .player-zone') as HTMLElement | null
    expect(bottom).not.toBeNull()
    expect(bottom!.getAttribute('data-player-name')).toBe('Alice')
    expect(container.querySelectorAll('.arena-opp-cell .opponent-zone').length).toBe(2)
    expect(container.querySelector('.arena-opp-cell .board-zone[data-player-name="Alice"]')).toBeNull()
  })

  it('pod replay: the perspective seat is the own cell, the rest in opponent cells', () => {
    const replay = makeGameView({
      players: [
        makePlayer({ playerId: 'p1', name: 'Alice', life: 40 }),
        makePlayer({ playerId: 'p2', name: 'Bob', life: 40 }),
      ],
      activePlayerId: 'p1',
    })
    setState({ replay: replaySlice, conn: null })
    const { container } = render(<PodBoard game={replay} />)
    expect(container.querySelector('.pod-cell--me .player-zone')?.getAttribute('data-player-name')).toBe('Alice')
    expect(container.querySelectorAll('.pod-cell .opponent-zone').length).toBe(1)
  })
})
