import { parseFeedback, type FeedbackCard, type FeedbackPrompt } from '../game/feedback'
import { TOP_CARD_PEEK_NAME } from '../game/topCardPeek'
import type {
  CardView,
  GameView,
  PlayerView,
  LobbyEnvelope,
  TableView,
  SeatView,
  UsersView,
  TournamentView,
  TournamentPlayerView,
  TournamentGameView,
  RoundView,
  SimpleCardView,
  SimpleCardsView,
  ChatMessageEvent,
  GameEndInfo,
} from '../net/types'
import type { DraftState, ConstructState } from '../state/slices/limited'
import type { ConnectionInfo } from '../state/persistence'
import type { SupportedLanguage } from '../i18n'
import type { Deck } from '../lobby/decks'
import type { RollbackVote } from '../state/rollbackVote'
import { STORAGE_KEY as CREATE_TABLE_STORAGE_KEY } from '../lobby/CreateTable/constants'
import manifest from '../../fixtures/recorded/manifest.json'

interface FrameModule {
  default: { gameId: string; gameView: GameView }
}

const frameModules = import.meta.glob<FrameModule>('../../fixtures/recorded/*.json', { eager: true })

// Fixed date (not `Date.now()`): the gallery sample data is evaluated once per
// page load, so a "live" timestamp differs between baseline generation and any
// later run — it makes `toHaveScreenshot()` flaky on any screen that paints an
// absolute time/date (e.g. tournament start/end).
const GALLERY_EPOCH = new Date('2026-01-01T12:00:00Z').getTime()

export interface RecordedFrame {
  file: string
  mechanic: string
  note: string
  gameId: string
  gameView: GameView
}

export const recordedFrames: RecordedFrame[] = manifest
  .filter((entry) => entry.kind === 'game')
  .map((entry) => {
    const mod = frameModules[`../../fixtures/recorded/${entry.file}`]
    if (!mod?.default?.gameView) return null
    return {
      file: entry.file,
      mechanic: entry.mechanic,
      note: entry.note,
      gameId: mod.default.gameId,
      gameView: mod.default.gameView,
    }
  })
  .filter((frame): frame is RecordedFrame => frame != null)

export type GalleryScreenName =
  | 'lobby'
  | 'decks'
  | 'draft'
  | 'construct'
  | 'tournament'
  | 'setup'
  | 'wizard'
  | 'staging'
  | 'settings'
  | 'appearance'
  | 'about'
  | 'help'
  | 'gameend'
  | 'cards'

export interface GalleryEntry {
  id: string
  group: string
  label: string
  description?: string
  phase?: 'idle' | 'connecting' | 'lobby' | 'game'
  /** Screen not covered by `game`/`login`: lobby, deck editor, draft, construct, tournament… */
  screen?: GalleryScreenName
  game?: GameView | null
  gameId?: string | null
  feedback?: FeedbackPrompt | null
  playableIds?: string[]
  lobby?: LobbyEnvelope
  conn?: ConnectionInfo
  draft?: DraftState
  construct?: ConstructState
  tournamentModal?: { table: TableView; view: TournamentView | null; loading?: boolean; error?: string | null }
  /** store `tournament`: mounts the TournamentPanel inside GameScreen. */
  tournament?: { tournamentId: string; view: TournamentView } | null
  /** Session-slice error (lobby banner / LoginScreen box). */
  error?: string | null
  gameEnd?: GameEndInfo | null
  /** Draft-stall watchdog (`lastDraftEventAt`); 0 = always stalled. */
  lastDraftEventAt?: number | null
  /** Explicit `table` of SpectatorStagingScreen (player mode). */
  stagingTable?: TableView
  stagingMode?: 'player' | 'spectator'
  /** Deck in play (`myDeck` in the store); omitted = keep the current one. */
  myDeck?: Deck | null
  chatMessages?: ChatMessageEvent[]
  boardLayout?: 'standard' | 'pod' | 'arena'
  /** Rollback vote dialog state (`rollbackVote` in the store). */
  rollbackVote?: RollbackVote | null
  uiScale?: number
  cjkBoost?: boolean
  /** i18n language for this state (restored on exit). */
  lang?: SupportedLanguage
  /** Disconnected session: App paints the reconnect banner. */
  connecting?: boolean
  /** localStorage seed applied before mount (create-table wizard). */
  storageSeed?: Record<string, string>
}

function players(game: GameView): PlayerView[] {
  return game.players ?? []
}

function controlledPlayer(game: GameView): PlayerView | undefined {
  return players(game).find((p) => p.controlled) ?? players(game)[0]
}

function opponentPlayer(game: GameView): PlayerView | undefined {
  return players(game).find((p) => p !== controlledPlayer(game)) ?? players(game)[1]
}

function battlefieldIds(player: PlayerView | undefined): string[] {
  return Object.keys(player?.battlefield ?? {})
}

function landIds(player: PlayerView | undefined): string[] {
  return Object.entries(player?.battlefield ?? {})
    .filter(([, perm]) => (perm.cardTypes ?? []).some((t) => String(t).toLowerCase() === 'land'))
    .map(([id]) => id)
}

function creatureIds(player: PlayerView | undefined): string[] {
  return Object.entries(player?.battlefield ?? {})
    .filter(([, perm]) => (perm.cardTypes ?? []).some((t) => String(t).toLowerCase() === 'creature'))
    .map(([id]) => id)
}

function cardOf(player: PlayerView | undefined, id: string): FeedbackCard {
  const perm = player?.battlefield?.[id]
  return {
    id,
    name: perm?.name ?? id,
    expansionSetCode: perm?.expansionSetCode,
    cardNumber: perm?.cardNumber,
    cardTypes: perm?.cardTypes,
  }
}

function targetPrompt(game: GameView, gameId: string, required: boolean): FeedbackPrompt {
  const me = controlledPlayer(game)
  const opponent = opponentPlayer(game)
  const targetId = creatureIds(opponent)[0] ?? battlefieldIds(opponent)[0] ?? creatureIds(me)[0] ?? battlefieldIds(me)[0] ?? 'target'
  const card = cardOf(opponent, targetId)
  return {
    method: 'GAME_TARGET',
    gameId,
    title: 'Select target creature',
    message: required ? 'Select target creature' : "Select up to one target creature you don't control",
    mode: 'uuid',
    options: [{ id: targetId, label: card.name, value: targetId }],
    min: 1,
    max: 1,
    required,
    sourceName: 'Lightning Bolt',
  }
}

const LIBRARY_CARDS: FeedbackCard[] = [
  { id: 'g1', name: 'Opt', expansionSetCode: 'M21', cardNumber: '59', cardTypes: ['Instant'] },
  { id: 'g2', name: 'Consider', expansionSetCode: 'MID', cardNumber: '44', cardTypes: ['Instant'] },
  { id: 'g3', name: 'Lightning Bolt', expansionSetCode: '2XM', cardNumber: '129', cardTypes: ['Instant'] },
  { id: 'g4', name: 'Counterspell', expansionSetCode: 'MH2', cardNumber: '267', cardTypes: ['Instant'] },
  { id: 'g5', name: 'Elvish Mystic', expansionSetCode: 'M14', cardNumber: '169', cardTypes: ['Creature'] },
  { id: 'g6', name: 'Forest', expansionSetCode: 'M21', cardNumber: '277', cardTypes: ['Land'] },
]

// ─── New screens: lobby, editor, draft, construct, tournament ────────────────

const GALLERY_CONN: ConnectionInfo = {
  wsHost: 'localhost',
  proxyPort: 8787,
  serverHost: 'localhost',
  port: 17171,
  username: 'gallery-dev',
  password: '',
}

