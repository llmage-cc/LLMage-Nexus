import { Gateway } from './Gateway'
import { getBrowserId } from './browserId'
import type { DeckJson, ResultEnvelope } from './types'
import type { DraftReport } from '../system/report'

/** Tipo de juego y tipo de jugador reales del servidor (getGameTypes/getPlayerTypes). */
export interface GameTypeInfo {
  name: string
  minPlayers: number
  maxPlayers: number
  isMiniGame?: boolean
  [k: string]: unknown
}

let gateway: Gateway | null = null

export function setGateway(g: Gateway | null) {
  gateway = g
}

export function getGateway(): Gateway {
  if (!gateway) throw new Error('gateway no inicializado')
  return gateway
}

export async function connect(
  host: string,
  port: number,
  username: string,
  password: string,
  flagName?: string,
  avatarId?: number,
  resume?: { streamId: string; seq: number } | null,
  authToken?: string,
) {
  // Every connect carries the per-browser id and — only when the
  // deployment requires it — the auth token (session memory only).
  return getGateway().send('connect', {
    host, port, username, password, flagName, avatarId,
    ...(resume ? { resume } : null),
    browserId: getBrowserId(username),
    ...(authToken ? { authToken } : null),
  })
}

export async function getGameTypes(): Promise<GameTypeInfo[]> {
  const res = await getGateway().send<GameTypeInfo[]>('getGameTypes')
  return res.ok ? (res.data ?? []) : []
}

export async function getPlayerTypes(): Promise<string[]> {
  const res = await getGateway().send<string[]>('getPlayerTypes')
  return res.ok ? (res.data ?? []) : []
}

export async function getDeckTypes(): Promise<string[]> {
  const res = await getGateway().send<string[]>('getDeckTypes')
  return res.ok ? (res.data ?? []) : []
}

export async function getTournamentTypes(): Promise<string[]> {
  const res = await getGateway().send<unknown[]>('getTournamentTypes')
  if (!res.ok || !Array.isArray(res.data)) return []
  return res.data
    .map((item) => (typeof item === 'string' ? item : (item as { name?: string })?.name ?? ''))
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
}

export async function getDraftCubes(): Promise<string[]> {
  const res = await getGateway().send<string[]>('getDraftCubes')
  return res.ok ? (res.data ?? []) : []
}

export interface BoosterSetInfo {
  code: string
  name: string
  releaseDate: number
}

export async function getExpansionsWithBoosters(): Promise<BoosterSetInfo[]> {
  const res = await getGateway().send<BoosterSetInfo[]>('getExpansionsWithBoosters')
  return res.ok ? (res.data ?? []) : []
}

export async function getRoomChatId(): Promise<string | undefined> {
  const res = await getGateway().send<string>('getRoomChatId')
  return res.ok ? res.data : undefined
}

export async function getGameChatId(gameId: string): Promise<string | undefined> {
  const res = await getGateway().send<string>('getGameChatId', { gameId })
  return res.ok ? res.data : undefined
}

export async function getTableChatId(tableId: string): Promise<string | undefined> {
  const res = await getGateway().send<string>('getTableChatId', { tableId })
  return res.ok ? res.data : undefined
}

export async function getTournamentChatId(tournamentId: string): Promise<string | undefined> {
  const res = await getGateway().send<string>('getTournamentChatId', { tournamentId })
  return res.ok ? res.data : undefined
}

export async function joinChat(chatId: string) {
  return getGateway().send('joinChat', { chatId })
}

export async function leaveChat(chatId: string) {
  return getGateway().send('leaveChat', { chatId })
}

export async function sendChatMessage(chatId: string, text: string) {
  return getGateway().send('sendChatMessage', { chatId, text })
}

