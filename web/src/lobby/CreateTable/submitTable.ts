import * as cmds from '../../net/commands'
import { setMyDeck } from '../../state/store'
import { findPresetDefaultDeck, presetDefaultDeck, type Deck } from '../decks'
import { requestDeckValidation } from '../DeckIssuesDialog'
import type { useTranslation } from '../../i18n'
import { prepareDeckForXMage } from '../../decks/deckNormalize'
import { isLimitedDeckType } from '../../decks/formatRules'
import { parseAnyDeck } from '../../decks/parseDck'
import {
  buildLimitedOptions,
  isNativeAiSeatType,
  isP1SeatType,
  isSimSeatType,
  normalizeSeatType,
  parseLimitedSetCodes,
  simSeatsEnabled,
} from './constants'
import { llmConfigsForSeats } from './llmConfig'
import {
  computeTournamentSeats,
  computeMatchSeats,
  buildTournamentLimitedOptions,
  buildCreateTournamentArgs,
  buildCreateMatchArgs,
  validateDraftSets,
  limitedTourneyHasAiSeats,
  type TableKindResolution,
} from './tableKind'
import { isRandomPacksType } from './RandomPacksSelector'
import type { CreateTableForm } from './types'
import type { DeckJson } from '../../net/types'

type Translation = ReturnType<typeof useTranslation>

/** What the create-table flow reads from the form. */
export type SubmitTableForm = Pick<
  CreateTableForm,
  | 'name' | 'gameType' | 'deckType' | 'wins' | 'skillLevel' | 'rated'
  | 'draftSetsRaw' | 'draftBoosters' | 'draftConstructionTime' | 'draftCubeName' | 'draftTiming'
  | 'numberRounds' | 'singleGame' | 'timeLimit' | 'bufferTime' | 'freeMulligans' | 'mulliganType'
  | 'customStartLifeEnabled' | 'customStartLife' | 'customStartHandSizeEnabled' | 'customStartHandSize'
  | 'planeChase' | 'attackOption' | 'range' | 'password' | 'bannedUsersRaw' | 'spectatorsAllowed'
  | 'rollbackTurnsAllowed' | 'minimumRating' | 'quitRatio' | 'edhPowerLevel' | 'numPlayers'
  | 'seatConfigs' | 'humanSeat' | 'myDeck' | 'simDeck' | 'playerTypesSel' | 'mySkill'
  | 'skipInitShuffling' | 'skipStartingPlayerChoice' | 'showRangeAttack' | 'isDraftLimited'
  | 'isTournament' | 'compatibilityError'
> & {
  username: string
  tableResolution: TableKindResolution
  findDeck: (ref?: string) => Deck | undefined
}

/** How the flow reports back to the dialog. */
export interface SubmitTableIO {
  t: Translation['t']
  tError: Translation['tError']
  setBusy: (v: boolean) => void
  setError: (v: string | null) => void
  onClose: () => void
}

function discardTable(tableId: string) {
  void cmds.removeTable(tableId)
}

/**
 * Raw per-seat llmConfig aligned with `playerTypesFinal` (which may carry a
 * HUMAN prefix when the human seat is enabled). Index j of playerTypesFinal
 * maps back to seatConfigs[j - humanOffset]; the prefix and the filler seats
 * appended by the seat computation have no config.
 */
function rawLlmConfigsByFinalSeat(
  playerTypesFinal: string[],
  seatConfigs: SubmitTableForm['seatConfigs'],
  humanSeat: boolean,
): Array<Record<string, unknown> | null | undefined> {
  const offset = humanSeat ? 1 : 0
  return playerTypesFinal.map((_, j) => (j >= offset ? seatConfigs[j - offset]?.llmConfig : undefined))
}

/**
 * The deck of a bot seat: its own choice, else the global sim deck, else mine,
 * else the curated bundled corpus deck — DEFAULT_DECK ('Mage Web bolt', 56
 * Mountain + 4 Bolt) is the deterministic e2e-harness deck and must NOT seat a
 * live LLM/bot table (all-land hands ≈60% of games are unwinnable). The chain
 * returning `undefined` (no deck anywhere) sends the seat down the existing
 * `create_err_no_deck` error path instead of the lands deck.
 */
