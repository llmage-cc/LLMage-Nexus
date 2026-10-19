/**
 * FixtureServer scenario for the LLMage post-port WS surfaces: the
 * COMPUTER_P1 training-deck pool (`getP1Decks`), the saved replay file browser
 * (`getReplayFiles`) and the LLM list verbs (`fetchModels` / `fetchPersonalities`),
 * plus the `llm_decision` / `llm_error` transport acks. Reuses `makeBaseScenario`
 * (connect/createTable/joinTable/chat/…) and adds the fork-only verbs through
 * `onExtra`, so a spec can drive the whole new-feature UI (P1 picker, replay
 * panel, LLM lists) against a deterministic backend.
 *
 * The wire shapes are fixed: `getP1Decks` → {decks, default},
 * `getReplayFiles` → {directory, exists, files}, `fetchModels` → {models},
 * `fetchPersonalities` → {personalities}, `llm_decision`/`llm_error` → {}.
 */

import { LLM_FAKE_CAPABILITIES, makeBaseScenario, type FakeConn, type Scenario } from '../fake'
import type { ReplayFileEntry } from '../../src/net/commands'
import type { GameView } from '../../src/net/types'

/** One training deck in the default pool; `deck` is paste-ready decklist TEXT. */
export interface LlmageP1Deck {
  name: string
  deck: string
}

export interface LlmageScenarioOptions {
  /** Capabilities block the fake connect result carries. */
  capabilities?: Record<string, unknown>
  /** The `getPlayerTypes` answer (default: the capability list). */
  playerTypes?: string[]
  /** The COMPUTER_P1 training pool (>=4 fixed decks). */
  p1Decks?: LlmageP1Deck[]
  /** The deterministic default deck name (must be in the pool). */
  p1Default?: string
  /** The `getReplayFiles` answer (3 rows by default, one legacy). */
  replayFiles?: { directory: string; exists: boolean; files: ReplayFileEntry[] }
  /** The `fetchModels` answer. */
  models?: string[]
  /** The `fetchPersonalities` answer. */
  personalities?: string[]
  /**
   * The view the fake `GAME_INIT`/`GAME_UPDATE` carry (absent = none). A spec
   * plants the LLM seat's `llmDebug` here so the drawer's LLM tab is driven by a
   * REAL server frame instead of a dev-hook injection.
   */
  gameView?: GameView
  /**
   * Request-capture hook. Called for EVERY action before the built-in answers;
   * return true when it answered the request (so the caller can assert the
   * verb was seen without the default handler also replying).
   */
  onVerb?: (conn: FakeConn, action: string, args: Record<string, unknown>, requestId: string | number) => boolean
  /** Fired right after a `createTable`/`createTournamentTable` OK, with the
   *  create call's args (see `onTableCreated` in the base scenario). */
  onTableCreated?: (conn: FakeConn, action: string, args: Record<string, unknown>) => void
}

/** The default P1 training pool: 4 fixed decks, one the deterministic default. */
export const DEFAULT_P1_DECKS: LlmageP1Deck[] = [
  { name: 'Izzet Spellementals', deck: '4 Lightning Bolt\n4 Consider\n20 Island\n' },
  { name: 'Mono Red Aggro', deck: '4 Monastery Swiftspear\n4 Lightning Strike\n20 Mountain\n' },
  { name: 'Azorius Control', deck: '4 Counterspell\n4 Wrath of God\n24 Plains\n' },
  { name: 'Golgari Midrange', deck: '4 Thoughtseize\n4 Tarmogoyf\n24 Swamp\n' },
]

export const DEFAULT_P1_DEFAULT = 'Izzet Spellementals'