function makeSeat(playerName: string, seatIndex: number, playerType = 'Human'): SeatView {
  return { playerName, seatIndex, playerType }
}

const LOBBY_GAME_TYPES = ['Standard', 'Modern', 'Commander', 'Pauper', 'Draft (BLB)', 'Sealed (DSK)', 'Two-Headed Giant']
const LOBBY_NAMES = ['Alice', 'Bora', 'Chen', 'Dara', 'Enzo', 'Fran', 'Gus', 'Heidi']

function makeLobbyTable(i: number, overrides: Partial<TableView> = {}): TableView {
  const state = ['WAITING', 'DUELING', 'SIDEBOARDING', 'FINISHED'][i % 4]
  return {
    tableId: `gallery-table-${i}`,
    gameType: LOBBY_GAME_TYPES[i % LOBBY_GAME_TYPES.length],
    deckType: 'Constructed',
    tableName: `Table ${LOBBY_NAMES[i % LOBBY_NAMES.length]} #${i + 1}`,
    controllerName: LOBBY_NAMES[i % LOBBY_NAMES.length],
    additionalInfoShort: '',
    additionalInfoFull: '',
    createTime: GALLERY_EPOCH - i * 60_000,
    tableState: state,
    skillLevel: 'CASUAL',
    tableStateText: state,
    seatsInfo: '1/4',
    isTournament: i % 7 === 0,
    seats: [makeSeat(LOBBY_NAMES[i % LOBBY_NAMES.length], 0), makeSeat('', 1, 'Open')],
    games: [],
    quitRatio: '0',
    minimumRating: '0',
    limited: i % 5 === 0,
    rated: i % 3 === 0,
    passworded: i % 9 === 0,
    spectatorsAllowed: true,
    ...overrides,
  }
}

// Real `User.getPingInfo()` shapes, captured through the proxy: the last one is
// what our own connections carry (nobody measures a browser's latency), and the
// badge stays hidden for it.
const GALLERY_PINGS = [
  '22ms (avg: 24ms)  (online: 4:11; seen: 1 sec ago)',
  '112ms (avg: 120ms)  (online: 1:02; seen: 3 sec ago)',
  '240ms (avg: 205ms)  (online: 0:40; seen: 8 sec ago)',
  '  (online: 0:00; seen: 2 sec ago)',
]

function makeLobbyUser(i: number): UsersView {
  return {
    flagName: 'es',
    userName: `${LOBBY_NAMES[i % LOBBY_NAMES.length]}${i}`,
    matchHistory: '',
    matchQuitRatio: 0,
    tourneyHistory: '',
    tourneyQuitRatio: 0,
    infoGames: '0',
    infoPing: GALLERY_PINGS[i % GALLERY_PINGS.length],
    generalRating: 1500 + i,
    constructedRating: 1500 + i,
    limitedRating: 1500 + i,
  }
}

const LOBBY_EMPTY: LobbyEnvelope = { type: 'lobby', tables: [], users: [], serverMessages: [] }

const LOBBY_OVERFLOW: LobbyEnvelope = {
  type: 'lobby',
  tables: Array.from({ length: 48 }, (_, i) => makeLobbyTable(i)),
  users: Array.from({ length: 55 }, (_, i) => makeLobbyUser(i)),
  serverMessages: [],
}

function makeSimpleCard(id: string, set: string, num: string, name: string): SimpleCardView {
  return { id, expansionSetCode: set, cardNumber: num, name }
}

function cardsById(cards: SimpleCardView[]): SimpleCardsView {
  const m: SimpleCardsView = {}
  for (const c of cards) m[c.id] = c
  return m
}

const DRAFT_SET_CODES = ['BLB', 'DSK', 'OTJ']
function makeDraftPack(prefix: string, size: number): SimpleCardView[] {
  return Array.from({ length: size }, (_, i) => {
    const set = DRAFT_SET_CODES[i % DRAFT_SET_CODES.length]
    return makeSimpleCard(`${prefix}-${i}`, set, String((i % 270) + 1), `${set} Card ${i}`)
  })
}

const DRAFT_INPROGRESS: DraftState = {
  draftId: 'gallery-draft-1',
  message: {
    draftView: {
      setNames: ['Bloomburrow'],
      setCodes: ['BLB'],
      boosterNum: 1,
      cardNum: 3,
      players: ['gallery-dev', 'alice', 'bora', 'chen', 'dara', 'enzo', 'fran', 'grace'],
    },
    draftPickView: {
      booster: cardsById(makeDraftPack('booster', 14)),
      picks: cardsById(makeDraftPack('pick', 2)),
      picking: true,
      timeout: 60,
    },
  },
  timeLeft: 42,
}

const DRAFT_WAITING: DraftState = {
  draftId: 'gallery-draft-2',
  message: {
    draftView: {
      setNames: ['Bloomburrow', 'Duskmourn', 'Outlaws of Thunder Junction'],
      setCodes: DRAFT_SET_CODES,
      boosterNum: 2,
      cardNum: 15,
      players: ['gallery-dev', 'alice-de-los-santos', 'bora-hernandez', 'chen-wei-long', 'dara-o-shaughnessy', 'enzo-fitzgerald', 'fran-de-la-cruz', 'grace-nakamura'],
    },
    draftPickView: { booster: {}, picks: cardsById(makeDraftPack('pick', 10)), picking: false, timeout: 60 },
  },
}

function makeConstructPool(size: number): SimpleCardsView {
  return cardsById(makeDraftPack('pool', size))
}

const CONSTRUCT_STATE_NORMAL: ConstructState = {
  deckName: 'My sealed deck',
  pool: makeConstructPool(45),
  tableId: 'gallery-construct-1',
  parentTableId: null,
  timeLeft: 900,
}

const CONSTRUCT_STATE_BIG: ConstructState = {
  deckName: 'Big pool (cube)',
  pool: makeConstructPool(90),
  tableId: 'gallery-construct-2',
  parentTableId: null,
  timeLeft: 60,
}

function makeTournamentPlayer(name: string, points: number, state = 'ACTIVE'): TournamentPlayerView {
  return { name, state, points, results: '', history: '' }
}

function makeTournamentGame(roundNum: number, players: string, state: string, result = ''): TournamentGameView {
  return { roundNum, state, players, result }
}

const TOURNAMENT_TABLE = makeLobbyTable(0, { tableId: 'gallery-tournament-table', tableName: 'Standard Swiss #12', isTournament: true })

const TOURNAMENT_INPROGRESS: TournamentView = {
  tournamentName: 'Standard Swiss — Round 2 of 3',
  tournamentType: 'Swiss',
  tournamentState: 'DUELING',
  startTime: GALLERY_EPOCH - 30 * 60_000,
  constructionTime: 0,
  watchingAllowed: true,
  players: [
    makeTournamentPlayer('alice', 3),
    makeTournamentPlayer('bora', 3),
    makeTournamentPlayer('chen', 1.5),
    makeTournamentPlayer('dara', 1.5),
    makeTournamentPlayer('enzo', 0),
    makeTournamentPlayer('fran', 0),
  ],
  rounds: [
    { games: [makeTournamentGame(1, 'alice vs chen', 'COMPLETED', '2-0'), makeTournamentGame(1, 'bora vs dara', 'COMPLETED', '2-1'), makeTournamentGame(1, 'enzo vs fran', 'COMPLETED', '1-2')] },
    { games: [makeTournamentGame(2, 'alice vs bora', 'DUELING', ''), makeTournamentGame(2, 'dara vs fran', 'DUELING', ''), makeTournamentGame(2, 'chen vs enzo', 'DUELING', '')] },
  ] satisfies RoundView[],
}