function resolveSimDeck(f: SubmitTableForm, deckRefValue?: string): Deck | null {
  if (deckRefValue) {
    const found = f.findDeck(deckRefValue)
    if (found) return found
  }
  return f.simDeck ?? f.myDeck ?? findPresetDefaultDeck() ?? null
}

function botName(counter: number, total: number) {
  return counter === 1 && total === 1 ? 'Computer' : `Computer ${counter}`
}

/** Validates the form, creates the table or tournament, seats the bots and then me. */
export async function submitCreateTable(f: SubmitTableForm, io: SubmitTableIO): Promise<void> {
  const { t, setError, setBusy } = io
  if (!f.name.trim()) {
    setError(t('errors','create_table_name_required'))
    return
  }
  if (f.compatibilityError && !f.isDraftLimited) {
    setError(f.compatibilityError)
    return
  }
  if (f.humanSeat && !f.myDeck && !f.isDraftLimited) {
    setError(t('lobby', 'create_err_no_deck'))
    setBusy(false)
    return
  }
  setBusy(true)
  setError(null)
  if (f.isTournament) {
    await submitTournament(f, io)
  } else {
    await submitMatch(f, io)
  }
}

async function submitTournament(f: SubmitTableForm, io: SubmitTableIO): Promise<void> {
  const { t, tError, setError, setBusy } = io
  const { tableResolution, isDraftLimited, deckType, gameType, seatConfigs, password } = f
  const normalizedTournamentType = tableResolution.normalizedTournamentType
  if (tableResolution.kind === 'invalid') {
    setError(t('lobby', 'create_err_bad_tournament_type', { type: tableResolution.errorParam }))
    setBusy(false)
    return
  }
  const { playerTypesFinal, effectiveSeatTypes } = computeTournamentSeats({
    seatConfigs,
    playerTypesSel: f.playerTypesSel,
    numPlayers: f.numPlayers,
    humanSeat: f.humanSeat,
    draft: isDraftLimited,
  })
  if (isDraftLimited && limitedTourneyHasAiSeats(playerTypesFinal)) {
    setError(t('errors', 'draft_bots_no_submit'))
    setBusy(false)
    return
  }

  let limitedOptions: ReturnType<typeof buildLimitedOptions> | undefined
  if (isDraftLimited) {
    const setsError = validateDraftSets(f.draftSetsRaw, f.draftBoosters, {
      cube: f.draftCubeName.trim().length > 0,
      random: isRandomPacksType(normalizedTournamentType),
    })
    if (setsError) {
      setError(t('errors', setsError, {
        need: f.draftBoosters,
        have: parseLimitedSetCodes(f.draftSetsRaw).length,
      }))
      setBusy(false)
      return
    }
    limitedOptions = buildTournamentLimitedOptions({
      draftSetsRaw: f.draftSetsRaw,
      draftBoosters: f.draftBoosters,
      draftConstructionTime: f.draftConstructionTime,
      draftCubeName: f.draftCubeName,
      draftTiming: f.draftTiming,
      tournamentType: normalizedTournamentType,
    })
  }

  let finalMyDeck: Deck | null = null
  if (!isDraftLimited && f.humanSeat && f.myDeck) {
    const fixed = await requestDeckValidation(prepareDeckForXMage(f.myDeck, deckType, gameType))
    if (!fixed) {
      setBusy(false)
      return
    }
    finalMyDeck = fixed
  }

  const tArgs = buildCreateTournamentArgs({
    name: f.name,
    username: f.username,
    tournamentType: normalizedTournamentType,
    gameType,
    deckType,
    draft: isDraftLimited,
    limitedOptions,
    playerTypesFinal,
    llmConfigs: llmConfigsForSeats(playerTypesFinal, rawLlmConfigsByFinalSeat(playerTypesFinal, seatConfigs, f.humanSeat)),
    password,
    spectatorsAllowed: f.spectatorsAllowed,
    wins: f.wins,
    numberRounds: f.numberRounds,
    skillLevel: f.skillLevel,
    rated: f.rated,
    rollbackTurnsAllowed: f.rollbackTurnsAllowed,
    timeLimit: f.timeLimit,
    bufferTime: f.bufferTime,
    minimumRating: f.minimumRating,
    quitRatio: f.quitRatio,
    bannedUsersRaw: f.bannedUsersRaw,
    singleGame: f.singleGame,
  })
  const res = await cmds.createTournamentTable(tArgs)
  setBusy(false)
  if (!res.ok) {
    const code = res.errorCode
    const raw = res.error || code || t('errors','draft_create_failed')
    setError(tError(raw, 'createTournamentTable', code) ?? raw)
    return
  }
  const tableId = (res.data as { tableId?: string } | null)?.tableId
  if (tableId) {
    const tournamentBotSeats = effectiveSeatTypes
      .map((type, idx) => ({ type, idx, cfg: seatConfigs[idx] }))
      .filter((s) => isNativeAiSeatType(s.type))
    let botCounter = 1
    for (const bot of tournamentBotSeats) {
      const name = botName(botCounter, tournamentBotSeats.length)
      botCounter++
      let botDeck: Deck | undefined = undefined
      if (!isDraftLimited) {
        if (bot.cfg && isP1SeatType(bot.cfg.type)) {
          // COMPUTER_P1: the seat carries the training deck TEXT.
          // Parse it verbatim and do NOT run the format-fix dialog — a "correction"
          // could move the list out of the 55-deck pool. The server's
          // P1DeckRestriction is the authoritative check at join.
          botDeck = bot.cfg.deckName ? (parseAnyDeck(bot.cfg.deckName, 'P1 training deck') ?? undefined) : undefined
        } else {
          const base = resolveSimDeck(f, bot.cfg?.deckName)
          if (base) {
            const fixed = await requestDeckValidation(prepareDeckForXMage(base, deckType, gameType))
            botDeck = fixed ?? undefined
          }
        }
        if (!botDeck) {
          setError(t('lobby', 'create_err_no_deck'))
          discardTable(tableId)
          return
        }
      }
      const joinBot = await cmds.joinTournamentTable({
        tableId,
        playerName: name,
        playerType: normalizeSeatType(bot.type),
        skill: bot.cfg?.skill ?? 2,
        ...(botDeck ? { deck: botDeck, deckType, gameType } : {}),
        password: password.trim() || undefined,
      })
      if (!joinBot.ok) {
        const code = joinBot.errorCode
        const raw = joinBot.error || code || t('errors', 'join_table_failed')
        setError(tError(raw, 'joinTournamentTable', code) ?? raw)
        discardTable(tableId)
        return
      }
    }
    if (f.humanSeat) {
      const join = await cmds.joinTournamentTable({
        tableId,
        playerName: f.username,
        playerType: 'HUMAN',
        skill: f.mySkill,
        ...(finalMyDeck ? { deck: finalMyDeck, deckType, gameType } : {}),
        password: password.trim() || undefined,
      })
      if (finalMyDeck && f.myDeck) {
        setMyDeck(f.myDeck)
      }
      if (!join.ok) {
        const code = join.errorCode
        const raw = join.error || code || t('errors','join_table_failed')
        setError(tError(raw, 'joinTournamentTable', code) ?? raw)
        discardTable(tableId)
        return
      }
    }
  }
  io.onClose()
}

