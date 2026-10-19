import { getState, setState, addLog } from './state'
import * as cmds from '../net/commands'
import { cleanMageText } from '../game/gameEventParser'
import type { ChatMessageEvent, DeckJson, GameView } from '../net/types'
import { advanceProgress, dungeonProgressKey, findDungeonGraph, parseDungeonEntry } from '../game/dungeons'
import { parseRoomDoor, roomDoorKey, mergeRoomDoor } from '../game/rooms'
import { parseSpeedLevel, speedLevelKey } from '../game/speed'
import { serverPhaseStops } from '../game/phaseStops'
import { decideStop } from '../game/stopPolicy'
import { meaningfulPlayables } from '../game/smartStops'
import { manaPaymentActions } from '../game/manaPayment'
import { serverAutoAnswerActions } from '../game/autoAnswers'
import { gameplayPreset, PRESET_OWNED_KEYS, type GameplayPresetId } from '../settings/gameplayPresets'
import { clearActiveGame, saveSmartStops, saveActiveDeck, saveFxSettings, saveAudioSettings, saveMusicSettings, saveAppearanceSettings, saveAutoAnswers, saveChoiceMemory, saveManaPayment, savePhaseStops, saveGameplayPreset, applyAppearanceToDocument, rememberEquippedDeckId } from './persistence'
import { getLanguage } from '../i18n'
import { translateError } from '../i18n'
import { isControllingPriority } from './control'
import { soundManager } from '../audio/soundManager'
import { resetPromptSound } from '../audio/promptSound'
import type { AppState } from './state'
import {
  ROLLBACK_ACCEPT_ACTION, ROLLBACK_DENY_ACTION, ROLLBACK_PENDING_TTL_MS, rollbackAcceptChatText,
  startOwnRollbackVote, markMyVote, isRollbackVoting, dismissRollbackVote,
} from './rollbackVote'

export function clearError() {
  setState({ error: null })
}

export function setStoreError(error: string) {
  setState({ error })
}

/**
 * The message a failed `replayGame` shows the user (list row + banner): the
 * proxy's own text when it carries one, the generic replay-load copy when the
 * reply is only a bare code (`ERR_FAILED`, `NOT_CONNECTED`, `TIMEOUT`) — a code
 * is not copy.
 */
export function replayLoadErrorMessage(error: string | null | undefined, fallback: string): string {
  if (!error) return fallback
  if (error === 'not connected' || error === 'timeout') return fallback
  if (/^[A-Z][A-Z0-9_]*$/.test(error)) return fallback
  return error
}

/** Toggle the replay play/pause flag (the viewer's step timer). */
export function setReplayPlaying(playing: boolean) {
  const s = getState()
  if (s.replay) setState({ replay: { ...s.replay, playing } })
}

/**
 * Choose the replay "view as" seat (a `PlayerView.playerId`), or null for the
 * automatic default. A no-op outside an open replay — the choice is scoped to
 * the replay session and dies with it (never persisted).
 */
export function setReplayPerspective(playerId: string | null) {
  const s = getState()
  if (s.replay) setState({ replay: { ...s.replay, perspectivePlayerId: playerId } })
}

/** Leave the replay viewer, back to the lobby (the board is a detached frame). */
export function exitReplay() {
  const s = getState()
  if (s.replay?.gameId) void cmds.stopReplay(s.replay.gameId)
  setState({
    replay: null,
    phase: 'lobby',
    game: null,
    gameId: null,
    gameChatId: null,
    playableIds: [],
    playableWindow: null,
    combat: null,
    feedback: null,
    gameEnd: null,
    gameEndLlmSeats: null,
    // A replay-scoped refusal ("a replay is loaded — player actions are not
    // available…") is stale the moment the viewer closes: it must not sit over
    // the lobby once no replay is loaded.
    error: null,
  })
}

/** Cambia la mano visible de la barra propia (Switch Hands / Mindslaver). */
export function setSwitchedHandKey(key: string | null) {
  setState({ switchedHandKey: key })
}

export function clearFeedback() {
  resetPromptSound()
  setState({ feedback: null })
}

/** Record a resolved venture-into-the-dungeon branch choice (client-side tracking). */
export function recordDungeonRoom(gameId: string, player: string, dungeon: string, room: string) {
  const graph = findDungeonGraph(dungeon)
  const key = dungeonProgressKey(gameId, player, graph ? graph.id : dungeon)
  const prev = getState().dungeonProgress[key] ?? []
  setState({ dungeonProgress: { ...getState().dungeonProgress, [key]: advanceProgress(prev, room) } })
}

