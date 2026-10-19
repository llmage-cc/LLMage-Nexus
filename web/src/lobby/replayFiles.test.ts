import { describe, it, expect } from 'vitest'
import {
  buildReplayRows,
  compareRows,
  formatBytes,
  formatWhen,
  markRowsWithSave,
  parsePlayersDisplay,
  parseWinnerName,
  relativeTimeParts,
  replayDownloadUrl,
  rowFromFile,
  rowMatches,
  type ReplayRow,
} from './replayFiles'
import type { MatchView } from '../net/types'
import type { ReplayFileEntry } from '../net/commands'

function entry(over: Partial<ReplayFileEntry> & { gameId: string }): ReplayFileEntry {
  return { bytes: 1024, savedAtMs: Date.UTC(2026, 0, 1, 12, 0), ...over }
}

const match: MatchView = {
  tableId: 't1',
  matchName: 'Standard Bo3 Match',
  gameType: 'Two Player Duel',
  deckType: 'Constructed - Standard',
  games: ['g1', 'g2'],
  result: 'Alice [2-1], Bob [1-2]',
  players: 'Alice, Bob',
  startTime: Date.UTC(2026, 0, 1, 10, 0),
  endTime: Date.UTC(2026, 0, 1, 11, 0),
  rated: true,
  replayAvailable: true,
}

const metaEntry: ReplayFileEntry = entry({
  gameId: 'g3',
  bytes: 4096,
  savedAtMs: Date.UTC(2026, 0, 2, 9, 30),
  meta: {
    tableName: 'Commander Pod',
    gameType: 'Commander',
    deckType: 'Constructed - Commander',
    winner: 'Bea is the winner',
    players: [
      { name: 'Ari', wins: 0, deck: 'Atraxa' },
      { name: 'Bea', wins: 2, deck: 'Krenko' },
    ],
    startTime: '2026-01-02T09:00:00Z',
    endTime: '2026-01-02T09:30:00Z',
  },
})

const legacyEntry: ReplayFileEntry = entry({ gameId: 'g4', bytes: 512, savedAtMs: Date.UTC(2026, 0, 3, 8, 0) })

describe('replayFiles row model', () => {
  it('parses the match players display string, stripping quit markers', () => {
    expect(parsePlayersDisplay('Alice, Bob [quit], Cid [timer]')).toEqual(['Alice', 'Bob', 'Cid'])
    expect(parsePlayersDisplay(null)).toEqual([])
  })

  it('parses the winner name from a result string (unique top seat only)', () => {
    expect(parseWinnerName('Alice [2-1], Bob [1-2]')).toBe('Alice')
    expect(parseWinnerName('Ari [1-1], Bea [1-1]')).toBeNull()
    expect(parseWinnerName('')).toBeNull()
  })

  it('formats bytes and dates null-safely', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(3072)).toBe('3.0 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatBytes(null)).toBe('')
    expect(formatWhen(null)).toBe('—')
    expect(formatWhen(Date.UTC(2026, 8, 19, 12, 32))).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })

  it('buckets relative age into i18n keys', () => {
    const now = Date.UTC(2026, 0, 10, 12, 0)
    expect(relativeTimeParts(now - 30_000, now).key).toBe('time_just_now')
    expect(relativeTimeParts(now - 10 * 60_000, now)).toEqual({ key: 'time_ago_m', count: 10 })
    expect(relativeTimeParts(now - 5 * 3_600_000, now)).toEqual({ key: 'time_ago_h', count: 5 })
    expect(relativeTimeParts(now - 3 * 86_400_000, now)).toEqual({ key: 'time_ago_d', count: 3 })
  })

  it('builds one row per replayable game of a finished match', () => {
    const rows = buildReplayRows([match], [], 'all')
    expect(rows.map((r) => r.gameId)).toEqual(['g1', 'g2'])
    expect(rows[0]).toMatchObject({
      source: 'match',
      name: 'Standard Bo3 Match',
      gameType: 'Two Player Duel',
      playerNames: ['Alice', 'Bob'],
      winner: 'Alice',
      rated: true,
      bytes: null,
      legacy: false,
    })
    expect(rows[0].dateMs).toBe(match.endTime)
  })

  it('skips matches without a replay or with no games', () => {
    const rows = buildReplayRows(
      [
        { ...match, games: [], replayAvailable: true },
        { ...match, games: ['g9'], replayAvailable: false },
      ],
      [],
      'all',
    )
    expect(rows).toEqual([])
  })

  it('builds a file row from its sidecar (winner, players, decks, score, size)', () => {
    const row = rowFromFile(metaEntry)
    expect(row).toMatchObject({
      gameId: 'g3',
      source: 'file',
      name: 'Commander Pod',
      gameType: 'Commander',
      deckType: 'Constructed - Commander',
      playerNames: ['Ari', 'Bea'],
      playerDecks: ['Atraxa', 'Krenko'],
      score: '2–0',
      winner: 'Bea is the winner',
      bytes: 4096,
      legacy: false,
    })
    expect(row.dateMs).toBe(Date.parse('2026-01-02T09:30:00Z'))
  })

  it('marks a save with no sidecar as legacy (id + date + size only)', () => {
    const row = rowFromFile(legacyEntry)
    expect(row.legacy).toBe(true)
    expect(row.playerNames).toEqual([])
    expect(row.name).toBe('')
    expect(row.winner).toBeNull()
    expect(row.dateMs).toBe(legacyEntry.savedAtMs)
    expect(row.bytes).toBe(512)
  })

  it('leaves score blank when a sidecar knows the winner but no per-seat wins', () => {
    const row = rowFromFile(entry({ gameId: 'g5', meta: { winner: 'X is the winner', players: [{ name: 'X' }, { name: 'Y' }] } }))
    expect(row.score).toBe('')
    expect(row.playerNames).toEqual(['X', 'Y'])
    expect(row.legacy).toBe(false)
  })

  it('dedupes a game present in both sources to ONE row, the match row winning', () => {
    const rows = buildReplayRows([match], [entry({ gameId: 'g1', meta: { tableName: 'Other' } }), metaEntry], 'all')
    expect(rows.map((r) => r.gameId).sort()).toEqual(['g1', 'g2', 'g3'])
    const g1 = rows.find((r) => r.gameId === 'g1')!
    expect(g1.source).toBe('match')
    expect(g1.name).toBe('Standard Bo3 Match')
  })

  it('filters by source without changing dedupe', () => {
    const both = [match, entry({ gameId: 'g1' }), metaEntry]
    expect(buildReplayRows(both as never, [], 'match').every((r) => r.source === 'match')).toBe(true)
    const files = buildReplayRows([match], [entry({ gameId: 'g1' }), metaEntry], 'file')
    expect(files.map((r) => r.gameId).sort()).toEqual(['g1', 'g3'])
  })

  it('searches across name, types, winner, players and decks', () => {
    const row = rowFromFile(metaEntry)
    expect(rowMatches(row, 'commander')).toBe(true) // name + gameType + deckType
    expect(rowMatches(row, 'krenko')).toBe(true) // deck
    expect(rowMatches(row, 'bea')).toBe(true) // player + winner
    expect(rowMatches(row, 'zzz')).toBe(false)
    expect(rowMatches(row, '')).toBe(true)
  })
})

