import { describe, expect, it, vi } from 'vitest'
import { extractLobbyUsers, formatSeatHistory } from './lobbyUtils'
import type { RoomUsersView, UsersView } from '../net/types'
import { exitReplay } from '../state/actions'
import { getState, setState } from '../state/state'

vi.mock('../net/commands', () => ({
  stopReplay: vi.fn().mockResolvedValue({ ok: true }),
}))

describe('formatSeatHistory', () => {
  it('formats XMage seat history with quit counts cleanly without truncating', () => {
    expect(formatSeatHistory('720 (I:15 T:8 Q:3)')).toEqual({
      short: '720 (Q:3)',
      full: '720 partidas jugadas (3 abandonos, 15 inactivos, 8 timeouts)',
    })
    expect(formatSeatHistory('1817 (I:4 T:12 Q:0)')).toEqual({
      short: '1817',
      full: '1817 partidas jugadas (4 inactivos, 12 timeouts)',
    })
    expect(formatSeatHistory('239 (I:3 T:9 Q:1)')).toEqual({
      short: '239 (Q:1)',
      full: '239 partidas jugadas (1 abandonos, 3 inactivos, 9 timeouts)',
    })
    expect(formatSeatHistory('8 (Q:1)')).toEqual({
      short: '8 (Q:1)',
      full: '8 partidas jugadas (1 abandonos)',
    })
    expect(formatSeatHistory('2')).toEqual({
      short: '2',
      full: '2 partidas jugadas',
    })
  })

  it('formats Win-Loss and raw tournament records', () => {
    expect(formatSeatHistory('10-2')).toEqual({
      short: '10-2',
      full: '10-2 (Historial)',
    })
    expect(formatSeatHistory('5-5-1')).toEqual({
      short: '5-5-1',
      full: '5-5-1 (Historial)',
    })
  })

  it('formats user profile history strings with percentages', () => {
    expect(
      formatSeatHistory(undefined, 'Matches: 265 (I:3 T:1 Q:13) (6%), Tourneys: 0 (0%), Constructed Rating: 1500')
    ).toEqual({
      short: '265 (6%)',
      // The raw `UserData.getHistory()` labels ("Matches: …, Tourneys: …,
      // Constructed Rating: …") must NOT leak into the tooltip: the full string
      // is rebuilt from the parsed numbers with the localized segments.
      full: '265 partidas jugadas (13 abandonos, 3 inactivos, 1 timeouts)',
    })
  })

  it('handles null and undefined', () => {
    expect(formatSeatHistory(undefined, undefined)).toEqual({ short: null, full: '' })
    expect(formatSeatHistory('', '')).toEqual({ short: null, full: '' })
  })
})

describe('lobby error banner lifecycle', () => {
  it('leaving the replay clears the replay-scoped error that hung over the lobby', () => {
    setState({
      phase: 'game',
      replay: {
        gameId: 'g-1',
        frame: null,
        stateIndex: -1,
        stateCount: -1,
        frameCount: 0,
        playing: true,
        done: null,
        llmFrames: [],
        gameLog: [],
        hasLlmPlayers: null,
      },
      error: 'A replay is loaded — player actions are not available until the replay is stopped',
    })

    exitReplay()

    expect(getState().replay).toBeNull()
    expect(getState().phase).toBe('lobby')
    // The banner the lobby renders reads store.error: a replay-scoped message
    // must not survive the viewer closing.
    expect(getState().error).toBeNull()
  })
})

describe('extractLobbyUsers', () => {
  it('extracts users when proxy sends Array of RoomUsersView (actual XMage Java proxy format)', () => {
    const raw: RoomUsersView[] = [
      {
        numberActiveGames: 2,
        numberGameThreads: 4,
        numberMaxGames: 100,
        usersView: [
          {
            userName: 'player1',
            flagName: 'US',
            infoGames: 'Modern Duel',
            infoPing: '45ms',
            matchHistory: '10-2',
            matchQuitRatio: 0,
            tourneyHistory: '1-0',
            tourneyQuitRatio: 0,
            generalRating: 1650,
            constructedRating: 1720,
            limitedRating: 1580,
          },
          {
            userName: 'player2',
            flagName: 'ES',
            infoGames: '',
            infoPing: '20ms',
            matchHistory: '5-5',
            matchQuitRatio: 0,
            tourneyHistory: '',
            tourneyQuitRatio: 0,
            generalRating: 1500,
            constructedRating: 1500,
            limitedRating: 1500,
          },
        ],
      },
    ]

    const users = extractLobbyUsers(raw)
    expect(users.length).toBe(2)
    expect(users[0].userName).toBe('player1')
    expect(users[0].flagName).toBe('US')
    expect(users[0].constructedRating).toBe(1720)
    expect(users[1].userName).toBe('player2')
  })

  it('extracts users when proxy sends single RoomUsersView object', () => {
    const raw: RoomUsersView = {
      numberActiveGames: 0,
      numberGameThreads: 0,
      numberMaxGames: 50,
      usersView: [
        {
          userName: 'mage_master',
          flagName: 'DE',
          infoGames: '',
          infoPing: '30ms',
          matchHistory: '20-1',
          matchQuitRatio: 0,
          tourneyHistory: '',
          tourneyQuitRatio: 0,
          generalRating: 1800,
          constructedRating: 1850,
          limitedRating: 1750,
        },
      ],
    }

    const users = extractLobbyUsers(raw)
    expect(users.length).toBe(1)
    expect(users[0].userName).toBe('mage_master')
  })

  it('extracts users when array contains direct UsersView items', () => {
    const raw: Partial<UsersView>[] = [
      { userName: 'direct_user_1', flagName: 'FR' },
      { userName: 'direct_user_2', flagName: 'JP' },
    ]

    const users = extractLobbyUsers(raw)
    expect(users.length).toBe(2)
    expect(users[0].userName).toBe('direct_user_1')
    expect(users[1].userName).toBe('direct_user_2')
  })

  it('returns empty array when raw is null, undefined, or empty', () => {
    expect(extractLobbyUsers(null)).toEqual([])
    expect(extractLobbyUsers(undefined)).toEqual([])
    expect(extractLobbyUsers([])).toEqual([])
    expect(extractLobbyUsers({})).toEqual([])
  })
})