/** Sniff server dungeon-entry broadcasts (all players, including opponents). */
export function sniffDungeonEntry(message: string, gameId: string | null) {
  if (!gameId) return
  const entry = parseDungeonEntry(message)
  if (!entry) return
  recordDungeonRoom(gameId, entry.player, entry.dungeon, entry.room)
}

/** Sniff server speed-level broadcasts (`PlayerImpl.initSpeed/increaseSpeed/decreaseSpeed`). */
export function sniffSpeedLevel(message: string, gameId: string | null) {
  if (!gameId) return
  const hit = parseSpeedLevel(message)
  if (!hit) return
  const key = speedLevelKey(gameId, hit.player)
  if (getState().speedLevels[key] === hit.level) return
  setState({ speedLevels: { ...getState().speedLevels, [key]: hit.level } })
}

/** Sniff server Room-door broadcasts (`PermanentImpl.unlockDoor`). */
export function sniffRoomDoor(message: string, gameId: string | null) {
  if (!gameId) return
  const hit = parseRoomDoor(message)
  if (!hit) return
  const key = roomDoorKey(gameId, hit.card)
  setState({ roomDoors: { ...getState().roomDoors, [key]: mergeRoomDoor(getState().roomDoors[key], hit.side) } })
}

/** Mensajes del servidor que sacan al jugador de la partida sin acabarla
 *  (Commander): al perder por daño la vista no marca `hasLeft`, solo llega el
 *  texto ("X has lost the game" / "X lost the game due to …" / "You…"). */
const ELIMINATION_RE = /^(.*?)\s+(?:has lost the game|lost the game|has left the game|has conceded|wants to concede)\b/i
const ELIMINATION_YOU_RE = /^you\s+(?:have\s+)?lost the game\b/i

export function sniffElimination(message: string, gameId: string | null | undefined): void {
  if (!gameId) return
  const s = getState()
  if (s.gameId !== gameId || s.elimination?.gameId === gameId) return
  const me = s.game?.players?.find((p) => p.controlled)
  if (!me) return
  const text = cleanMageText(message)
  if (ELIMINATION_YOU_RE.test(text)) {
    setState({ elimination: { gameId, dismissed: false } })
    return
  }
  const m = text.match(ELIMINATION_RE)
  if (!m) return
  const named = m[1].trim().toLowerCase()
  const mine = me.name.trim().toLowerCase()
  if (named && (named === mine || named === 'you' || named === 'tú')) {
    setState({ elimination: { gameId, dismissed: false } })
  }
}

/** "Seguir mirando": no volver a ofrecer salir en esta partida. */
export function dismissElimination(): void {
  const s = getState()
  if (s.elimination) {
    if (!s.elimination.dismissed) setState({ elimination: { ...s.elimination, dismissed: true } })
  } else if (s.gameId) {
    setState({ elimination: { gameId: s.gameId, dismissed: true } })
  }
}

export function setMyDeck(deck: DeckJson | null) {
  saveActiveDeck(deck)
  rememberEquippedDeckId((deck as { id?: string } | null)?.id ?? null)
  setState({ myDeck: deck, sideboard: deck?.sideboard ?? [] })
}

export function clearGameEnd() {
  const pending = getState().pendingSideboardScreen
  if (pending) {
    setState({ gameEnd: null, sideboardScreen: pending, pendingSideboardScreen: null })
  } else {
    setState({ gameEnd: null })
  }
}

export function setWatchingTable(table: import('../net/types').TableView | null) {
  if (table) {
    setState({ phase: 'spectating_pending', watchingTable: table, error: null })
    void enterTableChat(table.tableId)
  } else {
    setState({ phase: 'lobby', watchingTable: null, error: null })
    exitTableChat()
  }
}

/** Joins the table's own chat (parity with the TableWaitingDialog chatPanel). */
export async function enterTableChat(tableId: string) {
  const s = getState()
  if (s.tableChatTableId === tableId && s.tableChatId) return
  exitTableChat()
  try {
    const cid = await cmds.getTableChatId(tableId)
    if (!cid) return
    if (getState().tableChatTableId) return
    setState({ tableChatId: cid, tableChatTableId: tableId })
    void cmds.joinChat(cid)
  } catch {
    // sin chat de mesa (torneo u otra causa): la sala degrada al chat global
  }
}

