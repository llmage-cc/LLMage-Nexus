import type { MatchView } from '../net/types'
import type { ReplayFileEntry, ReplayFileMeta } from '../net/commands'

/**
 * Pure row logic for the all-saves replay file browser.
 *
 * Every replayable game — from the lobby's finished matches OR the server's
 * saved `<uuid>.game` files (proxy `getReplayFiles`) — becomes one
 * {@link ReplayRow}. A game id present in BOTH sources dedupes to ONE row and
 * the finished-match row wins (richer metadata); orphan files with no lobby
 * record come through from the file list alone. Metadata quality varies: a save
 * with no sidecar JSON (a "legacy" save) carries only the id, the file date and
 * its byte size.
 *
 * Kept free of React and of the i18n store so the merge/search/sort rules can be
 * exercised in a plain unit test (mirrors the reference `replayRows.ts`).
 */

/** Unified row: one replayable game from either source. */
export interface ReplayRow {
  /** Game UUID to load. */
  gameId: string
  /** Which list the row came from (source badge + dedupe priority). */
  source: 'match' | 'file'
  /** Table/match name. A saved file has none (only a sidecar `tableName`). */
  name: string
  gameType: string
  deckType: string
  /** Per seat, aligned arrays: names, deck names, match wins. */
  playerNames: string[]
  playerDecks: string[]
  /** Per-seat wins; empty when unknown (e.g. a stock-server match string). */
  wins: number[]
  /** Display score, e.g. "2–0" (highest seat wins first). Empty when unknown. */
  score: string
  /** Winner string from the sidecar, e.g. "Player X is the winner". */
  winner: string | null
  /** Row sort/search date: match end > match start > file mtime. */
  dateMs: number | null
  /** Save file size in bytes; null for a finished match (not a file). */
  bytes: number | null
  /** True when the proxy's file list shows a save on disk for this game id —
   *  the row may then offer the `/replay-file/<uuid>.game` download too. */
  hasSave?: boolean
  rated: boolean
  /** True when we know nothing but the game id + file date (legacy save). */
  legacy: boolean
}

export type SortKey = 'date' | 'size' | 'name' | 'type' | 'winner'
export type SortDir = 'asc' | 'desc'
export type SourceFilter = 'all' | 'match' | 'file'

/**
 * Parse a MatchView display string ("Alice, Bob [quit]") into player names.
 * The nexus MatchView carries no structured player list, so this is the only
 * source of names for finished-match rows; tolerates "[quit]"/"[timer]"/"[idle]".
 */
export function parsePlayersDisplay(players: string | null | undefined): string[] {
  if (!players) return []
  return players
    .split(',')
    .map((s) => s.trim().replace(/\s*\[(quit|timer|idle)\]\s*$/i, ''))
    .filter((s) => s.length > 0)
}

/** Byte-size formatting: "512 B", "3 KB", "4.0 MB". Null-safe ('' for null). */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || Number.isNaN(bytes)) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Epoch-ms date → "2026-09-19 14:32". Null-safe ("—"). Local time, no locale dep. */
export function formatWhen(ms: number | null): string {
  if (ms == null || Number.isNaN(ms)) return '—'
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * Relative-age shape for a timestamp, as an i18n key + count the component
 * translates (pure so the buckets are testable): <60s just-now, <60m minutes,
 * <24h hours, else days.
 */
export function relativeTimeParts(
  ms: number,
  now: number = Date.now(),
): { key: 'time_just_now' | 'time_ago_m' | 'time_ago_h' | 'time_ago_d'; count: number } {
  const diffSec = Math.floor((now - ms) / 1000)
  if (diffSec < 60) return { key: 'time_just_now', count: 0 }
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return { key: 'time_ago_m', count: diffMin }
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return { key: 'time_ago_h', count: diffHours }
  return { key: 'time_ago_d', count: Math.floor(diffHours / 24) }
}

/** "2–0" style score from the per-seat win counts (highest first). */
function scoreFromWins(wins: number[]): string {
  if (!wins.length) return ''
  return [...wins].sort((a, b) => b - a).join('–')
}

/**
 * Winner name parsed from a finished match's result string ("Alice [2-1], Bob
 * [1-2]" → the seat with the most wins when unique). Returns null when the
 * result is absent or tied.
 */
export function parseWinnerName(result?: string): string | null {
  if (!result) return null
  let best: { name: string; wins: number } | null = null
  let tied = false
  for (const part of result.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(.*?)\s*\[(\d+)-(\d+)(?:-(\d+))?\]$/)
    if (!m) continue
    const name = m[1].trim()
    const wins = parseInt(m[2], 10)
    if (!best || wins > best.wins) {
      best = { name, wins }
      tied = false
    } else if (wins === best.wins) {
      tied = true
    }
  }
  return best && !tied ? best.name : null
}

/** Flatten a finished match into one row per replayable game. */
export function rowFromMatch(m: MatchView, gameId: string): ReplayRow {
  const names = parsePlayersDisplay(m.players)
  const endMs = toMs(m.endTime)
  const startMs = toMs(m.startTime)
  return {
    gameId,
    source: 'match',
    name: m.matchName || '',
    gameType: m.gameType || '',
    deckType: m.deckType || '',
    playerNames: names,
    playerDecks: [],
    wins: [],
    score: '',
    winner: parseWinnerName(m.result),
    dateMs: endMs ?? startMs ?? null,
    bytes: null,
    rated: m.rated === true,
    legacy: false,
  }
}