export interface CreateTableArgs {
  name: string
  gameType: string
  deckType: string
  winsNeeded: number
  playerTypes: string[]
  password?: string
  skillLevel?: 'BEGINNER' | 'CASUAL' | 'SERIOUS' | string
  rated?: boolean
  spectatorsAllowed?: boolean
  rollbackTurnsAllowed?: boolean
  timeLimit?: string
  bufferTime?: string
  freeMulligans?: number
  attackOption?: string
  range?: string
  minimumRating?: number
  quitRatio?: number
  edhPowerLevel?: number
  skipInitShuffling?: boolean
  skipStartingPlayerChoice?: boolean
  limited?: boolean
  mulliganType?: string
  customStartLifeEnabled?: boolean
  customStartLife?: number
  customStartHandSizeEnabled?: boolean
  customStartHandSize?: number
  planeChase?: boolean
  bannedUsers?: string[]
  /** skill 1-10 por plaza (desktop NewPlayerPanel.spnLevel, default 2) */
  seatSkills?: number[]
  /** mazos de los asientos "SIM" (oponentes simulados que une el proxy) */
  simDecks?: DeckJson[]
  /**
   * Per-seat LLM config, one entry per COMPUTER_LLM seat in playerTypes order
   * (k-th LLM seat consumes k-th entry; null = server defaults). Omitted when
   * there is no LLM seat. Only sent to servers that reported capabilities.llm.
   */
  llmConfigs?: (Record<string, unknown> | null)[]
}

export async function createTable(args: CreateTableArgs) {
  return getGateway().send('createTable', { ...args })
}

export interface JoinTableArgs {
  roomId?: string
  tableId: string
  playerName: string
  playerType: string
  skill?: number
  deck?: DeckJson
  password?: string
  deckType?: string
  gameType?: string
}

export async function joinTable(args: JoinTableArgs) {
  return getGateway().send('joinTable', { ...args })
}

export async function startMatch(tableId: string) {
  return getGateway().send('startMatch', { tableId })
}

export async function startTournament(tableId: string) {
  return getGateway().send('startTournament', { tableId })
}

export async function joinTournament(tournamentId: string) {
  return getGateway().send('joinTournament', { tournamentId })
}

export async function joinDraft(draftId: string) {
  return getGateway().send('joinDraft', { draftId })
}

/** Reordena dos asientos (solo dueño, mesa READY_TO_START) — paridad con Move Up/Down del desktop. */
export async function swapSeats(tableId: string, seatNum1: number, seatNum2: number) {
  return getGateway().send('swapSeats', { tableId, seatNum1, seatNum2 })
}

export async function watchTable(tableId: string) {
  return getGateway().send('watchTable', { tableId })
}

export async function watchGame(gameId: string) {
  return getGateway().send('watchGame', { gameId })
}

export async function joinGame(gameId: string) {
  return getGateway().send('joinGame', { gameId })
}

export async function stopWatching(gameId: string) {
  return getGateway().send('stopWatching', { gameId })
}

export async function leaveTable(tableId: string) {
  return getGateway().send('leaveTable', { tableId })
}

export async function removeTable(tableId: string) {
  return getGateway().send('removeTable', { tableId })
}

export async function submitDeck(tableId: string, deck: DeckJson) {
  return getGateway().send('submitDeck', { tableId, deck })
}

export async function updateDeck(tableId: string, deck: DeckJson) {
  return getGateway().send('updateDeck', { tableId, deck })
}

/**
 * Pre-validación de un mazo contra la BD de cartas del proxy (misma release que
 * el servidor objetivo, semántica idéntica al servidor oficial: findCard estricto
 * por set+número). Advisory: si ready=false no bloquea el flujo.
 */
export async function validateDeck(deck: DeckJson): Promise<import('./types').DeckValidationResult | null> {
  const res = await getGateway().send<import('./types').DeckValidationResult>('validateDeck', { deck })
  return res.ok ? (res.data ?? null) : null
}

/**
 * Elegibilidad de comandante según las clases reales de XMage del proxy (misma
 * release que el servidor objetivo; resuelve casos como Grist, que xmage marca
 * elegible aunque su línea de tipo sea Planeswalker). Advisory: null si no hay
 * conexión o la BD de cartas del proxy no está disponible.
 */
export async function commanderEligibility(names: string[]): Promise<import('./types').CommanderEligibilityResult | null> {
  const res = await getGateway().send<import('./types').CommanderEligibilityResult>('commanderEligibility', { names })
  return res.ok ? (res.data ?? null) : null
}

/**
 * Validación COMPLETA del mazo con el DeckValidator oficial de XMage (misma
 * release que el servidor objetivo): tamaños, bans, comandante/partner,
 * identidad de color. deckType es el nombre de tipo de mesa de config.xml
 * (p.ej. "Variant Magic - Commander"). Advisory: null si no hay conexión o el
 * formato no tiene validador.
 */