/** Abandona el chat de la mesa y limpia el estado. */
export function exitTableChat() {
  const s = getState()
  if (s.tableChatId) void Promise.resolve(cmds.leaveChat(s.tableChatId)).catch(() => {})
  if (s.tableChatId || s.tableChatTableId) setState({ tableChatId: null, tableChatTableId: null })
}

/** Joins the tournament's own chat (parity with the TournamentPanel chatPanel). */
export async function enterTournamentChat(tournamentId: string) {
  const s = getState()
  if (s.tournamentChatTournamentId === tournamentId && s.tournamentChatId) return
  exitTournamentChat()
  try {
    const cid = await cmds.getTournamentChatId(tournamentId)
    if (!cid) return
    if (getState().tournamentChatTournamentId) return
    setState({ tournamentChatId: cid, tournamentChatTournamentId: tournamentId })
    void cmds.joinChat(cid)
  } catch {
    // sin chat de torneo: el panel degrada a solo bracket
  }
}

/** Abandona el chat del torneo y limpia el estado. */
export function exitTournamentChat() {
  const s = getState()
  if (s.tournamentChatId) void Promise.resolve(cmds.leaveChat(s.tournamentChatId)).catch(() => {})
  if (s.tournamentChatId || s.tournamentChatTournamentId) setState({ tournamentChatId: null, tournamentChatTournamentId: null })
}

/** Abre la sala de espera de la partida (paridad con el TableWaitingDialog de desktop). */
export function openStagingTable(tableId: string) {
  const t = getState().lobby?.tables.find((tb) => tb.tableId === tableId)
  setState({ phase: 'staging', stagingTableId: tableId, stagingIsTournament: t?.isTournament ?? false, error: null })
  void enterTableChat(tableId)
}

/** Vuelve al lobby sin abandonar el asiento (se puede regresar con "Ir a la mesa"). */
export function hideStaging() {
  setState({ phase: 'lobby', error: null })
}

async function exitStagingVia(action: (tableId: string) => Promise<unknown>) {
  const s = getState()
  const tableId = s.stagingTableId
  exitTableChat()
  setState({ phase: 'lobby', stagingTableId: null, stagingIsTournament: false, error: null })
  if (tableId) {
    try {
      await action(tableId)
    } catch {
      // el servidor puede rechazar el leave si la partida ya arrancó; el lobby queda igualmente
    }
  }
}

export function leaveStagingTable() {
  return exitStagingVia((tableId) => cmds.leaveTable(tableId))
}

export function removeStagingTable() {
  return exitStagingVia(async (tableId) => {
    const res = await cmds.removeTable(tableId)
    if (!res.ok) setState({ error: translateError(res.error || res.errorCode || 'FAILED', 'removeTable', res.errorCode) })
    return res
  })
}

/** Arranca la partida de la mesa en staging (solo dueño, la UI lo gatea). */
export async function startStagedMatch(): Promise<boolean> {
  const s = getState()
  if (!s.stagingTableId) return false
  const staged = s.lobby?.tables.find((tb) => tb.tableId === s.stagingTableId)
  const isTourney = staged?.isTournament ?? s.stagingIsTournament
  const action = isTourney ? 'startTournament' : 'startMatch'
  setState({ error: null })
  try {
    const res = (isTourney
      ? await cmds.startTournament(s.stagingTableId)
      : await cmds.startMatch(s.stagingTableId)) as { ok?: boolean; error?: string; errorCode?: string }
    if (res?.ok) return true
    setState({ error: translateError(res?.error || res?.errorCode || 'FAILED', action, res?.errorCode) })
    return false
  } catch (e) {
    const err = e as Error & { errorCode?: string }
    setState({ error: translateError(err.message, action, err.errorCode) })
    return false
  }
}

/**
 * Concede únicamente la partida individual en curso. No abandona el match:
 * si es Bo3 o Bo5 y el match continúa, el servidor enviará END_GAME_INFO y
 * luego SIDEBOARD para preparar la siguiente partida.
 */
export async function concedeGame(gameId: string) {
  await cmds.sendPlayerAction('CONCEDE', gameId)
}

/**
 * Concede y abandona el match por completo, saliendo de la mesa y volviendo al lobby.
 */