/** Flatten a saved file's sidecar metadata into a row. */
export function rowFromFile(entry: ReplayFileEntry): ReplayRow {
  const meta: ReplayFileMeta | undefined = entry.meta
  const players = meta?.players ?? []
  const wins = players.map((p) => (typeof p.wins === 'number' ? p.wins : 0))
  const hasWins = players.some((p) => typeof p.wins === 'number')
  const dateMs = isoMs(meta?.endTime) ?? isoMs(meta?.startTime) ?? entry.savedAtMs ?? null
  return {
    gameId: entry.gameId,
    source: 'file',
    name: meta?.tableName || '',
    gameType: meta?.gameType || '',
    deckType: meta?.deckType || '',
    playerNames: players.map((p) => p.name),
    playerDecks: players.map((p) => p.deck ?? ''),
    wins,
    // Score only when at least one seat has a real win count (a backfilled
    // sidecar knows the winner, not the per-seat score).
    score: hasWins ? scoreFromWins(wins) : '',
    winner: meta?.winner ?? null,
    dateMs,
    bytes: typeof entry.bytes === 'number' ? entry.bytes : null,
    rated: false,
    // No sidecar (or a sidecar with no player list): nothing searchable beyond id+date.
    legacy: players.length === 0,
  }
}

/** Epoch ms from an epoch-ms number or an ISO string; null when unusable. */
function toMs(value: number | string | undefined): number | null {
  if (value == null) return null
  if (typeof value === 'number') return Number.isNaN(value) ? null : value
  return isoMs(value)
}

/** Epoch ms from an ISO date string; null when absent/unparseable. */
function isoMs(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}

/**
 * Merge both sources into deduped rows. A finished match's game ALSO exists as a
 * saved file; the match row wins (richer metadata). The `sourceFilter` narrows
 * to one source without changing the dedupe rule.
 */
export function buildReplayRows(
  finishedMatches: MatchView[],
  replayFiles: ReplayFileEntry[],
  sourceFilter: SourceFilter,
): ReplayRow[] {
  const matchRows: ReplayRow[] = []
  const matchGameIds = new Set<string>()
  for (const m of finishedMatches) {
    if (m.replayAvailable !== true || !m.games || m.games.length === 0) continue
    for (const g of m.games) {
      matchGameIds.add(g)
      matchRows.push(rowFromMatch(m, g))
    }
  }
  if (sourceFilter === 'match') return matchRows
  const fileRows = replayFiles
    .filter((f) => sourceFilter === 'file' || !matchGameIds.has(f.gameId))
    .map((f) => rowFromFile(f))
  return sourceFilter === 'all' ? [...matchRows, ...fileRows] : fileRows
}

/**
 * Whether a save FILE exists for this game id (proxy `getReplayFiles`). A row
 * from the finished-match source usually has none, but when the same game was
 * saved on disk the row merges richer match metadata WITHOUT losing the file
 * fact — and only a row with a save can offer the `/replay-file/` download.
 */
export function markRowsWithSave(rows: ReplayRow[], replayFiles: ReplayFileEntry[]): ReplayRow[] {
  const saved = new Set(replayFiles.map((f) => f.gameId))
  return rows.map((r) => (saved.has(r.gameId) ? { ...r, hasSave: true } : r))
}

/**
 * The proxy's HTTP download route for a saved replay's bytes.
 * A browser navigation (NOT fetch + downloadBlob — the bytes are remote and can
 * be large; the browser's own downloader handles progress and resume): it is
 * origin-absolute so the SPA's base path never leaks into it.
 */
export function replayDownloadUrl(gameId: string): string {
  return new URL(`/replay-file/${gameId}.game`, window.location.origin).toString()
}

/**
 * Case-insensitive substring across a row's searchable text: name/table,
 * game type, deck type, winner and every player/deck name.
 */
export function rowMatches(r: ReplayRow, q: string): boolean {
  if (!q) return true
  const needle = q.toLowerCase()
  const haystack = [r.name, r.gameType, r.deckType, r.winner ?? '', ...r.playerNames, ...r.playerDecks]
  return haystack.some((s) => s.toLowerCase().includes(needle))
}

export function compareRows(a: ReplayRow, b: ReplayRow, key: SortKey, dir: SortDir): number {
  const mul = dir === 'asc' ? 1 : -1
  const str = (s: string) => s.toLowerCase()
  switch (key) {
    case 'date': {
      // Rows without a date always sink to the bottom regardless of direction.
      if (a.dateMs == null && b.dateMs == null) return 0
      if (a.dateMs == null) return 1
      if (b.dateMs == null) return -1
      return (a.dateMs - b.dateMs) * mul
    }
    case 'size': {
      // A match row has no file size; treat it as 0 so sizes sort meaningfully.
      return ((a.bytes ?? 0) - (b.bytes ?? 0)) * mul
    }
    case 'name':
      return mul * str(a.name || a.gameId).localeCompare(str(b.name || b.gameId))
    case 'type':
      return mul * str(a.gameType).localeCompare(str(b.gameType))
    case 'winner':
      return mul * str(a.winner ?? '').localeCompare(str(b.winner ?? ''))
  }
}