export async function validateDeckFormat(deck: DeckJson, deckType?: string | null, gameType?: string | null): Promise<import('./types').DeckFormatValidationResult | null> {
  const res = await getGateway().send<import('./types').DeckFormatValidationResult>('validateDeckFormat', { deck, deckType, gameType })
  return res.ok ? (res.data ?? null) : null
}

/**
 * Impresión que elegirían los importadores de XMage para cada nombre
 * (`default`: findPreferredCoreExpansionCard; `oldest`: la más antigua no promo;
 * `set`: la de ese set si existe). Advisory: null sin conexión.
 */
export async function resolvePrintings(
  names: string[],
  strategy: 'default' | 'oldest' | 'set' = 'default',
  setCode?: string,
): Promise<import('./types').ResolvePrintingsResult | null> {
  const res = await getGateway().send<import('./types').ResolvePrintingsResult>('resolvePrintings', { names, strategy, setCode })
  return res.ok ? (res.data ?? null) : null
}

/**
 * Impresiones implementadas en la release de XMage del proxy (lista vacía =
 * carta no implementada). `limit` 1 basta para saber si existe. Advisory.
 */
export async function cardPrintings(names: string[], limit = 0): Promise<import('./types').CardPrintingsResult | null> {
  const res = await getGateway().send<import('./types').CardPrintingsResult>('cardPrintings', { names, limit })
  return res.ok ? (res.data ?? null) : null
}

/**
 * Fetch de un mazo en Moxfield/Archidekt vía el proxy (Java, sin CORS) en vez
 * de `fetch()` en el navegador: esas APIs no envían cabeceras CORS que
 * permitan llamarlas desde el origen del cliente web, así que un fetch
 * directo siempre falla con "Failed to fetch". Devuelve el JSON crudo tal
 * cual lo sirve la API de origen (el parseo a DeckV2 sigue en el cliente).
 */
export async function fetchOnlineDeckJson(source: 'moxfield' | 'archidekt', urlOrId: string): Promise<unknown | null> {
  const res = await getGateway().send<unknown>('fetchOnlineDeck', { source, urlOrId })
  return res.ok ? (res.data ?? null) : null
}

export async function fetchEdhrecPageViaProxy(slug: string) {
  return getGateway().send<unknown>('fetchOnlineDeck', { source: 'edhrec', urlOrId: slug })
}

export interface PhaseStops {
  yourTurn: Record<string, boolean>
  opponentTurn: Record<string, boolean>
}

export async function updatePreferences(phases: PhaseStops) {
  return getGateway().send('updatePreferences', { phases })
}

export async function updateManaConfirmPreference(confirmEmptyManaPool: boolean) {
  return getGateway().send('updatePreferences', { confirmEmptyManaPool })
}

export async function quitMatch(gameId: string) {
  return getGateway().send('quitMatch', { gameId })
}

export async function sendPlayerAction(action: string, gameId: string, data?: unknown) {
  return getGateway().send('sendPlayerAction', { action, gameId, data })
}

export async function sendPlayerBoolean(value: boolean, gameId: string) {
  return getGateway().send('sendPlayerBoolean', { value, gameId })
}

export async function sendPlayerInteger(value: number, gameId: string) {
  return getGateway().send('sendPlayerInteger', { value, gameId })
}

export async function sendPlayerString(value: string, gameId: string) {
  return getGateway().send('sendPlayerString', { value, gameId })
}

export async function sendPlayerUUID(uuid: string | null, gameId: string) {
  return getGateway().send('sendPlayerUUID', { value: uuid, gameId })
}

export type TriggerAutoOrderKind =
  | 'TRIGGER_AUTO_ORDER_ABILITY_FIRST'
  | 'TRIGGER_AUTO_ORDER_ABILITY_LAST'
  | 'TRIGGER_AUTO_ORDER_NAME_FIRST'
  | 'TRIGGER_AUTO_ORDER_NAME_LAST'
  | 'TRIGGER_AUTO_ORDER_RESET_ALL'

export async function sendTriggerAutoOrder(kind: TriggerAutoOrderKind, gameId: string, data?: string | null) {
  return sendPlayerAction(kind, gameId, data ?? null)
}