const TOURNAMENT_FINISHED: TournamentView = {
  ...TOURNAMENT_INPROGRESS,
  tournamentName: 'Standard Swiss — Finished',
  tournamentState: 'END',
  endTime: GALLERY_EPOCH,
  players: [
    makeTournamentPlayer('alice', 6, 'FINISHED'),
    makeTournamentPlayer('bora', 4.5, 'FINISHED'),
    makeTournamentPlayer('dara', 3, 'FINISHED'),
    makeTournamentPlayer('chen', 1.5, 'FINISHED'),
    makeTournamentPlayer('fran', 1.5, 'FINISHED'),
    makeTournamentPlayer('enzo', 0, 'FINISHED'),
  ],
  rounds: [
    TOURNAMENT_INPROGRESS.rounds[0],
    { games: [makeTournamentGame(2, 'alice vs bora', 'COMPLETED', '2-0'), makeTournamentGame(2, 'dara vs fran', 'COMPLETED', '2-1'), makeTournamentGame(2, 'chen vs enzo', 'COMPLETED', '2-0')] },
    { games: [makeTournamentGame(3, 'alice vs dara', 'COMPLETED', '2-0'), makeTournamentGame(3, 'bora vs fran', 'COMPLETED', '2-1'), makeTournamentGame(3, 'chen vs enzo', 'COMPLETED', '2-0')] },
  ],
}

// ─── State matrix: board variants, screens and globals ───────────────────
// Everything here derives from the recorded frames or from the real props/slices of
// each screen. No backend: states that only exist from a server response
// (e.g. draft `pickError`) are documented as pending.

const GALLERY_ISO = new Date(GALLERY_EPOCH).toISOString()
const GALLERY_ISO_END = new Date(GALLERY_EPOCH + 14 * 60_000).toISOString()

const GANG_BLOCK_FRAME = recordedFrames.find((f) => f.file === 'gang-block.json')
const COMMANDER_FRAME = recordedFrames.find((f) => f.file === 'commander-free-mulligan.json')
const SLICER_ASK_RULE =
  "At the beginning of each opponent's upkeep, you may have that player gain control of {this} until end of turn. If you do, untap {this}, goad it, and it can't be sacrificed this turn. If you don't, convert it."

type MutableRecord = Record<string, unknown>

function isPlainObject(value: unknown): value is MutableRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Clones replacing ids (keys and values) through the given map; everything else as-is. */
function remapIds<T>(value: T, map: (id: string) => string | undefined): T {
  if (typeof value === 'string') return (map(value) ?? value) as unknown as T
  if (Array.isArray(value)) return value.map((v) => remapIds(v, map)) as unknown as T
  if (isPlainObject(value)) {
    const out: MutableRecord = {}
    for (const [k, v] of Object.entries(value)) out[map(k) ?? k] = remapIds(v, map)
    return out as unknown as T
  }
  return value
}

function playerCardIds(player: PlayerView): Set<string> {
  const ids = new Set<string>([player.playerId])
  const addKeys = (zone: unknown) => {
    if (isPlainObject(zone)) for (const id of Object.keys(zone)) ids.add(id)
  }
  addKeys(player.battlefield)
  addKeys(player.graveyard)
  addKeys(player.exile)
  addKeys(player.sideboard)
  addKeys(player.helperCards)
  for (const card of (player.commandList ?? []) as Array<{ id?: string }>) {
    if (card?.id) ids.add(card.id)
  }
  const topCard = player.topCard as { id?: string } | null | undefined
  if (topCard?.id) ids.add(topCard.id)
  return ids
}

/** Synthetic FFA: clones one frame opponent with unique ids (uuid + suffix) and their hand. */
function withClonedOpponent(game: GameView, src: PlayerView | undefined, suffix: string, name?: string): GameView {
  if (!src) return game
  const ids = playerCardIds(src)
  const map = (id: string) => (ids.has(id) ? `${id}-${suffix}` : undefined)
  const clone = { ...remapIds(src, map), name: name ?? src.name }
  const srcHand = game.opponentHands?.[src.playerId]
  const opponentHands = srcHand ? { ...(game.opponentHands ?? {}), [clone.playerId]: remapIds(srcHand, map) } : game.opponentHands
  return { ...game, players: [...players(game), clone], opponentHands }
}

/** Synthetic N-card hand reusing the frame's cards with new ids. */
function withHandSize(game: GameView, size: number): GameView {
  const hand = (game.myHand ?? {}) as Record<string, unknown>
  const entries = Object.entries(hand)
  if (entries.length === 0 || entries.length >= size) return game
  const next: Record<string, unknown> = { ...hand }
  let i = 0
  while (Object.keys(next).length < size) {
    const [id, card] = entries[i % entries.length]
    const nextId = `${id}-x${i + 1}`
    next[nextId] = { ...(remapIds(card, (v) => (v === id ? nextId : undefined)) as MutableRecord), id: nextId }
    i++
  }
  const me = controlledPlayer(game)
  return {
    ...game,
    myHand: next as GameView['myHand'],
    players: players(game).map((p) => (p === me ? { ...p, handCount: size } : p)),
  }
}

/** Fills each player's battlefield by cloning their creatures/lands up to N (new ids). */
function withCrowdedBattlefields(game: GameView, creatures: number, lands: number): GameView {
  const grow = (player: PlayerView, kind: 'creature' | 'land', target: number): PlayerView => {
    const battlefield = { ...(player.battlefield ?? {}) } as unknown as Record<string, MutableRecord>
    const pool = Object.entries(battlefield).filter(([, perm]) =>
      (perm.cardTypes as string[] | undefined ?? []).some((t) => String(t).toLowerCase() === kind),
    )
    if (pool.length === 0) return player
    let have = pool.length
    let i = 0
    while (have < target) {
      const [id, perm] = pool[i % pool.length]
      const nextId = `${id}-crowd${i + 1}`
      battlefield[nextId] = { ...(remapIds(perm, (v) => (v === id ? nextId : undefined)) as MutableRecord), id: nextId, attachments: [] }
      have++
      i++
    }
    return { ...player, battlefield: battlefield as unknown as PlayerView['battlefield'] }
  }
  return {
    ...game,
    players: players(game).map((p) => grow(grow(p, 'creature', creatures), 'land', lands)),
  }
}

const LONG_ME = 'Alejandro-de-la-Vega-Fernández-Castillo'
const LONG_OPP = 'Bartholomew-Montgomery-Fitzwilliam-III'
const LONG_CARD = 'Asmoranomardicadaistinaculdacar'

/** Long player and card names (label overflow). */
function withLongNames(game: GameView): GameView {
  const renamed = players(game).map((p) => ({ ...p, name: p.controlled ? LONG_ME : LONG_OPP }))
  const me = renamed.find((p) => p.controlled)
  const renameFirst = (zone: unknown): unknown => {
    if (!isPlainObject(zone)) return zone
    const out: MutableRecord = {}
    let first = true
    for (const [id, card] of Object.entries(zone)) {
      out[id] = first && isPlainObject(card) ? { ...card, name: LONG_CARD, displayName: LONG_CARD, displayFullName: LONG_CARD } : card
      first = false
    }
    return out
  }
  const activeName = game.activePlayerId === me?.playerId ? LONG_ME : game.activePlayerId ? LONG_OPP : game.activePlayerName
  return {
    ...game,
    players: renamed.map((p) => (p === me ? { ...p, battlefield: renameFirst(p.battlefield) as PlayerView['battlefield'] } : p)),
    myHand: renameFirst(game.myHand) as GameView['myHand'],
    activePlayerName: activeName,
    priorityPlayerName: game.priorityPlayerName ? activeName : game.priorityPlayerName,
  }
}

