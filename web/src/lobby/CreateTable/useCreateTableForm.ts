import { useEffect, useMemo, useRef, useState } from 'react'
import * as cmds from '../../net/commands'
import type { GameTypeInfo, P1DeckEntry } from '../../net/commands'
import { useStore } from '../../state/store'
import { deckRef, PRESET_DEFAULT_DECK_NAME, findPresetDefaultDeck, type Deck } from '../decks'
import { deckFitForTable, isGoodFit, tableFormatProfile } from '../joinDeckFit'
import { useTranslation } from '../../i18n'
import {
  isLimitedDeckType,
  validateDeckGameCompatibility,
  isGameAndDeckCompatible,
  getDefaultDeckTypeForGame,
  getDefaultGameTypeForDeck,
} from '../../decks/formatRules'
import {
  STORAGE_KEY,
  DEFAULT_GAME_TYPES,
  DEFAULT_DECK_TYPES,
  DEFAULT_PLAYER_TYPES,
  DEFAULT_TOURNAMENT_TYPES,
  DEFAULT_DRAFT_CUBES,
  DEFAULT_DRAFT_TOURNAMENT_TYPE,
  HUMAN_SEAT,
  SIM_SEAT,
  LLM_SEAT,
  P1_SEAT,
  aiSeatTypes,
  defaultTournamentType,
  isDraftTournamentType,
  isConstructedTournamentType,
  isHumanSeatType,
  isLlmSeatType,
  isP1SeatType,
  normalizeSeatType,
  simSeatsEnabled,
  recommendedFreeMulligans,
  type CreateTab,
  type DraftTiming,
  type SeatConfig,
  type WizardStep,
  type TableCategory,
  type TournamentCategory,
  buildWizardSteps,
  type CreateKind,
} from './constants'
import { defaultLlmConfig, stripApiKeyFromSeatConfigs } from './llmConfig'
import { p1DefaultDeckText, p1SeatDeckIsTraining } from './p1Decks'
import {
  resolveTableKind,
  clampNumPlayers,
  defaultSeatTypeFor,
  healTournamentBranch,
  tournamentTypeForCategory,
  uniformDraftSet,
} from './tableKind'
import type { CreateTableForm, P1PoolStatus } from './types'
import { useDeckChoices } from './useDeckChoices'
import { submitCreateTable, runDemoTable as runDemoTableCommand } from './submitTable'

export type { CreateTableForm } from './types'

/** The form as last persisted (parsed JSON: every field is checked where it is read). */
interface SavedForm {
  tableCategory?: string
  tournamentCategory?: string
  name?: string
  gameType?: string
  deckType?: string
  wins?: number
  skillLevel?: 'BEGINNER' | 'CASUAL' | 'SERIOUS'
  rated?: boolean
  useDraftTournament?: boolean
  numPlayers?: number
  seatConfigs?: unknown
  mySkill?: number
}

function readSaved(): SavedForm {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') ?? {}
  } catch {
    return {}
  }
}

/** Discard the persisted draft of the create-table wizard (if any). */
function discardDraft() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {}
}

/** Keys handled by `applyPreset` (the wizard's quick-preset chips). */
const PRESET_KEYS: readonly string[] = ['modern_bo3', 'commander_4p', 'draft_8p', 'modern_swiss_8p']

/**
 * Switching a seat to COMPUTER_LLM materialises its LLM config with the
 * section defaults (reference behaviour: slot.llmConfig starts filled);
 * switching away drops it — the config belongs to the LLM seat only.
 */
function seatWithLlmDefaults(seat: SeatConfig, nextType: string): SeatConfig {
  if (isLlmSeatType(nextType)) {
    return { ...seat, type: nextType, llmConfig: seat.llmConfig ?? defaultLlmConfig() }
  }
  if (seat.llmConfig === undefined) return { ...seat, type: nextType }
  const { llmConfig: _dropped, ...rest } = seat
  return { ...rest, type: nextType }
}

/** A fresh filler seat for the all-bot LLM preset: no deck of its own (the
 *  preset stamps the curated bundled deck into the seat directly). */
function emptyLlmSeat(): SeatConfig {
  return { type: SIM_SEAT, deckName: '', skill: 2 }
}

/**
 * Retype a seat applying BOTH fork seat defaults: the LLM config materialization
 * and the P1 training-deck default. A switch TO COMPUTER_P1 materializes the
 * training default (a P1 seat must never carry an arbitrary/empty list); a switch
 * AWAY from COMPUTER_P1 clears that training text so the seat falls back to the
 * saved-deck path. `p1Decks` empty (pool not fetched / server without the
 * capability) leaves the deck empty — the seat is not offered anyway.
 */
function seatWithTypeDefaults(seat: SeatConfig, nextType: string, p1Decks: P1DeckEntry[], p1Default: string): SeatConfig {
  const wasP1 = isP1SeatType(seat.type)
  const withLlm = seatWithLlmDefaults(seat, nextType)
  if (isP1SeatType(nextType)) {
    if (p1SeatDeckIsTraining(p1Decks, seat.deckName)) return withLlm
    return { ...withLlm, deckName: p1DefaultDeckText(p1Decks, p1Default) }
  }
  if (wasP1) return { ...withLlm, deckName: '' }
  return withLlm
}