export async function concedeMatch(gameId?: string | null) {
  const s = getState()
  const gid = gameId ?? s.gameId
  if (gid) {
    const me = s.game?.players?.find((p) => p.controlled)
    if (me) {
      void cmds.sendPlayerAction('CONCEDE', gid)
      void cmds.quitMatch(gid)
    }
  }
  returnToLobby()
}

export function openRollbackDialog() {
  setState({ rollbackDialogOpen: true })
}

export function closeRollbackDialog() {
  setState({ rollbackDialogOpen: false })
}

export async function requestRollback(gameId: string, turnsToRollback = 0) {
  startOwnRollbackVote(gameId, turnsToRollback)
  const res = await cmds.sendPlayerAction('ROLLBACK_TURNS', gameId, turnsToRollback)
  if (!res.ok) {
    dismissRollbackVote()
    setState({ error: res.error ?? 'Error requesting rollback' })
  } else {
    // El ok del proxy solo confirma el envío: el servidor puede negar después.
    // Armar ya (sin carreras) para aceptar la vista restaurada cuando ejecute.
    armRollbackPending(gameId)
  }
  return res
}

export async function voteRollback(gameId: string, accept: boolean, requesterUserId?: string) {
  const action = accept ? ROLLBACK_ACCEPT_ACTION : ROLLBACK_DENY_ACTION
  const res = await cmds.sendPlayerAction(action, gameId, requesterUserId)
  if (!res.ok) {
    setState({ error: res.error ?? 'Error sending rollback vote' })
    return res
  }
  markMyVote(gameId, accept ? 'accepted' : 'denied')
  if (accept) {
    armRollbackPending(gameId)
    const chatId = getState().gameChatId
    if (chatId) void cmds.sendChatMessage(chatId, rollbackAcceptChatText(getState().game?.turn ?? 0))
  }
  return res
}

export async function requestUndo(gameId: string) {
  const res = await cmds.sendPlayerAction('UNDO', gameId)
  if (!res.ok) {
    setState({ error: res.error ?? 'Error requesting undo' })
  }
  return res
}

/** Marca que hay un rollback en curso para gameId: la próxima vista con posición
 * vieja (turno/paso hacia atrás) se acepta como restaurada en vez de descartarse.
 * Se arma con la acción propia (pedir/aceptar) o el anuncio del servidor, y se
 * desarma al consumir, al denegarse o al cerrar la partida. */
export function armRollbackPending(gameId: string | null | undefined): void {
  if (gameId) setState({ rollbackPendingFor: gameId, rollbackPendingAt: Date.now() })
}

export function disarmRollbackPending(): void {
  if (getState().rollbackPendingFor != null) setState({ rollbackPendingFor: null, rollbackPendingAt: null })
}

/** Armed for gameId and still fresh: a vote still on screen keeps it alive;
 * otherwise it expires ROLLBACK_PENDING_TTL_MS after the last arm (request,
 * accept or server announce), so a vote that never resolves cannot later let
 * a stale, out-of-order view overwrite the board. */
export function isRollbackPending(s: Pick<AppState, 'rollbackPendingFor' | 'rollbackPendingAt' | 'rollbackVote'>, gameId: string | null | undefined, now = Date.now()): boolean {
  if (!gameId || s.rollbackPendingFor !== gameId) return false
  if (isRollbackVoting(s.rollbackVote, gameId) && !s.rollbackVote?.hidden) return true
  return s.rollbackPendingAt != null && now - s.rollbackPendingAt < ROLLBACK_PENDING_TTL_MS
}