async function submitMatch(f: SubmitTableForm, io: SubmitTableIO): Promise<void> {
  const { t, tError, setError, setBusy } = io
  const { deckType, gameType, seatConfigs, password, humanSeat, myDeck } = f
  const { playerTypesFinal, effectiveSeatTypes } = computeMatchSeats({
    seatConfigs,
    playerTypesSel: f.playerTypesSel,
    numPlayers: f.numPlayers,
    humanSeat,
  })
  const nativeBotSeats = effectiveSeatTypes
    .map((type, idx) => ({ type, idx, cfg: seatConfigs[idx] }))
    .filter((s) => isNativeAiSeatType(s.type))

  // pre-validation against the server card database (human and bot seats)
  // Transformación invisible para Commander: XMage espera comandante en banquillo
  let finalMyDeck: Deck | null = null
  if (humanSeat && myDeck) {
    const fixed = await requestDeckValidation(prepareDeckForXMage(myDeck, deckType, gameType))
    if (!fixed) {
      setBusy(false)
      return
    }
    finalMyDeck = fixed
  }

  // Fork SIM path (gated by `simSeatsEnabled` — upstream v0.4.7 4fe0f8ab8a
  // made the proxy-side SIM bot dev-only and the stock client never sends
  // `simDecks`; the proxy rejects SIM seats without `--sim on`, which
  // scripts/dev.mjs sets). Where SIM seats still exist (dev channel /
  // VITE_SIM_SEATS), the per-seat deck chain and the global sim deck fallback
  // must survive: they keep the demo table and the e2e harness off the
  // 56-Mountain lands deck.
  const simSeats = simSeatsEnabled() ? effectiveSeatTypes.filter(isSimSeatType).length : 0

  let finalSimDeck: Deck | null = null
  if (simSeats > 0) {
    const base = resolveSimDeck(f)
    if (!base) {
      setError(t('lobby', 'create_err_no_deck'))
      setBusy(false)
      return
    }
    const fixed = await requestDeckValidation(prepareDeckForXMage(base, deckType, gameType))
    if (!fixed) {
      setBusy(false)
      return
    }
    finalSimDeck = fixed
  }

  const simDecksBySeat: DeckJson[] = []
  if (simSeats > 0 && finalSimDeck) {
    for (let i = 0; i < effectiveSeatTypes.length; i++) {
      if (isSimSeatType(effectiveSeatTypes[i])) {
        const cfg = seatConfigs[i]
        const deckForSeat = resolveSimDeck(f, cfg?.deckName)
        if (!deckForSeat) {
          setError(t('lobby', 'create_err_no_deck'))
          setBusy(false)
          return
        }
        simDecksBySeat.push(prepareDeckForXMage(deckForSeat, deckType, gameType))
      }
    }
    while (simDecksBySeat.length < simSeats) simDecksBySeat.push(finalSimDeck)
  }

  const nativeBotDecks: Record<number, Deck> = {}
  if (nativeBotSeats.length > 0 && !isLimitedDeckType(deckType)) {
    for (const bot of nativeBotSeats) {
      if (bot.cfg && isP1SeatType(bot.cfg.type)) {
        // COMPUTER_P1: the seat carries the training deck TEXT.
        // Parse verbatim; no format-fix dialog (it could break pool membership).
        const training = bot.cfg.deckName ? parseAnyDeck(bot.cfg.deckName, 'P1 training deck') : null
        if (!training) {
          setError(t('lobby', 'create_err_no_deck'))
          setBusy(false)
          return
        }
        nativeBotDecks[bot.idx] = training
        continue
      }
      const base = resolveSimDeck(f, bot.cfg?.deckName)
      if (!base) {
        setError(t('lobby', 'create_err_no_deck'))
        setBusy(false)
        return
      }
      const fixed = await requestDeckValidation(prepareDeckForXMage(base, deckType, gameType))
      if (!fixed) {
        setBusy(false)
        return
      }
      nativeBotDecks[bot.idx] = fixed
    }
  }

  const seatSkills = effectiveSeatTypes.map((_, i) => seatConfigs[i]?.skill ?? 2)
  const res = await cmds.createTable(buildCreateMatchArgs({
    name: f.name,
    username: f.username,
    gameType,
    deckType,
    wins: f.wins,
    playerTypesFinal,
    seatSkills,
    llmConfigs: llmConfigsForSeats(playerTypesFinal, rawLlmConfigsByFinalSeat(playerTypesFinal, seatConfigs, humanSeat)),
    password,
    skillLevel: f.skillLevel,
    rated: f.rated,
    spectatorsAllowed: f.spectatorsAllowed,
    rollbackTurnsAllowed: f.rollbackTurnsAllowed,
    timeLimit: f.timeLimit,
    bufferTime: f.bufferTime,
    freeMulligans: f.freeMulligans,
    showRangeAttack: f.showRangeAttack,
    attackOption: f.attackOption,
    range: f.range,
    minimumRating: f.minimumRating,
    quitRatio: f.quitRatio,
    edhPowerLevel: f.edhPowerLevel,
    bannedUsersRaw: f.bannedUsersRaw,
    mulliganType: f.mulliganType,
    customStartLifeEnabled: f.customStartLifeEnabled,
    customStartLife: f.customStartLife,
    customStartHandSizeEnabled: f.customStartHandSizeEnabled,
    customStartHandSize: f.customStartHandSize,
    planeChase: f.planeChase,
    simDecks: simDecksBySeat,
    skipInitShuffling: f.skipInitShuffling,
    skipStartingPlayerChoice: f.skipStartingPlayerChoice,
    dev: import.meta.env.DEV,
  }))

  setBusy(false)
  if (!res.ok) {
    const code = res.errorCode
    const raw = res.error || code || t('errors','create_table_failed')
    setError(tError(raw, 'createTable', code) ?? raw)
    return
  }

  const tableId = (res.data as { tableId?: string } | null)?.tableId
  if (tableId) {
    let botCounter = 1
    for (const bot of nativeBotSeats) {
      const name = botName(botCounter, nativeBotSeats.length)
      botCounter++
      // No deck anywhere: never fall back to the e2e lands deck on a live
      // table — surface the no-deck error instead.
      const botDeck = nativeBotDecks[bot.idx] ?? finalSimDeck ?? finalMyDeck ?? presetDefaultDeck()
      const joinBot = await cmds.joinTable({
        tableId,
        playerName: name,
        playerType: normalizeSeatType(bot.type),
        skill: bot.cfg?.skill ?? 2,
        deck: botDeck,
        deckType,
        gameType,
        password: password.trim() || undefined,
      })
      if (!joinBot.ok) {
        const code = joinBot.errorCode
        const raw = joinBot.error || code || t('errors', 'join_table_failed')
        setError(tError(raw, 'joinTable', code) ?? raw)
        discardTable(tableId)
        return
      }
    }

    if (humanSeat && finalMyDeck) {
      const join = await cmds.joinTable({
        tableId,
        playerName: f.username,
        playerType: 'HUMAN',
        skill: f.mySkill,
        deck: finalMyDeck,
        deckType,
        gameType,
        password: password.trim() || undefined,
      })
      setMyDeck(myDeck)
      if (!join.ok) {
        const code = join.errorCode
        const raw = join.error || code || t('errors','join_table_failed')
        setError(tError(raw, 'joinTable', code) ?? raw)
        discardTable(tableId)
        return
      }
    }
  }
  io.onClose()
}