/** Default replay listing: 3 rows, one legacy (no `meta`), one with a full sidecar. */
export const DEFAULT_REPLAY_FILES: { directory: string; exists: boolean; files: ReplayFileEntry[] } = {
  directory: '/var/lib/xmage/replays',
  exists: true,
  files: [
    {
      gameId: 'replay-full-0001',
      bytes: 24_576,
      savedAtMs: 1_700_000_000_000,
      meta: {
        gameId: 'replay-full-0001',
        tableName: 'Ranked Modern',
        gameType: 'Two Player Duel',
        deckType: 'Constructed - Modern',
        winner: 'Alice',
        turns: 9,
        players: [
          { name: 'Alice', wins: 2, deck: 'Izzet Spellementals' },
          { name: 'Bob', wins: 1, deck: 'Mono Red Aggro' },
        ],
        startTime: '2023-11-14T22:13:20.000Z',
        endTime: '2023-11-14T22:31:20.000Z',
        savedAt: '2023-11-14T22:31:25.000Z',
      },
    },
    {
      gameId: 'replay-legacy-0002',
      bytes: 8_192,
      savedAtMs: 1_699_000_000_000,
    },
    {
      gameId: 'replay-full-0003',
      bytes: 16_384,
      savedAtMs: 1_698_000_000_000,
      meta: {
        gameId: 'replay-full-0003',
        tableName: 'Commander Night',
        gameType: 'Commander',
        deckType: 'Variant Magic - Commander',
        winner: 'Cid',
        turns: 14,
        players: [
          { name: 'Cid', wins: 1, deck: 'Azorius Control' },
          { name: 'Dora', wins: 0, deck: 'Golgari Midrange', quit: true },
        ],
        startTime: '2023-11-01T10:00:00.000Z',
        endTime: '2023-11-01T10:45:00.000Z',
        savedAt: '2023-11-01T10:45:05.000Z',
      },
    },
  ],
}

export const DEFAULT_LLM_MODELS: string[] = ['gpt-4o', 'llama-3.3-70b', 'deepseek-v4.1-flash']
export const DEFAULT_LLM_PERSONALITIES: string[] = ['Aggressive', 'Analytical', 'Balanced']

/**
 * Build the LLMage scenario. Answer contract (frozen):
 *   getPlayerTypes    → playerTypes (default: the capability list)
 *   getFinishedMatches → []
 *   getP1Decks        → { decks, default }
 *   getReplayFiles    → { directory, exists, files }
 *   fetchModels       → { models }
 *   fetchPersonalities→ { personalities }
 *   llm_decision/llm_error → {} (ack; the client only checks ok)
 * Everything else falls through to `makeBaseScenario` (connect carries the
 * capabilities block).
 */
export function llmageScenario(opts: LlmageScenarioOptions = {}): Scenario {
  const capabilities = opts.capabilities ?? LLM_FAKE_CAPABILITIES
  const playerTypes =
    opts.playerTypes
    ?? (Array.isArray(capabilities.playerTypes) ? (capabilities.playerTypes as string[]) : [])
  const p1Decks = opts.p1Decks ?? DEFAULT_P1_DECKS
  const p1Default = opts.p1Default ?? DEFAULT_P1_DEFAULT
  const replayFiles = opts.replayFiles ?? DEFAULT_REPLAY_FILES
  const models = opts.models ?? DEFAULT_LLM_MODELS
  const personalities = opts.personalities ?? DEFAULT_LLM_PERSONALITIES

  return makeBaseScenario({
    tableId: 'llmage-table-1',
    tableName: 'llmage-e2e',
    gameId: 'llmage-game-1',
    capabilities,
    playerTypes,
    gameView: opts.gameView,
    onTableCreated: opts.onTableCreated,
    onExtra: (conn, action, args, requestId) => {
      if (opts.onVerb?.(conn, action, args, requestId)) return true
      switch (action) {
        case 'getFinishedMatches':
          conn.ok(requestId, action, [])
          return true
        case 'getP1Decks':
          conn.ok(requestId, action, { decks: p1Decks, default: p1Default })
          return true
        case 'getReplayFiles':
          conn.ok(requestId, action, {
            directory: replayFiles.directory,
            exists: replayFiles.exists,
            files: replayFiles.files,
          })
          return true
        case 'fetchModels':
          conn.ok(requestId, action, { models })
          return true
        case 'fetchPersonalities':
          conn.ok(requestId, action, { personalities })
          return true
        case 'llm_decision':
        case 'llm_error':
          conn.ok(requestId, action, {})
          return true
        default:
          return false
      }
    },
  })
}