export type HandPermissionAction =
  | 'REQUEST_PERMISSION_TO_SEE_HAND_CARDS'
  | 'PERMISSION_REQUESTS_ALLOWED_ON'
  | 'PERMISSION_REQUESTS_ALLOWED_OFF'
  | 'REVOKE_PERMISSIONS_TO_SEE_HAND_CARDS'
  | 'ADD_PERMISSION_TO_SEE_HAND_CARDS'

export async function requestHandPermission(gameId: string, playerId: string) {
  return sendPlayerAction('REQUEST_PERMISSION_TO_SEE_HAND_CARDS', gameId, playerId)
}

export async function setHandRequestsAllowed(gameId: string, allowed: boolean) {
  return sendPlayerAction(allowed ? 'PERMISSION_REQUESTS_ALLOWED_ON' : 'PERMISSION_REQUESTS_ALLOWED_OFF', gameId, null)
}

export async function revokeHandPermissions(gameId: string) {
  return sendPlayerAction('REVOKE_PERMISSIONS_TO_SEE_HAND_CARDS', gameId, null)
}

export async function viewSideboard(gameId: string, playerId: string) {
  return sendPlayerAction('VIEW_SIDEBOARD', gameId, playerId)
}

export async function viewLimitedDeck(gameId: string, playerId: string) {
  return sendPlayerAction('VIEW_LIMITED_DECK', gameId, playerId)
}

export type { ManaPaymentAction } from '../game/manaPayment'

export async function sendManaPaymentMode(kind: import('../game/manaPayment').ManaPaymentAction, gameId: string) {
  return sendPlayerAction(kind, gameId, null)
}

export async function sendPlayerManaType(gameId: string, playerId: string, manaType: string) {
  return getGateway().send('sendPlayerManaType', { gameId, playerId, manaType })
}

export async function disconnect() {
  return getGateway().send('disconnect')
}

export async function getFinishedMatches(roomId?: string): Promise<import('./types').MatchView[]> {
  const res = await getGateway().send<import('./types').MatchView[]>('getFinishedMatches', { roomId })
  return res.ok && Array.isArray(res.data) ? res.data : []
}

// ─── Argentum-P1 training deck pool (getP1Decks) ────────────────────────────

/** One deck in the Argentum-P1 training pool; `deck` is paste-ready decklist TEXT. */
export interface P1DeckEntry {
  name: string
  deck: string
}

/** Answer of the proxy's `getP1Decks` verb. */
export interface P1DecksResult {
  /** The 55 training decklists (name + deck TEXT). */
  decks: P1DeckEntry[]
  /** The deterministic default deck name (a P1 seat with no explicit choice gets it). */
  default: string
  /**
   * False when the proxy answered a NON-ok frame (typed CAPABILITY_UNAVAILABLE
   * when the running artifacts lack `P1DeckPool`, NOT_CONNECTED, …). The picker
   * uses it to tell a failed fetch apart from the short loading window, so an
   * error is SURFACED instead of masquerading as an eternal "loading…".
   */
  ok: boolean
  /** The proxy's typed errorCode on a non-ok answer (diagnostics only). */
  errorCode?: string
}

/**
 * Fetch the COMPUTER_P1 training deck pool (proxy verb `getP1Decks`). The
 * list is the ONLY set of decks a P1 seat may be given; the server stays
 * authoritative (a crafted client is rejected at join). Only ever called when
 * the connected server reported `capabilities.p1`; a failure degrades to an
 * empty pool flagged `ok:false` (so the picker surfaces the error and the seat
 * cannot be offered one of the 55) — never throws, mirroring
 * `getFinishedMatches`.
 */
export async function getP1Decks(): Promise<P1DecksResult> {
  const res = await getGateway().send<{ decks?: unknown; default?: unknown }>('getP1Decks', {})
  const data = res.ok ? res.data : undefined
  const decks = Array.isArray(data?.decks)
    ? (data!.decks as unknown[])
        .filter((d): d is { name: string; deck: string } =>
          typeof d === 'object' && d !== null
          && typeof (d as { name?: unknown }).name === 'string'
          && typeof (d as { deck?: unknown }).deck === 'string')
        .map((d) => ({ name: d.name, deck: d.deck }))
    : []
  return {
    decks,
    default: typeof data?.default === 'string' ? data.default : '',
    ok: res.ok === true,
    ...(res.ok ? {} : { errorCode: res.errorCode }),
  }
}