// gang-block is 1v1: the frame opponent is cloned TWICE (c1/c2) to reach 4.
const FOUR_PLAYER_GAME = GANG_BLOCK_FRAME
  ? (() => {
      const game = GANG_BLOCK_FRAME.gameView
      const opp = opponentPlayer(game)
      return withClonedOpponent(withClonedOpponent(game, opp, 'c1', 'sim-000042'), opp, 'c2', 'sim-000043')
    })()
  : null
const CROWDED_POD_GAME = FOUR_PLAYER_GAME ? withCrowdedBattlefields(FOUR_PLAYER_GAME, 16, 14) : null
const THREE_PLAYER_COMMANDER = COMMANDER_FRAME?.gameView ?? null
const HAND_15_GAME = GANG_BLOCK_FRAME ? withHandSize(GANG_BLOCK_FRAME.gameView, 15) : null
const LONG_NAMES_GAME = GANG_BLOCK_FRAME ? withLongNames(GANG_BLOCK_FRAME.gameView) : null
const TOP_CARD_PEEK_GAME = GANG_BLOCK_FRAME ? withTopCardPeek(GANG_BLOCK_FRAME.gameView) : null

function withTopCardPeek(gv: GameView): GameView {
  const top = Object.values(gv.myHand ?? {})[0]
  if (!top?.id) return gv
  const peeked = { ...top, id: 'gallery-peek-top' }
  return { ...gv, lookedAt: [{ name: TOP_CARD_PEEK_NAME, cards: { [peeked.id]: peeked } }] }
}

const STAGING_TABLE = makeLobbyTable(0, {
  tableId: 'gallery-staging-table',
  tableName: 'Welcome duel',
  gameType: 'Two Player Duel',
  deckType: 'Constructed - Pioneer',
  controllerName: 'gallery-dev',
  tableState: 'WAITING',
  tableStateText: 'Waiting for players',
  seatsInfo: '2/2',
  seats: [
    { playerName: 'gallery-dev', seatIndex: 0, playerType: 'HUMAN', flagName: 'es', constructedRating: 1520, history: '3-1' },
    { playerName: 'bora-the-bold', seatIndex: 1, playerType: 'HUMAN', flagName: 'ru', constructedRating: 1602, history: '12-5' },
  ],
})

const STAGING_DECK: Deck = {
  id: 'gallery-staging-deck',
  name: 'Rakdos Midrange',
  cards: [
    { cardName: 'Bloodtithe Harvester', setCode: 'VOW', cardNumber: '232', amount: 4 },
    { cardName: 'Fable of the Mirror-Breaker', setCode: 'NEO', cardNumber: '141', amount: 4 },
    { cardName: 'Swamp', setCode: 'LEA', cardNumber: '295', amount: 26 },
    { cardName: 'Mountain', setCode: 'LEA', cardNumber: '292', amount: 26 },
  ],
  sideboard: [],
}

const STAGING_POD_TABLE = makeLobbyTable(0, {
  tableId: 'gallery-staging-pod',
  tableName: 'Friday Commander',
  gameType: 'Commander Free For All',
  deckType: 'Variant Magic - Commander',
  controllerName: 'gallery-dev',
  tableState: 'WAITING',
  tableStateText: 'Waiting for players',
  seatsInfo: '3/4',
  seats: [
    { playerName: 'gallery-dev', seatIndex: 0, playerType: 'HUMAN', flagName: 'es', constructedRating: 1520, history: '3-1' },
    { playerName: 'bora-the-bold', seatIndex: 1, playerType: 'HUMAN', flagName: 'ru', constructedRating: 1602, history: '12-5' },
    { playerName: 'sim-000042', seatIndex: 2, playerType: 'SIM' },
    { playerName: '', seatIndex: 3, playerType: 'HUMAN' },
  ],
})

const STAGING_OPEN_TABLE = makeLobbyTable(0, {
  tableId: 'gallery-staging-open',
  tableName: 'Pauper 1v1',
  gameType: 'Two Player Duel',
  deckType: 'Constructed - Pauper',
  controllerName: 'bora-the-bold',
  tableState: 'WAITING',
  tableStateText: 'Waiting for players',
  seatsInfo: '1/2',
  seats: [
    { playerName: 'bora-the-bold', seatIndex: 0, playerType: 'HUMAN', flagName: 'ru', constructedRating: 1602, history: '12-5' },
    { playerName: '', seatIndex: 1, playerType: 'HUMAN' },
  ],
})

const STAGING_CHAT: ChatMessageEvent[] = [
  { chatId: 'gallery-staging-chat', username: 'gallery-dev', message: '[NEXUS_NOT_READY] gallery-dev', time: GALLERY_EPOCH },
  { chatId: 'gallery-staging-chat', username: 'bora-the-bold', message: '[NEXUS_READY] bora-the-bold', time: GALLERY_EPOCH + 1000 },
]

const GAME_END_GAME: GameEndInfo = {
  won: false,
  gameInfo: `${LONG_OPP} has won the game`,
  wins: 0,
  loses: 1,
  winsNeeded: 2,
  startTime: GALLERY_ISO,
  endTime: GALLERY_ISO_END,
  matchView: { matchId: 'gallery-match-1', result: '', players: `${LONG_ME} vs ${LONG_OPP}`, games: ['1'], startTime: GALLERY_ISO, endTime: null },
}

const GAME_END_MATCH: GameEndInfo = {
  won: true,
  gameInfo: `${LONG_ME} has won the game`,
  matchInfo: `${LONG_ME} has won the match 2-1`,
  wins: 2,
  loses: 1,
  winsNeeded: 2,
  startTime: GALLERY_ISO,
  endTime: GALLERY_ISO_END,
  matchView: { matchId: 'gallery-match-1', result: '2-1', players: `${LONG_ME} vs ${LONG_OPP}`, games: ['1', '2', '3'], startTime: GALLERY_ISO, endTime: GALLERY_ISO_END },
}

// Real wire state: `TournamentView.tournamentState` is the fork's
// `TableState` text ("Constructing"/"Dueling"/"Finished"), not the enum.
const TOURNAMENT_WAITING: TournamentView = {
  ...TOURNAMENT_INPROGRESS,
  tournamentName: 'Standard Swiss — Constructing',
  tournamentState: 'Constructing',
  startTime: GALLERY_EPOCH - 2 * 60_000,
  constructionTime: 600,
  rounds: [],
}

// Persisted form «Draft MH3 (8P)»: the wizard re-reads it on mount (the
// invalid combination is NOT representable: the setters and a mount effect
// auto-correct it, see `useCreateTableForm`). `seatConfigs` = 7 SIM seats.
const WIZARD_DRAFT_FORM = JSON.stringify({
  tableCategory: 'tourney',
  tournamentCategory: 'limited',
  useDraftTournament: true,
  name: 'Gallery MH3 Draft',
  gameType: 'Two Player Duel',
  deckType: 'Limited',
  wins: 2,
  skillLevel: 'CASUAL',
  rated: false,
  numPlayers: 8,
  seatConfigs: Array.from({ length: 7 }, () => ({ type: 'SIM', deckName: '', skill: 2 })),
})