export function returnToLobby() {
  const s = getState()
  const gameId = s.gameId
  const me = s.game?.players?.find((p) => p.controlled)
  clearActiveGame()
  if (gameId) {
    if (!me) {
      void cmds.stopWatching(gameId)
    } else {
      void cmds.quitMatch(gameId)
    }
  } else if (!me && s.watchingTable?.games?.length) {
    // Spectator whose gameId was lost with the on-screen game view: the watched
    // table is still loading the match's game ids — stop watching the current
    // one so the server stops sending frames to this session.
    const games = s.watchingTable.games
    void cmds.stopWatching(games[games.length - 1])
  } else if (!me && s.game) {
    // Game view with no known id and no watched/queued table: this used to
    // close the menu without sending ANYTHING. Fail fast: leave a log trace
    // instead of a silent no-op; the id the server needs was never learned by
    // the client.
    addLog('error', 'spectator leave: no game id or watched table to disconnect')
  }
  if (s.gameChatId) {
    void cmds.leaveChat(s.gameChatId)
  }
  if (s.watchingTable) {
    void cmds.leaveTable(s.watchingTable.tableId)
  }
  if (s.stagingTableId) {
    void cmds.leaveTable(s.stagingTableId)
  }
  exitTableChat()
  exitTournamentChat()
  // Filter out match-specific chat messages, preserving only lobby room chat
  const preservedChat = s.roomChatId
    ? s.chatMessages.filter((m) => !m.chatId || m.chatId === s.roomChatId)
    : s.chatMessages
  setState({
    phase: 'lobby',
    watchingTable: null,
    stagingTableId: null,
    stagingIsTournament: false,
    tableChatId: null,
    tableChatTableId: null,
    tournamentChatId: null,
    tournamentChatTournamentId: null,
    game: null,
    gameId: null,
    gameChatId: null,
    chatMessages: preservedChat,
    playableIds: [],
    playableWindow: null,
    combat: null,
    feedback: null,
    gameEnd: null,
    gameEndLlmSeats: null,
    turnRecap: null,
    enteredThisTurn: {},
    replay: null,
    sideboardScreen: null,
    pendingSideboardScreen: null,
    elimination: null,
    error: null,
  })
}

export function dismissTurnRecap(key?: string) {
  const current = getState().turnRecap
  if (!current || (key && current.key !== key)) return
  setState({ turnRecap: null })
}

function persistClientSettings(settings: AppState['settings']) {
  const { effects, animationSpeed, soundEnabled, masterVolume, sfxVolume, uiVolume, prioritySound, musicEnabled, musicVolume, sleeveId, playmatId, cardStyle, tapStyle, showHandCost, showManaSource, ptBadgeMode, sicknessStyle, cardRender, handRail, handRailWidth, handRow, boardFill, stackCaption, gameUi, boardLayout, boardLayoutManual, uiScale, cjkBoost, transparentDialogs, autoAnswers, choiceMemory, manaPayment, phaseStops, smartStops } = settings
  saveFxSettings({ effects, animationSpeed })
  saveAudioSettings({ soundEnabled, masterVolume, sfxVolume, uiVolume, prioritySound })
  saveMusicSettings({ musicEnabled, musicVolume })
  saveAppearanceSettings({ sleeveId, boardLayout, boardLayoutManual, uiScale, cjkBoost, transparentDialogs, playmatId, cardStyle, tapStyle, showHandCost, showManaSource, ptBadgeMode, sicknessStyle, cardRender, handRail, handRailWidth, handRow, boardFill, stackCaption, gameUi })
  saveAutoAnswers(autoAnswers.map(({ pattern, answer, key }) => (key ? { pattern, answer, key } : { pattern, answer })))
  saveChoiceMemory(choiceMemory.map(({ pattern, value }) => ({ pattern, value })))
  saveManaPayment({ ...manaPayment })
  savePhaseStops({ ...phaseStops })
  saveSmartStops(smartStops)
  try { applyAppearanceToDocument({ sleeveId, boardLayout, uiScale, cjkBoost, transparentDialogs }, getLanguage()) } catch {}
  soundManager.setSettings({ soundEnabled, masterVolume, sfxVolume, uiVolume })
  soundManager.setMusicVolume(musicEnabled ? musicVolume : 0)
}

export function setSetting<K extends keyof AppState['settings']>(key: K, value: AppState['settings'][K]) {
  const next = { ...getState().settings, [key]: value }
  if (key === 'boardLayout') next.boardLayoutManual = true
  if (key === 'handRow' && value === true) next.handRail = false
  if (key === 'handRail' && value === true) next.handRow = false
  if (PRESET_OWNED_KEYS.has(key) && next.gameplayPreset) {
    next.gameplayPreset = null
    saveGameplayPreset(null)
  }
  setState({ settings: next })
  persistClientSettings(next)
  if (key === 'autoAnswers') syncAutoAnswersToServer()
  if (key === 'smartStops') {
    const gameId = getState().gameId
    if (gameId && (getState().game?.players ?? []).some((p) => p.controlled)) {
      void cmds.updatePreferences(serverPhaseStops(next.smartStops, getState().phaseStops))
    }
  }
}