export function useCreateTableForm(onClose: () => void, kind: CreateKind = 'match', onReset?: () => void): CreateTableForm {
  const isTourneyKind = kind === 'tourney'
  const { t, tError } = useTranslation()
  const username = useStore((s) => s.conn?.username ?? 'player')
  const storeDeck = useStore((s) => s.myDeck)
  const capabilities = useStore((s) => s.capabilities)
  const llmEnabled = capabilities?.llm === true
  const p1Enabled = capabilities?.p1 === true

  const [saved] = useState(readSaved)
  const [gameTypes, setGameTypes] = useState<GameTypeInfo[]>(DEFAULT_GAME_TYPES)
  const [deckTypes, setDeckTypes] = useState<string[]>(DEFAULT_DECK_TYPES)
  const [playerTypes, setPlayerTypes] = useState<string[]>(DEFAULT_PLAYER_TYPES)
  const [tournamentTypes, setTournamentTypes] = useState<string[]>(DEFAULT_TOURNAMENT_TYPES)
  const [draftCubes, setDraftCubes] = useState<string[]>(DEFAULT_DRAFT_CUBES)
  // Argentum-P1 training deck pool (getP1Decks). Fetched ONCE per form open
  // when capabilities.p1 (never polled), held here like the other option lists.
  const [p1Decks, setP1Decks] = useState<P1DeckEntry[]>([])
  const [p1Default, setP1Default] = useState('')
  // Lifecycle of the once-per-open pool fetch: 'error' surfaces a refused/failed
  // getP1Decks (typed CAPABILITY_UNAVAILABLE, not connected) in the picker instead
  // of leaving it on "loading…" forever. `p1ReloadKey` re-runs the effect on retry.
  const [p1PoolStatus, setP1PoolStatus] = useState<P1PoolStatus>('loading')
  const [p1ReloadKey, setP1ReloadKey] = useState(0)

  // General tab
  const [tableCategory, setTableCategoryState] = useState<TableCategory>(() => {
    if (isTourneyKind) return 'tourney'
    return saved.tableCategory === 'multi' ? 'multi' : 'duel'
  })
  const [tournamentCategory, setTournamentCategoryState] = useState<TournamentCategory>(() => (saved.tournamentCategory === 'limited' || saved.tournamentCategory === 'constructed') ? saved.tournamentCategory as TournamentCategory : 'limited')

  const [name, setName] = useState<string>(() => saved.name || (isTourneyKind ? 'Tournament' : 'Game'))
  const [gameType, setGameTypeState] = useState<string>(() => saved.gameType || 'Two Player Duel')
  const [deckType, setDeckTypeState] = useState<string>(() => {
    if (!isTourneyKind) return saved.deckType || 'Limited'
    if (tournamentCategory === 'limited') return 'Limited'
    return saved.deckType && !isLimitedDeckType(saved.deckType) ? saved.deckType : 'Constructed - Modern'
  })

  const setGameType = (newGt: string) => {
    setGameTypeState(newGt)
    if (!isGameAndDeckCompatible(deckType, newGt)) {
      setDeckTypeState(getDefaultDeckTypeForGame(newGt))
    }
  }

  const setDeckType = (newDt: string) => {
    setDeckTypeState(newDt)
    if (!isLimitedDeckType(newDt)) setUseDraftTournament(false)
    if (!isGameAndDeckCompatible(newDt, gameType)) {
      setGameTypeState(getDefaultGameTypeForDeck(newDt, numPlayers))
    }
  }
  const [wins, setWins] = useState<number>(() => typeof saved.wins === 'number' && saved.wins >= 1 && saved.wins <= 5 ? saved.wins : 2)
  const [skillLevel, setSkillLevel] = useState<'BEGINNER' | 'CASUAL' | 'SERIOUS'>(() => saved.skillLevel || 'CASUAL')
  const [rated, setRated] = useState<boolean>(() => saved.rated === true)
  // invariant: a tournament drafts exactly when its category is limited (see tableKind.ts)
  const [useDraftTournament, setUseDraftTournament] = useState<boolean>(() => isTourneyKind && tournamentCategory === 'limited')
  const [draftSetsRaw, setDraftSetsRaw] = useState('M21, M21, M21')
  const [draftBoostersState, setDraftBoostersState] = useState<3 | 6>(3)
  const setDraftBoosters = (v: 3 | 6) => {
    setDraftBoostersState(v)
    setDraftSetsRaw((prev) => {
      const uniform = uniformDraftSet(prev)
      return uniform ? Array(v).fill(uniform).join(', ') : prev
    })
  }
  const draftBoosters = draftBoostersState
  const [draftConstructionTime, setDraftConstructionTime] = useState(600)
  const [tournamentType, setTournamentTypeState] = useState<string>(DEFAULT_DRAFT_TOURNAMENT_TYPE)
  const setTournamentType = (v: unknown) => {
    const s = typeof v === 'string' ? v : (v as { name?: string })?.name ?? DEFAULT_DRAFT_TOURNAMENT_TYPE
    setTournamentTypeState(s || DEFAULT_DRAFT_TOURNAMENT_TYPE)
  }
  const [numberRounds, setNumberRounds] = useState(0)
  const [draftCubeName, setDraftCubeName] = useState('')
  const [draftTiming, setDraftTiming] = useState<DraftTiming>('REGULAR')
  const [singleGame, setSingleGame] = useState(false)

  // The summary chip / CTA / submit branch must follow the CURRENT form, not a
  // preset explored earlier: preset- and mode-switch paths scrub the state
  // `resolveTableKind`'s tournament disjuncts read, instead of leaving whatever
  // the last tournament shape set (the gold swiss chip + tournament
  // CTA survived Swiss→Bo3 and the submit REALLY created a tournament).
  // Scrubs use the RAW setter — the `setTournamentType` wrapper coalesces every
  // falsy value back to the draft default, which is exactly the refill a
  // scrub must not trigger.
  const tournamentTypeScrub = useRef<null | 'clear'>(null)
  const scrubTournamentType = () => {
    tournamentTypeScrub.current = 'clear'
    setTournamentTypeState('')
  }

  const setTableCategory = (cat: TableCategory) => {
    setTableCategoryState(cat)
    if (cat === 'duel') {
      setUseDraftTournament(false)
      setGameTypeState('Two Player Duel')
      setDeckTypeState((curr) => (isGameAndDeckCompatible(curr, 'Two Player Duel') ? curr : 'Constructed - Modern'))
      setNumPlayers(2)
    } else if (cat === 'multi') {
      setUseDraftTournament(false)
      const multiType = gameTypes.find((g) => g.maxPlayers > 2)?.name ?? 'Commander Free For All'
      setGameTypeState(multiType)
      setDeckTypeState((curr) => (isGameAndDeckCompatible(curr, multiType) ? curr : 'Variant Magic - Commander'))
      if (numPlayers < 3) setNumPlayers(4)
    } else if (cat === 'tourney') {
      if (tournamentCategory === 'limited') {
        setUseDraftTournament(true)
        setDeckTypeState('Limited')
        setGameTypeState('Two Player Duel')
        if (!tournamentType || !isDraftTournamentType(tournamentType)) {
          setTournamentType(DEFAULT_DRAFT_TOURNAMENT_TYPE)
        }
      } else {
        setUseDraftTournament(false)
        if (isLimitedDeckType(deckType)) setDeckTypeState('Constructed - Modern')
        setGameTypeState('Two Player Duel')
        if (!isConstructedTournamentType(tournamentType)) {
          setTournamentType('Constructed Swiss')
        }
      }
    }
    // Leaving the tournament branch must not leave its type behind: outside
    // `tourney` the type is pure dead state (the tourney tabs, the sync
    // effect and the submit builder only act on it inside a tournament), and
    // stale strings are what fabricated tournaments on plain duels.
    if (cat !== 'tourney') scrubTournamentType()
  }

  const setTournamentCategory = (cat: TournamentCategory) => {
    setTournamentCategoryState(cat)
    if (cat === 'limited') {
      setUseDraftTournament(true)
      setDeckTypeState('Limited')
      if (!tournamentType || isConstructedTournamentType(tournamentType)) {
        setTournamentType(DEFAULT_DRAFT_TOURNAMENT_TYPE)
      }
    } else {
      setUseDraftTournament(false)
      if (isLimitedDeckType(deckType)) setDeckTypeState('Constructed - Modern')
      if (!isConstructedTournamentType(tournamentType)) {
        setTournamentType('Constructed Swiss')
      }
    }
  }

  /**
   * One-click all-bot LLM duel ("LLM vs LLM"): the creator becomes a spectator
   * (`humanSeat=false`) and BOTH seats become COMPUTER_LLM, each with the
   * section defaults (which inherit the server's provider/keys). This is the
   * discoverable shape of a capability the backend already accepts —
   * `createTable {playerTypes:['COMPUTER_LLM','COMPUTER_LLM']}` — that the
   * `humanSeat` toggle otherwise hides (with it ON, seat 0 is forced HUMAN).
   * Gated by capabilities.llm: without it this is a no-op and the
   * chip is never rendered.
   */
  const applyLlmVsLlm = () => {
    if (!llmEnabled) return
    setTableCategoryState('duel')
    setUseDraftTournament(false)
    setGameTypeState('Two Player Duel')
    setDeckTypeState((curr) => (isGameAndDeckCompatible(curr, 'Two Player Duel') ? curr : 'Constructed - Modern'))
    setNumPlayers(2)
    setWins(1)
    // The stale tournament type is scrubbed so this duel cannot fire the
    // tournament disjuncts; the win-flip (Bo3→Bo1) itself is NOT changed.
    scrubTournamentType()
    setHumanSeat(false)
    setPlayerTypesSel([LLM_SEAT])
    // The preset is discoverable one-click play: seat the curated REAL bundled
    // corpus deck (Boros Burn) into the LLM seats — UNCONDITIONALLY, because the
    // wizard fills fresh seats with the global sim deck, whose own default
    // (bundled list head) is still the e2e lands deck ('Mage Web bolt'): a
    // "keep any non-empty choice" rule would silently keep it. A preset that
    // forces the seat types forces the deck; the user can adjust after.
    const presetDeck = findPresetDefaultDeck() ?? { name: PRESET_DEFAULT_DECK_NAME, cards: [], sideboard: [] }
    const presetRef = deckRef(presetDeck)
    setSeatConfigs((prev) => {
      const target = [
        ...(prev.length > 0 ? prev : [emptyLlmSeat()]),
        ...Array.from({ length: Math.max(0, 2 - Math.max(prev.length, 1)) }, () => emptyLlmSeat()),
      ].slice(0, 2)
      return target.map((s) => seatWithLlmDefaults({ ...s, deckName: presetRef }, LLM_SEAT))
    })
  }

  const setUseDraftTournamentChecked = (v: boolean) => {
    setUseDraftTournament(v)
    if (tableCategory === 'tourney') setTournamentCategory(v ? 'limited' : 'constructed')
  }

  const applyPreset = (key: string) => {
    // Every preset sets its COMPLETE shape on a clean base: a preset out of a
    // tournament must never inherit the previous shape's `tournamentType` /
    // `useDraftTournament` / seat shortcut (Swiss → Bo3 left the
    // gold swiss chip and the tournament CTA on a Bo3 duel). The swiss/draft
    // presets rebuild their tournament branch on top of the same reset, so
    // their own type still lands after the sync effect's one-shot scrub honor.
    if (PRESET_KEYS.includes(key)) {
      setTableCategoryState('duel')
      setTournamentCategoryState('limited')
      setUseDraftTournament(false)
      scrubTournamentType()
      setHumanSeat(true)
      setPlayerTypesSel(['SIM'])
    }
    if (key === 'modern_bo3') {
      setTableCategoryState('duel')
      setUseDraftTournament(false)
      setGameTypeState('Two Player Duel')
      setDeckTypeState('Constructed - Modern')
      setWins(2)
      setNumPlayers(2)
    } else if (key === 'commander_4p') {
      setTableCategoryState('multi')
      setUseDraftTournament(false)
      setGameTypeState('Commander Free For All')
      setDeckTypeState('Variant Magic - Commander')
      setNumPlayers(4)
      setWins(1)
    } else if (key === 'draft_8p') {
      setTableCategoryState('tourney')
      setTournamentCategoryState('limited')
      setUseDraftTournament(true)
      setTournamentType(DEFAULT_DRAFT_TOURNAMENT_TYPE)
      setDeckTypeState('Limited')
      setGameTypeState('Two Player Duel')
      setNumPlayers(8)
      setWins(2)
      setDraftBoosters(3)
      setDraftSetsRaw('MH3, MH3, MH3')
    } else if (key === 'modern_swiss_8p') {
      setTableCategoryState('tourney')
      setTournamentCategoryState('constructed')
      setUseDraftTournament(false)
      setTournamentType('Constructed Swiss')
      setDeckTypeState('Constructed - Modern')
      setGameTypeState('Two Player Duel')
      setNumPlayers(8)
      setWins(2)
    }
  }

  // Timing tab
  const [timeLimit, setTimeLimit] = useState('MIN__25')
  const [bufferTime, setBufferTime] = useState('NONE')
  const [freeMulligans, setFreeMulligans] = useState(0)
  const [mulliganType, setMulliganType] = useState('GAME_DEFAULT')
  const [customStartLifeEnabled, setCustomStartLifeEnabled] = useState(false)
  const [customStartLife, setCustomStartLife] = useState(20)
  const [customStartHandSizeEnabled, setCustomStartHandSizeEnabled] = useState(false)
  const [customStartHandSize, setCustomStartHandSize] = useState(7)
  const [planeChase, setPlaneChase] = useState(false)
  const [attackOption, setAttackOption] = useState('MULTIPLE')
  const [range, setRange] = useState('ALL')

  // Security & Permissions tab
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [bannedUsersRaw, setBannedUsersRaw] = useState('')
  const [spectatorsAllowed, setSpectatorsAllowed] = useState(true)
  const [rollbackTurnsAllowed, setRollbackTurnsAllowed] = useState(true)
  const [minimumRating, setMinimumRating] = useState(0)
  const [quitRatio, setQuitRatio] = useState(100)
  const [edhPowerLevel, setEdhPowerLevel] = useState(0)

  const [numPlayers, setNumPlayers] = useState<number>(() => typeof saved.numPlayers === 'number' && saved.numPlayers >= 2 && saved.numPlayers <= 10 ? saved.numPlayers : 2)
  const [seatConfigs, setSeatConfigs] = useState<SeatConfig[]>(() => Array.isArray(saved.seatConfigs) ? (saved.seatConfigs as SeatConfig[]).map((s) => {
    // Upstream v0.4.7 (4fe0f8ab8a): the proxy-side SIM bot is dev-only — a form
    // persisted by an older client loses its SIM seats, which become open human
    // seats (bots are now opt-in native AI). Where the fork's SIM channel is
    // enabled (`simSeatsEnabled`, VITE_SIM_SEATS/dev), the SIM seat survives the
    // restore: the SIM-deck fallback chain and the demo/e2e harnesses ride it.
    // The fork's llmConfig survives the restore either way.
    const simOn = simSeatsEnabled()
    const t = normalizeSeatType(String(s.type ?? (simOn ? SIM_SEAT : HUMAN_SEAT)))
    return {
      type: !simOn && t === SIM_SEAT ? HUMAN_SEAT : t,
      deckName: s.deckName,
      skill: typeof s.skill === 'number' ? s.skill : 2,
      ...(s.llmConfig && typeof s.llmConfig === 'object' ? { llmConfig: { ...(s.llmConfig as Record<string, unknown>) } } : {}),
    }
  }) : [])
  const recommendedMulligans = useMemo(
    () => recommendedFreeMulligans(gameType, numPlayers),
    [gameType, numPlayers],
  )
  const lastRecommendedMulligans = useRef<number | null>(null)
  useEffect(() => {
    if (lastRecommendedMulligans.current === recommendedMulligans) return
    lastRecommendedMulligans.current = recommendedMulligans
    setFreeMulligans(recommendedMulligans)
  }, [recommendedMulligans])
  const [mySkill, setMySkill] = useState<number>(() => typeof saved.mySkill === 'number' && saved.mySkill >= 1 && saved.mySkill <= 10 ? saved.mySkill : 2)

  // Seats & Decks tab
  const [humanSeat, setHumanSeat] = useState(true)
  const { availableDecks, decksLoaded, myDeck, simDeck, findDeck, selectMyDeck, selectGlobalSimDeck, adoptStarterDecks: adoptDecks } = useDeckChoices(storeDeck, setSeatConfigs)
  const adoptStarterDecks = (decks: Deck[]) => {
    if (decks.length === 0) return
    const profile = tableFormatProfile(deckType, gameType)
    const fits = decks.map((deck) => ({ deck, fit: deckFitForTable(deck, profile) })).filter(({ fit }) => isGoodFit(fit))
    const fitting = [...fits.filter(({ fit }) => fit.level === 'match'), ...fits.filter(({ fit }) => fit.level !== 'match')].map(({ deck }) => deck)
    const mine = fitting[0] ?? decks[0]
    adoptDecks(decks, mine, fitting[1] ?? mine)
  }
  const [playerTypesSel, setPlayerTypesSel] = useState<string[]>([])

  // Dev / Test tab
  const [skipInitShuffling, setSkipInitShuffling] = useState(false)
  const [skipStartingPlayerChoice, setSkipStartingPlayerChoice] = useState(false)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const [g, d, p, tt, dc] = await Promise.all([
          cmds.getGameTypes().catch(() => [] as GameTypeInfo[]),
          cmds.getDeckTypes().catch(() => [] as string[]),
          cmds.getPlayerTypes().catch(() => [] as string[]),
          cmds.getTournamentTypes().catch(() => [] as string[]),
          cmds.getDraftCubes().catch(() => [] as string[]),
        ])
        if (!active) return
        if (g && g.length > 0) {
          setGameTypes(g)
          if (!g.some((x) => x.name === gameType)) setGameType(g[0].name)
        }
        if (d && d.length > 0) {
          setDeckTypes(d)
          if (!d.some((x) => x === deckType)) setDeckType(d[0])
        }
        if (p && p.length > 0) {
          setPlayerTypes(aiSeatTypes(p))
        }
        if (tt && tt.length > 0) {
          const names = tt
            .map((item: unknown) => (typeof item === 'string' ? item : (item as { name?: string })?.name ?? ''))
            .filter((s): s is string => typeof s === 'string' && s.length > 0)
          if (names.length > 0) {
            setTournamentTypes(names)
            if (!names.includes(tournamentType)) setTournamentType(defaultTournamentType(names))
          }
        }
        if (dc && dc.length > 0) {
          setDraftCubes(dc)
          if (draftCubeName && !dc.includes(draftCubeName)) setDraftCubeName('')
        }
      } catch (err) {
        console.warn('Could not fetch server match types, using defaults', err)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  // Argentum-P1 training deck pool: fetched ONCE per form open, only when the
  // connected server reported capabilities.p1. A rejection/throw marks
  // the pool 'error' (surfaced in the picker, with a retry that re-runs this
  // effect via p1ReloadKey); an ok answer carrying no decks marks it 'ready' with
  // an empty pool. NOT polled.
  useEffect(() => {
    if (!p1Enabled) return
    let active = true
    setP1PoolStatus('loading')
    void (async () => {
      try {
        const pool = await cmds.getP1Decks()
        if (!active) return
        setP1Decks(pool.decks)
        setP1Default(pool.default)
        setP1PoolStatus(pool.ok ? 'ready' : 'error')
      } catch (err) {
        console.warn('Could not fetch the P1 training deck list', err)
        if (active) setP1PoolStatus('error')
      }
    })()
    return () => {
      active = false
    }
  }, [p1Enabled, p1ReloadKey])

  const reloadP1Decks = () => {
    if (!p1Enabled) return
    setP1PoolStatus('loading')
    setP1ReloadKey((k) => k + 1)
  }

  const effectiveGameTypes = useMemo(() => {
    const list = [...gameTypes]
    if (gameType && !list.some((g) => g.name === gameType)) {
      list.unshift({ name: gameType, minPlayers: 2, maxPlayers: 2 })
    }
    return list
  }, [gameTypes, gameType])

  /**
   * Seat types offered in the dropdowns: COMPUTER_LLM is filtered out entirely
   * unless the connected server reported capabilities.llm;
   * COMPUTER_P1 likewise unless it reported capabilities.p1. The
   * P1 option is never in `getPlayerTypes()` (it is fork-only), so it is APPENDED
   * when the capability is present.
   */
  const visiblePlayerTypes = useMemo(() => {
    let list = playerTypes
    if (!llmEnabled) list = list.filter((pt) => !isLlmSeatType(pt))
    list = list.filter((pt) => !isP1SeatType(pt))
    if (p1Enabled && !list.includes(P1_SEAT)) list = [...list, P1_SEAT]
    return list
  }, [playerTypes, llmEnabled, p1Enabled])

  // A seat left as COMPUTER_LLM without the capability (stale persisted state
  // or a connect without capability) degrades to SIM: nothing referencing the
  // LLM seat may be sent. The shortcut selection is
  // stripped too — it is the fallback that fills seats when seatConfigs is empty.
  useEffect(() => {
    if (llmEnabled) return
    setSeatConfigs((prev) => {
      if (!prev.some((s) => isLlmSeatType(s.type))) return prev
      return prev.map((s) => (isLlmSeatType(s.type) ? seatWithLlmDefaults(s, SIM_SEAT) : s))
    })
    setPlayerTypesSel((prev) => (prev.some((pt) => isLlmSeatType(pt)) ? prev.filter((pt) => !isLlmSeatType(pt)) : prev))
  }, [llmEnabled, seatConfigs])

  // Same double gating for COMPUTER_P1: without capabilities.p1 the seat degrades
  // to SIM and is stripped from the shortcut.
  useEffect(() => {
    if (p1Enabled) return
    setSeatConfigs((prev) => {
      if (!prev.some((s) => isP1SeatType(s.type))) return prev
      return prev.map((s) => (isP1SeatType(s.type) ? { ...seatWithTypeDefaults(s, SIM_SEAT, p1Decks, p1Default) } : s))
    })
    setPlayerTypesSel((prev) => (prev.some((pt) => isP1SeatType(pt)) ? prev.filter((pt) => !isP1SeatType(pt)) : prev))
  }, [p1Enabled, seatConfigs, p1Decks, p1Default])

  useEffect(() => {
    if (!isGameAndDeckCompatible(deckType, gameType)) {
      setDeckTypeState(getDefaultDeckTypeForGame(gameType))
    }
  }, [])

  const effectiveDeckTypes = useMemo(() => {
    const compatible = deckTypes.filter((d) => isGameAndDeckCompatible(d, gameType))
    const list = compatible.length > 0 ? compatible : deckTypes
    if (deckType && !list.includes(deckType) && isGameAndDeckCompatible(deckType, gameType)) {
      list.unshift(deckType)
    }
    return list
  }, [deckTypes, deckType, gameType])

  const selectedGameTypeInfo = useMemo(() => {
    return effectiveGameTypes.find((g) => g.name === gameType)
  }, [effectiveGameTypes, gameType])

  const isMultiplayerGame = useMemo(() => {
    return (selectedGameTypeInfo?.maxPlayers ?? 2) > 2 || gameType.toLowerCase().includes('commander')
  }, [selectedGameTypeInfo, gameType])

  const showRangeAttack = useMemo(() => {
    const useRange = (selectedGameTypeInfo as { useRange?: unknown } | undefined)?.useRange
    const useAttackOption = (selectedGameTypeInfo as { useAttackOption?: unknown } | undefined)?.useAttackOption
    if (typeof useRange === 'boolean' || typeof useAttackOption === 'boolean') {
      return Boolean(useRange || useAttackOption)
    }
    return isMultiplayerGame
  }, [selectedGameTypeInfo, isMultiplayerGame])

  const isLimited = isLimitedDeckType(deckType)
  const tableResolution = resolveTableKind({
    tableCategory,
    tournamentCategory,
    // a match never drafts: only the tournament entry point can produce a draft
    useDraftTournament: isTourneyKind && useDraftTournament,
    deckType,
    tournamentType,
    knownTournamentTypes: tournamentTypes,
  })
  const { isDraftLimited, isConstructedTournament, isTournament } = tableResolution

  const wizardSteps: WizardStep[] = useMemo(
    () => buildWizardSteps({ draft: isDraftLimited, dev: import.meta.env.DEV }),
    [isDraftLimited],
  )

  const [activeTab, setActiveTab] = useState<CreateTab>('general')
  const activeIndex = useMemo(() => {
    const idx = wizardSteps.findIndex((s) => s.id === activeTab)
    return idx >= 0 ? idx : 0
  }, [wizardSteps, activeTab])

  useEffect(() => {
    if (!wizardSteps.some((s) => s.id === activeTab)) setActiveTab('general')
  }, [wizardSteps, activeTab])

  const goToIndex = (idx: number) => {
    if (idx < 0 || idx >= wizardSteps.length) return
    setActiveTab(wizardSteps[idx].id)
  }
  const goNext = () => {
    const err = validateStep(activeTab)
    if (err) {
      setError(err)
      return
    }
    setError(null)
    goToIndex(activeIndex + 1)
  }
  const goPrev = () => goToIndex(activeIndex - 1)
  const goToStep = (tab: CreateTab) => {
    const target = wizardSteps.findIndex((s) => s.id === tab)
    if (target < 0) return
    if (target <= activeIndex) {
      setError(null)
      setActiveTab(tab)
      return
    }
    for (let i = activeIndex; i < target; i++) {
      const err = validateStep(wizardSteps[i].id)
      if (err) {
        setError(err)
        setActiveTab(wizardSteps[i].id)
        return
      }
    }
    setError(null)
    setActiveTab(tab)
  }
  const isLastStep = activeIndex === wizardSteps.length - 1
  const isFirstStep = activeIndex === 0


  const compatibilityError = useMemo(() => {
    if (isDraftLimited) return null
    return validateDeckGameCompatibility(deckType, gameType)
  }, [deckType, gameType, isDraftLimited])

  const validateStep = (tab: CreateTab): string | null => {
    if (tab === 'general') {
      if (!name.trim()) return t('lobby', 'create_err_name_required')
      if (compatibilityError && !isDraftLimited) return compatibilityError
      return null
    }
    if (tab === 'seats') {
      const occupants = (humanSeat ? 1 : 0) + seatConfigs.length
      if (occupants < 1) return t('lobby', 'create_err_no_seats')
      if (humanSeat && !myDeck && !isDraftLimited) return t('lobby', 'create_err_no_deck')
      return null
    }
    return null
  }

  useEffect(() => {
    const min = selectedGameTypeInfo?.minPlayers ?? 2
    const max = selectedGameTypeInfo?.maxPlayers ?? 2
    const clamped = clampNumPlayers(numPlayers, { draft: isDraftLimited, tourney: isTournament }, min, max)
    if (clamped !== numPlayers) setNumPlayers(clamped)
  }, [selectedGameTypeInfo, numPlayers, isDraftLimited, isTournament])

  useEffect(() => {
    const target = Math.max(0, numPlayers - (humanSeat ? 1 : 0))
    const defaultSeatType = defaultSeatTypeFor(isDraftLimited)
    setSeatConfigs((prev) => {
      if (prev.length === target) return prev
      if (prev.length < target) {
        const add = Array.from({ length: target - prev.length }, () => ({ type: defaultSeatType, deckName: simDeck ? deckRef(simDeck) : '', skill: 2 }))
        return [...prev, ...add]
      }
      return prev.slice(0, target)
    })
  }, [numPlayers, humanSeat, simDeck?.name, isDraftLimited])

  useEffect(() => {
    try {
      const payload = { tableCategory, tournamentCategory, useDraftTournament, name, gameType, deckType, wins, skillLevel, rated, numPlayers, seatConfigs: stripApiKeyFromSeatConfigs(seatConfigs), mySkill, bannedUsersRaw, numberRounds, freeMulligans, mulliganType, customStartLifeEnabled, customStartLife, customStartHandSizeEnabled, customStartHandSize, planeChase }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    } catch {}
  }, [tableCategory, tournamentCategory, useDraftTournament, name, gameType, deckType, wins, skillLevel, rated, numPlayers, seatConfigs, mySkill, bannedUsersRaw, numberRounds, freeMulligans, mulliganType, customStartLifeEnabled, customStartLife, customStartHandSizeEnabled, customStartHandSize, planeChase])

  useEffect(() => {
    const healed = healTournamentBranch({ tableCategory, tournamentCategory, useDraftTournament })
    if (healed.useDraftTournament !== useDraftTournament) setUseDraftTournament(healed.useDraftTournament)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // A just-executed scrub ('clear' one-shot) is honoured instead of
    // back-filled: with `tableCategory` off tourney the sync must not refill
    // the swept '' with a type (which would re-fire the stale tournament
    // state). Inside a tournament the tourney-branch setters have just
    // installed their own valid type, so the sync still normalizes it.
    if (tournamentTypeScrub.current) {
      tournamentTypeScrub.current = null
      if (tableCategory !== 'tourney') return
    }
    const synced = tournamentTypeForCategory({ tableCategory, tournamentCategory, tournamentType })
    if (synced !== tournamentType) setTournamentType(synced)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableCategory, tournamentCategory, tournamentType])

  useEffect(() => {
    if (import.meta.env.DEV && tableCategory === 'tourney' && useDraftTournament !== (tournamentCategory === 'limited')) {
      console.error('[wizard] invariante draft roto', { tableCategory, tournamentCategory, useDraftTournament })
    }
  })

  const toggleAi = (pt: string) => {
    const n = normalizeSeatType(pt)
    setPlayerTypesSel((cur) => (cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n]))
  }
  /**
   * A seat that becomes a bot needs a playable deck at once (upstream v0.4.7's
   * bots-are-opt-in flow asserts it): with the SIM channel off the fresh seats
   * are HUMAN with no deck stamp, so the opt-in switch (HUMAN → bot) is the
   * moment to fill an empty bot seat from the global sim deck (the
   * fallback the submit path would ride anyway). Deliberately NOT on a
   * bot → bot switch: the P1 path clears the training-deck text when
   * leaving COMPUTER_P1 so the seat falls back to the saved-deck path, and a
   * refill here would stomp that clearing. An existing choice is never
   * rewritten.
   */
  const withBotDeckDefault = (prev: SeatConfig, next: SeatConfig): SeatConfig =>
    isHumanSeatType(prev.type) && !isHumanSeatType(next.type) && !next.deckName && simDeck
      ? { ...next, deckName: deckRef(simDeck) }
      : next
  const applySeatTypeToAll = (pt: string) => {
    const n = normalizeSeatType(pt)
    setSeatConfigs((prev) => prev.map((s) => withBotDeckDefault(s, seatWithTypeDefaults(s, n, p1Decks, p1Default))))
  }
  const setSeatType = (idx: number, type: string) => {
    const n = normalizeSeatType(type)
    setSeatConfigs((prev) => prev.map((s, i) => (i === idx ? withBotDeckDefault(s, seatWithTypeDefaults(s, n, p1Decks, p1Default)) : s)))
  }
  const setSeatLlmConfig = (idx: number, llmConfig: Record<string, unknown>) => {
    setSeatConfigs((prev) => prev.map((s, i) => (i === idx ? { ...s, llmConfig } : s)))
  }
  const setSeatDeck = (idx: number, deckRefValue: string) => {
    setSeatConfigs((prev) => prev.map((s, i) => (i === idx ? { ...s, deckName: deckRefValue } : s)))
  }
  const setSeatSkill = (idx: number, skill: number) => {
    setSeatConfigs((prev) => prev.map((s, i) => (i === idx ? { ...s, skill: Math.min(10, Math.max(1, skill)) } : s)))
  }

  const runDemoTable = () => runDemoTableCommand({ skipInitShuffling, skipStartingPlayerChoice }, { setBusy, setError, onClose })

  /**
   * Cancel discards the unsaved selection state like the rest of the
   * unsubmitted form: the draft persistence effect keeps `localStorage` in sync
   * with the CURRENT form while the wizard is open (a Tournament preset applies
   * `tableCategory:'tourney'` at once), so a mere close would re-open with the
   * stale preset selected. Removing the persisted draft
   * here — the hook that owns the effect — makes Cancel a real discard; a
   * closed submit re-persists its draft on the next open.
   */
  const cancel = () => {
    discardDraft()
    onClose()
  }

  const firstInvalidStep = (): { tab: CreateTab; message: string } | null => {
    for (const step of wizardSteps) {
      const message = validateStep(step.id)
      if (message) return { tab: step.id, message }
    }
    return null
  }

  const submit = async () => {
    const invalid = firstInvalidStep()
    if (invalid) {
      setError(invalid.message)
      setActiveTab(invalid.tab)
      return
    }
    return submitCreateTable({
    name, gameType, deckType, wins, skillLevel, rated,
    draftSetsRaw, draftBoosters, draftConstructionTime, draftCubeName, draftTiming,
    numberRounds, singleGame, timeLimit, bufferTime, freeMulligans, mulliganType,
    customStartLifeEnabled, customStartLife, customStartHandSizeEnabled, customStartHandSize,
    planeChase, attackOption, range, password, bannedUsersRaw, spectatorsAllowed,
    rollbackTurnsAllowed, minimumRating, quitRatio, edhPowerLevel, numPlayers,
    seatConfigs, humanSeat, myDeck, simDeck, playerTypesSel, mySkill,
    skipInitShuffling, skipStartingPlayerChoice, showRangeAttack, isDraftLimited,
    isTournament, compatibilityError,
    username, tableResolution, findDeck,
  }, { t, tError, setBusy, setError, onClose })
  }

  // Remounting the form (via `onReset`) re-runs the initializers above, so the
  // defaults live only in this file.
  const resetToDefaults = () => {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {}
    onReset?.()
  }

  return {
    kind,
    wizardSteps,
    activeTab,
    setActiveTab,
    activeIndex,
    goNext,
    goPrev,
    goToStep,
    isLastStep,
    isFirstStep,
    gameTypes,
    deckTypes,
    playerTypes: visiblePlayerTypes,
    llmEnabled,
    p1Enabled,
    p1Decks,
    p1Default,
    p1PoolStatus,
    reloadP1Decks,
    tournamentTypes,
    draftCubes,
    name,
    setName,
    gameType,
    setGameType,
    deckType,
    setDeckType,
    wins,
    setWins,
    skillLevel,
    setSkillLevel,
    rated,
    setRated,
    useDraftTournament,
    setUseDraftTournament: setUseDraftTournamentChecked,
    draftSetsRaw,
    setDraftSetsRaw,
    draftBoosters,
    setDraftBoosters,
    draftConstructionTime,
    setDraftConstructionTime,
    tournamentType,
    setTournamentType,
    numberRounds,
    setNumberRounds,
    draftCubeName,
    setDraftCubeName,
    draftTiming,
    setDraftTiming,
    singleGame,
    setSingleGame,
    timeLimit,
    setTimeLimit,
    bufferTime,
    setBufferTime,
    freeMulligans,
    setFreeMulligans,
    recommendedMulligans,
    mulliganType,
    setMulliganType,
    customStartLifeEnabled,
    setCustomStartLifeEnabled,
    customStartLife,
    setCustomStartLife,
    customStartHandSizeEnabled,
    setCustomStartHandSizeEnabled,
    customStartHandSize,
    setCustomStartHandSize,
    planeChase,
    setPlaneChase,
    attackOption,
    setAttackOption,
    range,
    setRange,
    password,
    setPassword,
    showPassword,
    setShowPassword,
    bannedUsersRaw,
    setBannedUsersRaw,
    spectatorsAllowed,
    setSpectatorsAllowed,
    rollbackTurnsAllowed,
    setRollbackTurnsAllowed,
    minimumRating,
    setMinimumRating,
    quitRatio,
    setQuitRatio,
    edhPowerLevel,
    setEdhPowerLevel,
    numPlayers,
    setNumPlayers,
    seatConfigs,
    setSeatConfigs,
    humanSeat,
    setHumanSeat,
    availableDecks,
    decksLoaded,
    adoptStarterDecks,
    myDeck,
    selectMyDeck,
    simDeck,
    selectGlobalSimDeck,
    playerTypesSel,
    toggleAi,
    applySeatTypeToAll,
    setSeatType,
    setSeatDeck,
    setSeatSkill,
    setSeatLlmConfig,
    mySkill,
    setMySkill,
    skipInitShuffling,
    setSkipInitShuffling,
    skipStartingPlayerChoice,
    setSkipStartingPlayerChoice,
    busy,
    error,
    effectiveGameTypes,
    effectiveDeckTypes,
    selectedGameTypeInfo,
    isMultiplayerGame,
    showRangeAttack,
    tableCategory,
    setTableCategory,
    tournamentCategory,
    setTournamentCategory,
    applyPreset,
    applyLlmVsLlm,
    isLimited,
    isDraftLimited,
    isTournament,
    isConstructedTournament,
    compatibilityError,
    validateStep,
    submit,
    runDemoTable,
    cancel,
    resetToDefaults,
  }
}