export function buildGalleryEntries(): GalleryEntry[] {
  const entries: GalleryEntry[] = recordedFrames.map((frame) => ({
    id: `frame:${frame.mechanic}`,
    group: 'Real frames',
    label: frame.mechanic,
    description: frame.note,
    phase: 'game',
    game: frame.gameView,
    gameId: frame.gameId,
  }))

  // gang-block is the frame with creatures on both sides (realistic targets)
  // and untapped lands for the controlled player (mana payment).
  const base =
    recordedFrames.find((f) => f.file === 'gang-block.json') ??
    recordedFrames.find((f) => f.file === 'combat.json') ??
    recordedFrames[0]
  if (base) {
    const { game, gameId } = { game: base.gameView, gameId: base.gameId }
    const me = controlledPlayer(game)
    const myLands = landIds(me)
    const myPermanents = battlefieldIds(me)
    // Real server shape: `CardsView(abilities, game)` serializes AbilityView
    // (name "Ability" + nested sourceCard/sourceName) — not a flat FeedbackCard.
    const triggers = myPermanents.slice(0, 2).map((id, index) => {
      const source = cardOf(me, id)
      const sourceName = source.name ?? id
      return {
        id: `${id}:ability-${index}`,
        name: sourceName,
        sourceName,
        sourceCard: source,
        expansionSetCode: source.expansionSetCode,
        cardNumber: source.cardNumber,
        rules: [`Whenever ${sourceName} or another creature enters the battlefield, you gain 1 life.`],
      }
    })
    const myHandCards = Object.entries(game.myHand ?? {}).map(([id, card]) => ({
      id: card.id ?? id,
      name: card.name ?? id,
      displayName: card.displayName,
      expansionSetCode: card.expansionSetCode,
      cardNumber: card.cardNumber,
      cardTypes: card.cardTypes,
    }))

    const graveZoneCard: CardView = {
      id: 'zone-grave-1',
      parentId: 'zone-grave-1',
      name: 'Grizzly Bears',
      displayName: 'Grizzly Bears',
      manaValue: 2,
      expansionSetCode: 'IMA',
      cardNumber: '165',
      cardTypes: ['Creature'],
      power: '2',
      toughness: '2',
    }
    const graveyardGame: GameView = {
      ...game,
      players: (game.players ?? []).map((player) =>
        player.controlled
          ? { ...player, graveyard: { ...player.graveyard, 'zone-grave-1': graveZoneCard } }
          : player,
      ),
    }

    // Jace, the Mind Sculptor +2: the top card arrives in `lookedAt` (the
    // "Looked at" viewer, which latches and stays open) and the engine's decision is a
    // boolean GAME_ASK: Yes = send it to the bottom, No = leave it on top.
    const jaceTopCard: CardView = {
      id: 'jace-top-1',
      parentId: 'jace-top-1',
      name: 'Island',
      displayName: 'Island',
      expansionSetCode: 'iko',
      cardNumber: '263',
      manaValue: 0,
      cardTypes: ['Land'],
    }
    const jaceTopGame: GameView = {
      ...game,
      lookedAt: [{ name: 'Jace, the Mind Sculptor', cards: { 'jace-top-1': jaceTopCard } }],
    }

    const prompts: { id: string; label: string; description: string; prompt: FeedbackPrompt; playableIds?: string[]; game?: GameView }[] = [
      {
        id: 'prompt:target',
        label: 'GAME_TARGET (required)',
        description: 'Target bar with a valid candidate from the opponent.',
        prompt: targetPrompt(game, gameId, true),
      },
      {
        id: 'prompt:target-optional',
        label: 'GAME_TARGET (optional)',
        description: '"Up to N": a Finish button appears next to Cancel.',
        prompt: targetPrompt(game, gameId, false),
      },
      {
        id: 'prompt:mana',
        label: 'GAME_PLAY_MANA',
        description: 'Mana payment with highlighted sources and a special button.',
        prompt: {
          method: 'GAME_PLAY_MANA',
          gameId,
          title: 'Pay {1}{U}',
          message: 'Pay {1}{U}',
          mode: 'mana',
          options: [],
          min: 0,
          max: 0,
          playerId: me?.playerId,
        },
        playableIds: myLands,
      },
      {
        id: 'prompt:combat-attack',
        label: 'Combat (declare attackers)',
        description: 'Combat bar with "attack with everything" (special).',
        prompt: {
          method: 'GAME_SELECT',
          gameId,
          title: 'Declare attackers',
          message: 'Declare attackers',
          mode: 'combat',
          options: [],
          min: 0,
          max: 0,
          special: true,
        },
        playableIds: myPermanents,
      },
      {
        id: 'prompt:combat-block',
        label: 'Combat (declare blockers)',
        description: 'Combat bar without the attack-all button.',
        prompt: {
          method: 'GAME_SELECT',
          gameId,
          title: 'Declare blockers',
          message: 'Declare blockers',
          mode: 'combat',
          options: [],
          min: 0,
          max: 0,
        },
      },
      {
        id: 'prompt:ask',
        label: 'GAME_ASK (Yes/No)',
        description: 'Generic engine question with boolean options.',
        prompt: {
          method: 'GAME_ASK',
          gameId,
          title: 'Solemn Simulacrum',
          message: 'Search your library for a basic land?',
          mode: 'boolean',
          options: [
            { id: 'yes', label: 'Yes', value: 'true' },
            { id: 'no', label: 'No', value: 'false' },
          ],
          min: 0,
          max: 0,
          sourceName: 'Solemn Simulacrum',
        },
      },
      {
        id: 'prompt:jace-top',
        label: 'GAME_ASK (Jace, the Mind Sculptor +2)',
        description: 'Top card in the "Looked at" viewer + "Put that card on the bottom of its owner\'s library?" (Yes = to the bottom, No = leave it on top).',
        prompt: {
          method: 'GAME_ASK',
          gameId,
          title: 'Jace, the Mind Sculptor',
          message: "Put that card on the bottom of its owner's library?",
          mode: 'boolean',
          options: [
            { id: 'yes', label: 'Yes', value: 'true' },
            { id: 'no', label: 'No', value: 'false' },
          ],
          min: 0,
          max: 0,
          sourceName: 'Jace, the Mind Sculptor',
        },
        game: jaceTopGame,
      },
      {
        id: 'prompt:mulligan',
        label: 'London Mulligan',
        description: 'Keep/mulligan dialog with a counter.',
        prompt: {
          method: 'GAME_ASK',
          gameId,
          title: 'Mulligan',
          message: 'Mulligan down to 6 cards?',
          mode: 'boolean',
          options: [
            { id: 'keep', label: 'Keep (7)', value: 'false' },
            { id: 'mull', label: 'Mulligan', value: 'true' },
          ],
          min: 0,
          max: 0,
          isMulligan: true,
        },
      },
      {
        id: 'prompt:london-bottom',
        label: 'London Mulligan (to the bottom)',
        description: 'One card per click; shows how many are still to go to the bottom.',
        prompt: {
          method: 'GAME_TARGET',
          gameId,
          title: 'Choose target',
          message: 'Select a card (2 more) to put on the bottom of your library',
          mode: 'uuid',
          options: Object.keys(game.myHand ?? {}).map((id) => ({ id, label: game.myHand[id]?.name ?? id, value: id })),
          min: 0,
          max: 0,
          required: true,
          isMulliganLondon: true,
          progress: { selected: 0, remaining: 2 },
        },
      },
      {
        id: 'prompt:target-zone-graveyard',
        label: 'Target zone (graveyard)',
        description: 'GAME_TARGET with targetZone GRAVEYARD: the graveyard pile is highlighted and auto-opens with the target card inside.',
        prompt: {
          method: 'GAME_TARGET',
          gameId,
          title: 'Choose target',
          message: 'Select target creature card in a graveyard',
          mode: 'uuid',
          options: [{ id: 'zone-grave-1', label: 'Grizzly Bears', value: 'zone-grave-1' }],
          min: 1,
          max: 1,
          required: true,
          targetZone: 'GRAVEYARD',
          sourceName: 'Reanimate',
        },
        game: graveyardGame,
      },
      {
        id: 'prompt:graveyard-grid',
        label: 'Multi-select (graveyard)',
        description: 'GAME_TARGET with cards: the server owns the selection and the counter is shown.',
        prompt: {
          method: 'GAME_TARGET',
          gameId,
          title: 'Choose target',
          message: 'Select cards from your graveyard (selected 1 of 3, min 1)',
          mode: 'uuid',
          options: LIBRARY_CARDS.map((c) => ({ id: c.id, label: c.name, value: c.id })),
          min: 0,
          max: 0,
          required: false,
          chosenTargets: ['g5'],
          progress: { selected: 1, max: 3, min: 1 },
          cards: LIBRARY_CARDS,
          sourceName: 'Raise the Past',
        },
      },
      {
        id: 'prompt:discard-hand',
        label: 'Discard from hand (bar)',
        description: 'GAME_TARGET with your hand cards: resolved by clicking the hand, no modal grid, with the board visible.',
        prompt: {
          method: 'GAME_TARGET',
          gameId,
          title: 'Choose a card to discard',
          message: 'Select a card to discard',
          mode: 'uuid',
          options: myHandCards.map((c) => ({ id: c.id, label: c.name, value: c.id })),
          min: 1,
          max: 1,
          required: true,
          cards: myHandCards,
          targetZone: 'HAND',
          sourceName: 'Mind Rot',
        },
      },
      {
        id: 'prompt:card-grid',
        label: 'Library search (grid)',
        description: 'HD card grid with a search box for tutors.',
        prompt: {
          method: 'GAME_CHOOSE_CARDS',
          gameId,
          title: 'Search your library',
          message: 'Search your library for a card',
          mode: 'uuid',
          options: [],
          min: 0,
          max: 1,
          cards: LIBRARY_CARDS,
          sourceName: 'Demonic Tutor',
        },
      },
      {
        id: 'prompt:card-grid-filtered',
        label: 'Filtered search (only valid)',
        description: 'Filtered search: the grid pre-filters to the cards the target accepts (options.possibleTargets) and a toggle reveals the remaining candidates.',
        prompt: {
          method: 'GAME_TARGET',
          gameId,
          title: 'Search your library',
          message: 'Search your library for a creature card',
          mode: 'uuid',
          options: LIBRARY_CARDS.filter((c) => (c.cardTypes ?? []).includes('Creature')).map((c) => ({ id: c.id, label: c.name, value: c.id })),
          min: 0,
          max: 1,
          required: true,
          cards: LIBRARY_CARDS,
          sourceName: 'Chord of Calling',
        },
      },
      {
        id: 'prompt:trigger-order',
        label: 'Trigger order',
        description: 'Two simultaneous triggers with no fixed order.',
        prompt: {
          method: 'GAME_TARGET',
          gameId,
          title: 'Order triggered abilities',
          message: 'Choose the order of triggered abilities',
          mode: 'uuid',
          options: triggers.map((c) => ({ id: c.id, label: c.name, value: c.id })),
          min: 1,
          max: 1,
          cards: triggers,
          isTriggerOrder: true,
        },
      },
      {
        id: 'prompt:voting',
        label: 'Voting (Council)',
        description: 'Two-option vote with the source visible.',
        prompt: {
          method: 'GAME_CHOOSE_CHOICE',
          gameId,
          title: "Council's Judgment",
          message: 'Vote for a permanent — Step 1 of 2',
          mode: 'string',
          options: [
            { id: 'v1', label: 'Elvish Mystic', value: 'Elvish Mystic' },
            { id: 'v2', label: 'Forest', value: 'Forest' },
          ],
          min: 0,
          max: 0,
          isVoting: true,
        },
      },
    ]

    for (const p of prompts) {
      entries.push({
        id: p.id,
        group: 'Prompts',
        label: p.label,
        description: p.description,
        phase: 'game',
        game: p.game ?? game,
        gameId,
        feedback: p.prompt,
        playableIds: p.playableIds,
      })
    }
  }

  const slicerFrame = recordedFrames.find((frame) => frame.file === 'slicer.json')
  const slicerAsk = slicerFrame
    ? parseFeedback('GAME_ASK', slicerFrame.gameId, {
        message: SLICER_ASK_RULE,
        options: { secondMessage: 'Slicer, Hired Muscle' },
      })
    : null
  if (slicerFrame && slicerAsk) {
    entries.push({
      id: 'prompt:ask-slicer',
      group: 'Prompts',
      label: 'GAME_ASK (Slicer, Hired Muscle)',
      description: 'Real engine question with {this}: the sanitizer resolves it with sourceName.',
      phase: 'game',
      game: slicerFrame.gameView,
      gameId: slicerFrame.gameId,
      feedback: slicerAsk,
    })
  }

  entries.push({
    id: 'screen:rendered-cards',
    group: 'Screens',
    label: 'Rendered cards',
    description: 'Every distinct card layout in the recorded frames, drawn from data.',
    screen: 'cards',
    phase: 'game',
  })

  entries.push({
    id: 'screen:login',
    group: 'Screens',
    label: 'Login',
    description: 'Connection screen with no form submitted.',
    phase: 'idle',
  })

  entries.push({
    id: 'screen:lobby-empty',
    group: 'Screens',
    label: 'Lobby (empty)',
    description: 'No tables and no connected players.',
    screen: 'lobby',
    lobby: LOBBY_EMPTY,
    conn: GALLERY_CONN,
  })
  entries.push({
    id: 'screen:lobby-overflow',
    group: 'Screens',
    label: 'Lobby (overflowing)',
    description: '48 tables and 55 connected players.',
    screen: 'lobby',
    lobby: LOBBY_OVERFLOW,
    conn: GALLERY_CONN,
  })
  entries.push({
    id: 'screen:decks',
    group: 'Screens',
    label: 'Deck editor',
    description:
      'Uses the real browser storage (IndexedDB): no sample decks are forced here so your saved decks are not polluted with fake data.',
    screen: 'decks',
  })
  entries.push({
    id: 'screen:draft',
    group: 'Screens',
    label: 'Draft (pick in progress)',
    description: '14-card booster, pick 3 of round 1, with 2 already picked.',
    screen: 'draft',
    draft: DRAFT_INPROGRESS,
  })
  entries.push({
    id: 'screen:draft-waiting',
    group: 'Screens',
    label: 'Draft (waiting for booster)',
    description: 'Empty booster after the pick ends (picking:false) with long player names.',
    screen: 'draft',
    draft: DRAFT_WAITING,
  })
  entries.push({
    id: 'screen:construct',
    group: 'Screens',
    label: 'Construct (sealed pool)',
    description: '45 cards from a typical sealed booster.',
    screen: 'construct',
    construct: CONSTRUCT_STATE_NORMAL,
  })
  entries.push({
    id: 'screen:construct-overflow',
    group: 'Screens',
    label: 'Construct (big pool)',
    description: '90 cards: big cube/sealed pool, overflowing.',
    screen: 'construct',
    construct: CONSTRUCT_STATE_BIG,
  })
  entries.push({
    id: 'screen:tournament-inprogress',
    group: 'Screens',
    label: 'Tournament (bracket in progress)',
    description: '3-round Swiss, round 2 in progress.',
    screen: 'tournament',
    tournamentModal: { table: TOURNAMENT_TABLE, view: TOURNAMENT_INPROGRESS },
  })
  entries.push({
    id: 'screen:tournament-finished',
    group: 'Screens',
    label: 'Tournament (bracket finished)',
    description: 'Finished tournament with final standings.',
    screen: 'tournament',
    tournamentModal: { table: TOURNAMENT_TABLE, view: TOURNAMENT_FINISHED },
  })
  entries.push({
    id: 'screen:tournament-loading',
    group: 'Screens',
    label: 'Tournament (loading)',
    description: 'Bracket without data while TOURNAMENT_INIT arrives (loading).',
    screen: 'tournament',
    tournamentModal: { table: TOURNAMENT_TABLE, view: null, loading: true },
  })
  entries.push({
    id: 'screen:tournament-error',
    group: 'Screens',
    label: 'Tournament (error)',
    description: 'Failed to request the bracket (modal error prop).',
    screen: 'tournament',
    tournamentModal: { table: TOURNAMENT_TABLE, view: null, error: 'Could not load the tournament bracket' },
  })
  entries.push({
    id: 'screen:tournament-empty',
    group: 'Screens',
    label: 'Tournament (no data)',
    description: 'Load finished with no view yet: the modal empty state.',
    screen: 'tournament',
    tournamentModal: { table: TOURNAMENT_TABLE, view: null },
  })
  entries.push({
    id: 'screen:tournament-waiting',
    group: 'Screens',
    label: 'Tournament (constructing)',
    description: 'Constructing with 6 players and 0 rounds: waiting before the first pairing.',
    screen: 'tournament',
    tournamentModal: { table: TOURNAMENT_TABLE, view: TOURNAMENT_WAITING },
  })
  entries.push({
    id: 'screen:draft-stalled',
    group: 'Screens',
    label: 'Draft (stalled)',
    description: 'Watchdog with no events for >150 s: warning + Retry button.',
    screen: 'draft',
    draft: DRAFT_INPROGRESS,
    lastDraftEventAt: 0,
  })
  entries.push({
    id: 'screen:setup',
    group: 'Screens',
    label: 'Setup wizard',
    description: 'First run: proxy and server configuration.',
    phase: 'idle',
    screen: 'setup',
  })
  entries.push({
    id: 'screen:login-connecting',
    group: 'Screens',
    label: 'Login (connecting)',
    description: 'Form submitted: Connecting… button with a spinner and submit blocked.',
    phase: 'connecting',
    conn: GALLERY_CONN,
  })
  entries.push({
    id: 'screen:login-error',
    group: 'Screens',
    label: 'Login (connection error)',
    description: 'Session-slice error rendered in the login box.',
    phase: 'idle',
    error: 'Could not connect to the proxy',
  })
  entries.push({
    id: 'screen:lobby-error',
    group: 'Screens',
    label: 'Lobby (error)',
    description: 'Lobby ErrorBanner with the lobby loaded behind.',
    screen: 'lobby',
    lobby: LOBBY_OVERFLOW,
    conn: GALLERY_CONN,
    error: 'Could not connect to the proxy',
  })
  entries.push({
    id: 'screen:wizard',
    group: 'Screens',
    label: 'Create table (wizard)',
    description:
      'Persisted form «Draft MH3 (8P)»: limited-tournament branch with a summary and 8 seats. (The invalid combination is not representable: the setters auto-correct it.)',
    phase: 'game',
    screen: 'wizard',
    storageSeed: { [CREATE_TABLE_STORAGE_KEY]: WIZARD_DRAFT_FORM },
  })
  entries.push({
    id: 'screen:staging-player',
    group: 'Screens',
    label: 'Staging room (player)',
    description: '2/2 table with roster, ready/not-ready and deck switch.',
    phase: 'game',
    screen: 'staging',
    conn: GALLERY_CONN,
    lobby: LOBBY_OVERFLOW,
    stagingTable: STAGING_TABLE,
    chatMessages: STAGING_CHAT,
    myDeck: STAGING_DECK,
  })
  entries.push({
    id: 'screen:staging-pod',
    group: 'Screens',
    label: 'Staging room (Commander pod)',
    description: '3/4 multiplayer table with a bot and a free seat around the table.',
    phase: 'game',
    screen: 'staging',
    conn: GALLERY_CONN,
    lobby: LOBBY_OVERFLOW,
    stagingTable: STAGING_POD_TABLE,
    chatMessages: STAGING_CHAT,
    myDeck: STAGING_DECK,
  })
  entries.push({
    id: 'screen:staging-spectator',
    group: 'Screens',
    label: 'Staging room (spectator)',
    description: 'Spectating a 1/2 table waiting for an opponent.',
    phase: 'game',
    screen: 'staging',
    stagingMode: 'spectator',
    conn: GALLERY_CONN,
    lobby: LOBBY_OVERFLOW,
    stagingTable: STAGING_OPEN_TABLE,
    chatMessages: [],
  })
  entries.push({
    id: 'screen:tournament-panel',
    group: 'Screens',
    label: 'Tournament (in-game panel)',
    description: 'TournamentPanel during a tournament game (bracket + chat).',
    phase: 'game',
    game: GANG_BLOCK_FRAME?.gameView ?? null,
    gameId: GANG_BLOCK_FRAME?.gameId ?? null,
    tournament: { tournamentId: 'gallery-tournament-1', view: TOURNAMENT_INPROGRESS },
  })
  entries.push({
    id: 'screen:gameend-game',
    group: 'Screens',
    label: 'Game over (match continues)',
    description: 'Loss in game 1 of a Bo3 with a score and "the match continues".',
    screen: 'gameend',
    game: GANG_BLOCK_FRAME?.gameView ?? null,
    gameId: GANG_BLOCK_FRAME?.gameId ?? null,
    gameEnd: GAME_END_GAME,
  })
  entries.push({
    id: 'screen:gameend-match',
    group: 'Screens',
    label: 'Match over (victory)',
    description: 'Bo3 match won 2-1: winner, score and return to the lobby.',
    screen: 'gameend',
    game: GANG_BLOCK_FRAME?.gameView ?? null,
    gameId: GANG_BLOCK_FRAME?.gameId ?? null,
    gameEnd: GAME_END_MATCH,
  })
  entries.push({
    id: 'screen:settings',
    group: 'Screens',
    label: 'Settings',
    description: 'SettingsModal (language, interface, board, sound, game).',
    phase: 'game',
    screen: 'settings',
  })
  entries.push({
    id: 'screen:appearance',
    group: 'Screens',
    label: 'Appearance',
    description: 'Zoom, board layout and card sleeves.',
    phase: 'game',
    screen: 'appearance',
  })
  entries.push({
    id: 'screen:about',
    group: 'Screens',
    label: 'About',
    description: 'Version, credits and links (no news tab: it uses the network).',
    phase: 'idle',
    screen: 'about',
  })
  entries.push({
    id: 'screen:help',
    group: 'Screens',
    label: 'Help / wiki',
    description: 'Glossary of keywords, phases and shortcuts.',
    phase: 'game',
    screen: 'help',
  })

  // Board variants: the real settings.boardLayout decides the effective layout
  // (`effectiveBoardLayout`: pod/arena only with opponents; >4 players ⇒ standard).
  entries.push({
    id: 'board:pod-4',
    group: 'Board',
    label: 'Pod 2×2 (4 players)',
    description: '4-player FFA with pod layout: 2×2 grid and turn ring.',
    phase: 'game',
    game: FOUR_PLAYER_GAME,
    gameId: GANG_BLOCK_FRAME?.gameId ?? null,
    boardLayout: 'pod',
  })
  if (FOUR_PLAYER_GAME) {
    const fourGameId = GANG_BLOCK_FRAME?.gameId ?? 'gallery-4p'
    const names = (FOUR_PLAYER_GAME.players ?? []).map((p) => ({ name: p.name, me: !!p.controlled }))
    const requester = names.find((n) => !n.me)?.name ?? 'Opponent'
    const turn = FOUR_PLAYER_GAME.turn ?? 3
    const baseVote = (over: Partial<RollbackVote>, statuses: RollbackVote['voters'][number]['status'][]): RollbackVote => ({
      gameId: fourGameId,
      requester,
      requesterUserId: 'gallery-requester',
      requestedByMe: false,
      turns: 0,
      requestedAtTurn: turn,
      voters: [
        { name: requester, status: 'requested', me: false },
        ...names.filter((n) => n.name !== requester).map((n, i) => ({ name: n.name, me: n.me, status: statuses[i] ?? 'pending' })),
      ],
      myVote: 'pending',
      outcome: 'voting',
      hidden: false,
      startedAt: Date.now(),
      ...over,
    })
    const meIdx = names.filter((n) => n.name !== requester).findIndex((n) => n.me)
    const withMe = (mine: RollbackVote['voters'][number]['status'], others: RollbackVote['voters'][number]['status'][]) => {
      const list = [...others]
      list.splice(meIdx < 0 ? 0 : meIdx, 0, mine)
      return list
    }
    const rollbackEntries: { id: string; label: string; description: string; vote: RollbackVote; game?: GameView }[] = [
      {
        id: 'dialog:rollback-vote',
        label: 'Rollback vote (my vote pending)',
        description: 'Blocking vote with every player and their status; Accept/Deny.',
        vote: baseVote({}, withMe('pending', ['accepted', 'pending'])),
      },
      {
        id: 'dialog:rollback-vote-waiting',
        label: 'Rollback vote (waiting, game moved on)',
        description: 'I accepted; one player still pending and the game advanced a turn (server counts from the last vote).',
        vote: baseVote({ myVote: 'accepted', requestedAtTurn: Math.max(1, turn - 1) }, withMe('accepted', ['accepted', 'pending'])),
      },
      {
        id: 'dialog:rollback-vote-denied',
        label: 'Rollback vote (denied)',
        description: 'Resolution: one player denied; Close dismisses.',
        vote: baseVote({ myVote: 'accepted', outcome: 'denied', deniedBy: names.filter((n) => n.name !== requester && !n.me)[1]?.name ?? '?' }, withMe('accepted', ['accepted', 'denied'])),
      },
      {
        id: 'dialog:rollback-vote-applied',
        label: 'Rollback vote (applied)',
        description: 'Resolution: all accepted and the server restored the turn.',
        vote: baseVote({ myVote: 'accepted', outcome: 'applied', appliedTurn: turn }, withMe('accepted', ['accepted', 'accepted'])),
      },
    ]
    for (const e of rollbackEntries) {
      entries.push({
        id: e.id,
        group: 'Dialogs',
        label: e.label,
        description: e.description,
        phase: 'game',
        game: FOUR_PLAYER_GAME,
        gameId: fourGameId,
        boardLayout: 'pod',
        rollbackVote: e.vote,
      })
    }
  }
  entries.push({
    id: 'board:arena-4',
    group: 'Board',
    label: 'Arena (4 players)',
    description: 'Same 4-player FFA with arena layout: opponents in compact columns.',
    phase: 'game',
    game: FOUR_PLAYER_GAME,
    gameId: GANG_BLOCK_FRAME?.gameId ?? null,
    boardLayout: 'arena',
  })
  entries.push({
    id: 'board:pod-4-crowded',
    group: 'Board',
    label: 'Pod 2×2 with a full battlefield',
    description: '4 players with 16 creatures and 14 lands each: the bands shrink the cards (and wrap them into lines) instead of scrolling.',
    phase: 'game',
    game: CROWDED_POD_GAME,
    gameId: GANG_BLOCK_FRAME?.gameId ?? null,
    boardLayout: 'pod',
  })
  entries.push({
    id: 'board:arena-4-crowded',
    group: 'Board',
    label: 'Arena with a full battlefield',
    description: 'Same full battlefield with arena layout (opponents in compact columns).',
    phase: 'game',
    game: CROWDED_POD_GAME,
    gameId: GANG_BLOCK_FRAME?.gameId ?? null,
    boardLayout: 'arena',
  })
  entries.push({
    id: 'board:pod-commander',
    group: 'Board',
    label: 'Commander pod (3 players)',
    description: '3-player Commander Free For All: command zone per opponent and ring.',
    phase: 'game',
    game: THREE_PLAYER_COMMANDER,
    gameId: COMMANDER_FRAME?.gameId ?? null,
    boardLayout: 'pod',
  })
  entries.push({
    id: 'game:hand-15',
    group: 'Board',
    label: '15-card hand',
    description: 'Overflowing hand (15 cards) over the gang-block frame.',
    phase: 'game',
    game: HAND_15_GAME,
    gameId: GANG_BLOCK_FRAME?.gameId ?? null,
  })
  entries.push({
    id: 'game:top-card-peek',
    group: 'Board',
    label: 'Top card peek',
    description: '"Look at the top card of your library any time" (Future Sight…): the card sits small left of the library, no blocking viewer.',
    phase: 'game',
    game: TOP_CARD_PEEK_GAME,
    gameId: GANG_BLOCK_FRAME?.gameId ?? null,
  })
  entries.push({
    id: 'game:long-names',
    group: 'Board',
    label: 'Long names',
    description: 'Players and cards with very long names (label overflow).',
    phase: 'game',
    game: LONG_NAMES_GAME,
    gameId: GANG_BLOCK_FRAME?.gameId ?? null,
  })

  // Global states: language, zoom and connection (real app slices).
  entries.push({
    id: 'global:lang-lobby-ru',
    group: 'Global',
    label: 'Lobby in Russian (long language)',
    description: 'ru translation over the overflowing lobby: longer labels.',
    screen: 'lobby',
    lobby: LOBBY_OVERFLOW,
    conn: GALLERY_CONN,
    lang: 'ru',
  })
  entries.push({
    id: 'global:lang-game-ja',
    group: 'Global',
    label: 'Game in Japanese (CJK)',
    description: 'ja translation + cjkBoost over a real frame.',
    phase: 'game',
    game: GANG_BLOCK_FRAME?.gameView ?? null,
    gameId: GANG_BLOCK_FRAME?.gameId ?? null,
    lang: 'ja',
    cjkBoost: true,
  })
  entries.push({
    id: 'global:zoom-lobby-125',
    group: 'Global',
    label: 'Lobby at 125% zoom',
    description: 'settings.uiScale = 1.25 (the board compensates with inverseZoom).',
    screen: 'lobby',
    lobby: LOBBY_OVERFLOW,
    conn: GALLERY_CONN,
    uiScale: 1.25,
  })
  entries.push({
    id: 'global:reconnecting',
    group: 'Global',
    label: 'Disconnected (reconnecting)',
    description: 'connecting + wsAlive:false: the app reconnect banner.',
    screen: 'lobby',
    lobby: LOBBY_OVERFLOW,
    conn: GALLERY_CONN,
    connecting: true,
  })

  return entries
}