/**
 * Deja las respuestas automáticas del servidor (HumanPlayer de XMage) igual que
 * las reglas locales. Solo jugando: un espectador no tiene HumanPlayer.
 */
export function syncAutoAnswersToServer(gameId = getState().gameId) {
  const s = getState()
  if (!gameId || !(s.game?.players ?? []).some((p) => p.controlled)) return
  for (const { action, data } of serverAutoAnswerActions(s.settings.autoAnswers ?? [])) {
    void cmds.sendPlayerAction(action, gameId, data)
  }
}

/** Aplica un preset de automatización completo (maná, auto-pass, paradas) y lo empuja al servidor si hay partida. */
export function applyGameplayPreset(id: GameplayPresetId) {
  const s = getState()
  const preset = gameplayPreset(id)
  const next: AppState['settings'] = { ...s.settings, ...preset.bundle, gameplayPreset: id }
  setState({ settings: next })
  saveGameplayPreset(id)
  persistClientSettings(next)
  if (!s.gameId) return
  for (const action of manaPaymentActions(next.manaPayment)) void cmds.sendManaPaymentMode(action, s.gameId)
  void cmds.updateManaConfirmPreference(next.manaPayment.confirmEmptyPool)
  void cmds.updatePreferences(serverPhaseStops(next.smartStops, next.phaseStops))
  void cmds.sendPlayerAction(next.holdPriority ? 'HOLD_PRIORITY' : 'UNHOLD_PRIORITY', s.gameId)
}

/**
 * Claims the one answer the current priority window admits.
 *
 * XMage consumes exactly ONE answer per ask, and an answer that arrives while
 * the game is not open for one is not discarded: `HumanPlayer.waitResponseOpen`
 * parks it and the game applies it at the NEXT ask ("server must keep only
 * latest answer"). A second click on Pass Priority therefore does not repeat
 * the pass — it silently answers a later window, which is how the stack gets
 * skipped without the player ever seeing the ask.
 *
 * The GAME_SELECT frame that grants priority IS the ask, so its identity marks
 * the open request (`priorityRequest`). Before a game's first GAME_SELECT there
 * is no such marker; there the frame being answered stands in for it, so a
 * repeated click on that same frame is dropped too. A refused answer does not
 * un-claim: when the game still wants an answer it asks again (a new
 * GAME_SELECT, a new identity) and the request opens up by itself.
 */
export function claimPriorityAnswer(): boolean {
  const s = getState()
  const request = s.priorityRequest ?? s.game
  if (!request || s.gameId == null) return false
  if (s.priorityAnsweredRequest === request) return false
  setState({ priorityAnsweredRequest: request, priorityAnsweredSeq: s.priorityAnsweredSeq + 1 })
  return true
}

/** True while the last answer this client sent is still the answer to the
 *  current priority request — the server has not asked again yet. */
export function priorityAnswerPending(
  s: Pick<AppState, 'priorityRequest' | 'priorityAnsweredRequest' | 'game'>,
): boolean {
  const request = s.priorityRequest ?? s.game
  return request != null && s.priorityAnsweredRequest === request
}

export function maybeAutoPass(game: GameView) {
  const s = getState()
  if (!s.settings.smartStops || s.feedback || !s.gameId) return
  if (isRollbackVoting(s.rollbackVote, s.gameId)) return
  if (isControllingPriority(game)) return
  const me = game.players?.find((p) => p.controlled)
  if (!me?.hasPriority) return
  if (s.combat && s.combat.selectable.length > 0) return
  const request = s.priorityRequest
  // Only the GAME_SELECT frame is a priority request; a state push around it is
  // not, and answering one would park the answer for the ask that follows.
  if (!request || s.game !== request) return
  if (meaningfulPlayables(game, s.playableIds).length > 0) return
  if (decideStop(game, s.phaseStops).action === 'stop') return
  if (!claimPriorityAnswer()) return
  void cmds.sendPlayerBoolean(false, s.gameId)
}

export function appendLocalChatMessage(message: string, chatId?: string | null): void {
  const s = getState()
  const localMsg: ChatMessageEvent = {
    chatId: chatId ?? s.roomChatId ?? '',
    username: '',
    message,
    messageType: 'SYSTEM',
  }
  setState({ chatMessages: [...s.chatMessages, localMsg].slice(-300) })
}