/** Dev shortcut: an AI-vs-AI duel that starts at once and is watched.
 *  Seats the curated REAL bundled corpus deck (Boros Burn), never DEFAULT_DECK:
 *  the demo is a live shuffled table and the 56-Mountain bolt deck would
 *  deck-out/stall unwinnably (see `decks.ts`). If the corpus is not available
 *  (not yet loaded or `VITE_BUNDLED_DECKS` off) the demo refuses to create a
 *  table with the wrong deck: it reports the failure on `io` and stays open. */
export async function runDemoTable(
  opts: { skipInitShuffling: boolean; skipStartingPlayerChoice: boolean },
  io: Pick<SubmitTableIO, 'setBusy' | 'onClose'> & { setError?: (v: string | null) => void },
): Promise<void> {
  io.setBusy(true)
  try {
    let deck: Deck
    try {
      deck = presetDefaultDeck()
    } catch (err) {
      io.setError?.(err instanceof Error ? err.message : String(err))
      return
    }
    const res = await cmds.createTable({
      name: 'Demo IA vs IA',
      gameType: 'Two Player Duel',
      deckType: 'Constructed - Modern',
      winsNeeded: 1,
      playerTypes: ['SIM', 'SIM'],
      simDecks: [deck, deck],
      skipInitShuffling: opts.skipInitShuffling,
      skipStartingPlayerChoice: opts.skipStartingPlayerChoice,
    })
    if (res.ok) {
      const data = res.data as { tableId?: string; TableId?: string } | undefined
      const tableId = data?.tableId ?? data?.TableId
      if (tableId) {
        const started = await cmds.startMatch(tableId)
        if (started.ok) {
          await cmds.watchTable(tableId)
        }
      }
      io.onClose()
    }
  } finally {
    io.setBusy(false)
  }
}