describe('replayFiles sort', () => {
  const row = (gameId: string, over: Partial<ReplayRow>): ReplayRow => ({
    gameId,
    source: 'file',
    name: '',
    gameType: '',
    deckType: '',
    playerNames: [],
    playerDecks: [],
    wins: [],
    score: '',
    winner: null,
    dateMs: 0,
    bytes: null,
    rated: false,
    legacy: true,
    ...over,
  })

  it('sorts by size, name, type and winner in both directions', () => {
    const a = row('a', { bytes: 100, name: 'Alpha', gameType: 'Duel', winner: 'Bob' })
    const b = row('b', { bytes: 900, name: 'Beta', gameType: 'Commander', winner: 'Alice' })
    expect(compareRows(a, b, 'size', 'asc')).toBeLessThan(0)
    expect(compareRows(a, b, 'size', 'desc')).toBeGreaterThan(0)
    expect(compareRows(a, b, 'name', 'asc')).toBeLessThan(0)
    expect(compareRows(a, b, 'type', 'asc')).toBeGreaterThan(0) // Duel vs Commander
    expect(compareRows(a, b, 'winner', 'asc')).toBeGreaterThan(0) // Bob vs Alice
  })

  it('sinks rows without a date to the bottom, either direction', () => {
    const dated = row('a', { dateMs: 1000 })
    const undated = row('b', { dateMs: null })
    expect(compareRows(undated, dated, 'date', 'asc')).toBeGreaterThan(0)
    expect(compareRows(undated, dated, 'date', 'desc')).toBeGreaterThan(0)
    expect(compareRows(dated, dated, 'date', 'asc')).toBe(0)
  })

  it('marks every row whose game id has a save on disk (hasSave), and only those', () => {
    const rows = buildReplayRows([match], [metaEntry, legacyEntry], 'all')
    // The match row for g1/g2 has no save; the file rows themselves always do.
    const marked = markRowsWithSave(rows, [metaEntry, legacyEntry])
    const g1 = marked.find((r) => r.gameId === 'g1')
    const g3 = marked.find((r) => r.gameId === 'g3')
    expect(g1?.hasSave).toBeUndefined()
    expect(g3?.hasSave).toBe(true)
    // A save appearing LATER for a match row: the SAME row gains the flag without
    // losing its match metadata (the dedupe keeps the match row as the base).
    const withSave = markRowsWithSave(rows, [...[metaEntry, legacyEntry], entry({ gameId: 'g1', bytes: 2048 })])
    const g1Now = withSave.find((r) => r.gameId === 'g1')
    expect(g1Now?.hasSave).toBe(true)
    expect(g1Now?.source).toBe('match')
    expect(g1Now?.name).toBe('Standard Bo3 Match')
  })

  it('builds the origin-absolute download URL for a save', () => {
    expect(replayDownloadUrl('abc')).toBe(`${window.location.origin}/replay-file/abc.game`)
  })
})