// ─── Replay files (getReplayFiles) ─────────────────────────────────────────

/** A seat recorded in a save's sidecar JSON. `wins` is null on backfilled sidecars. */
export interface ReplayFilePlayer {
  name: string
  wins?: number | null
  quit?: boolean
  deck?: string
}

/**
 * Parsed `<uuid>.json` sidecar, verbatim. Every field is optional
 * because a save may carry only some of them; `meta` itself is ABSENT for a
 * legacy save (predating the sidecar), which the browser marks as "legacy".
 */
export interface ReplayFileMeta {
  gameId?: string
  tableName?: string
  gameType?: string
  deckType?: string
  winner?: string
  turns?: number
  players?: ReplayFilePlayer[]
  startTime?: string
  endTime?: string
  savedAt?: string
}

/** One saved `<uuid>.game` file as the proxy lists it. */
export interface ReplayFileEntry {
  gameId: string
  /** File length in bytes. */
  bytes: number
  /** File last-modified, epoch ms. */
  savedAtMs: number
  /** Parsed sidecar, or undefined for a legacy save. */
  meta?: ReplayFileMeta
}

/**
 * Answer of `getReplayFiles`. `directory` is the ABSOLUTE path the proxy
 * actually read; `exists:false` means the directory is missing (still `ok:true`,
 * with an empty `files`), which the panel renders as a clear empty state.
 */
export interface ReplayFilesResult {
  directory: string
  exists: boolean
  files: ReplayFileEntry[]
}

/**
 * List the server's saved replay files (proxy `getReplayFiles`). Stock-server
 * compatible: it reads the proxy's replay directory, not the server. Missing or
 * malformed data degrades to an empty, non-existent listing rather than throwing.
 *
 * `files[]` is validated PER ENTRY (the `getP1Decks`
 * pattern), not cast wholesale — a malformed row (missing gameId, non-numeric
 * bytes/savedAtMs) must not flow into `buildReplayRows` and the panel. `meta`
 * keeps its unknown shape when present: it is displayed raw, and a legacy save
 * simply has no sidecar.
 */
export async function getReplayFiles(): Promise<ReplayFilesResult> {
  const res = await getGateway().send<{ directory?: unknown; exists?: unknown; files?: unknown }>('getReplayFiles', {})
  const data = res.ok ? res.data : undefined
  const files = Array.isArray(data?.files)
    ? (data!.files as unknown[])
        .filter((f): f is { gameId: string; bytes: number; savedAtMs: number; meta?: ReplayFileMeta } =>
          typeof f === 'object' && f !== null
          && typeof (f as { gameId?: unknown }).gameId === 'string'
          && (f as { gameId: string }).gameId !== ''
          && typeof (f as { bytes?: unknown }).bytes === 'number'
          && typeof (f as { savedAtMs?: unknown }).savedAtMs === 'number')
        .map((f) => ({
          gameId: f.gameId,
          bytes: f.bytes,
          savedAtMs: f.savedAtMs,
          ...('meta' in f ? { meta: f.meta } : null),
        }))
    : []
  return {
    directory: typeof data?.directory === 'string' ? data.directory : '',
    exists: data?.exists === true,
    files,
  }
}

export async function replayGame(gameId: string) {
  return getGateway().send('replayGame', { gameId })
}

export async function startReplay(gameId: string) {
  return getGateway().send('startReplay', { gameId })
}

export async function stopReplay(gameId: string) {
  return getGateway().send('stopReplay', { gameId })
}

export async function replayNext(gameId: string) {
  return getGateway().send('replayNext', { gameId })
}

export async function replayPrevious(gameId: string) {
  return getGateway().send('replayPrevious', { gameId })
}

export async function replaySkipForward(gameId: string, moves: number) {
  return getGateway().send('replaySkipForward', { gameId, moves })
}

export async function replaySeek(gameId: string, stateIndex: number) {
  return getGateway().send('replaySeek', { gameId, stateIndex })
}

export async function sendCardPick(draftId: string, cardId: string, hiddenCards?: string[]) {
  return getGateway().send('sendCardPick', { draftId, cardId, hiddenCards })
}

export async function sendCardMark(draftId: string, cardId: string) {
  return getGateway().send('sendCardMark', { draftId, cardId })
}

export async function setBoosterLoaded(draftId: string) {
  return getGateway().send('setBoosterLoaded', { draftId })
}

export async function quitDraft(draftId: string) {
  return getGateway().send('quitDraft', { draftId })
}

export async function quitTournament(tournamentId: string) {
  return getGateway().send('quitTournament', { tournamentId })
}

export async function createTournamentTable(args: Record<string, unknown>) {
  return getGateway().send('createTournamentTable', args)
}

export async function joinTournamentTable(args: { roomId?: string; tableId: string; playerName?: string; playerType?: string; skill?: number; deck?: DeckJson; password?: string; deckType?: string; gameType?: string }) {
  return getGateway().send('joinTournamentTable', { ...args })
}

export async function watchTournamentTable(tableId: string, roomId?: string) {
  return getGateway().send('watchTournamentTable', { tableId, roomId })
}

export async function getTournament(tournamentId: string) {
  const res = await getGateway().send('getTournament', { tournamentId })
  return res.ok ? res.data : null
}

/**
 * Answer of an LLM list verb: `items` are the fetched models (or personalities),
 * `error` is the proxy's player-facing message when the verb failed.
 */
export interface LlmListResult {
  ok: boolean
  items: string[]
  error: string
  errorCode?: string
}

function fromLlmListResult(res: ResultEnvelope & { data?: { models?: unknown; personalities?: unknown } }): LlmListResult {
  if (!res.ok) {
    return {
      ok: false,
      items: [],
      error: res.error ?? res.errorCode ?? 'request failed',
      ...(res.errorCode ? { errorCode: res.errorCode } : null),
    }
  }
  const raw = res.data?.models ?? res.data?.personalities
  const items = Array.isArray(raw) ? raw.filter((m): m is string => typeof m === 'string') : []
  return { ok: true, items, error: '' }
}

/**
 * List the models an OpenAI-compatible endpoint serves (proxy `fetchModels`).
 * The endpoint is the seat's apiEndpoint (a chat-completions URL). A failure is
 * answered typed by the proxy (models_error) and resolved here as `ok:false` with
 * the reason — the picker clears its loading flag on either outcome.
 */
export async function fetchLlmModels(apiEndpoint: string): Promise<LlmListResult> {
  const res = await getGateway().send<{ models?: unknown }>('fetchModels', { apiEndpoint })
  return fromLlmListResult(res)
}

/** List the engine's personalities (proxy `fetchPersonalities`). Same shape as fetchLlmModels. */
export async function fetchLlmPersonalities(): Promise<LlmListResult> {
  const res = await getGateway().send<{ personalities?: unknown }>('fetchPersonalities', {})
  return fromLlmListResult(res)
}

// ── Client-key LLM bridge transport ─────────────────────────────────────────

export interface LlmDecisionArgs {
  requestId: string
  rawResponse: string
  thinking?: string
  httpStatus?: number
}

export interface LlmErrorArgs {
  requestId: string
  message: string
  retryable: boolean
  httpStatus?: number
}

/**
 * Browser → proxy: the provider's response for a pending client-key exchange,
 * sent by the bridge after a 2xx provider call (`rawResponse` is the provider
 * body verbatim). Never carries the API key.
 */
export async function llmDecision(args: LlmDecisionArgs) {
  return getGateway().send('llm_decision', { ...args })
}

/**
 * Browser → proxy: the browser's provider call failed (missing key, non-2xx,
 * network/abort). `retryable` tells the server whether the exchange may be
 * retried; `httpStatus` is absent for transport failures. Never carries the key.
 */
export async function llmError(args: LlmErrorArgs) {
  return getGateway().send('llm_error', { ...args })
}

/** The proxy's answer to a report: whether it was stored, and the reference if it was. */
export interface ReportAck {
  stored?: boolean
  id?: string
  reason?: string
}

/**
 * A player-submitted report. It rides the same WebSocket as the game because that is the one
 * channel both front ends have (the desktop CSP allows ws:, not an extra https host), and the
 * payload is already shrunk to what the proxy accepts.
 */
export async function sendReport(draft: DraftReport): Promise<{ ok: boolean; ack: ReportAck; error?: string }> {
  const res = await getGateway().send<ReportAck>('report_issue', { ...draft.wire })
  return { ok: res.ok, ack: res.data ?? {}, error: res.error }
}
