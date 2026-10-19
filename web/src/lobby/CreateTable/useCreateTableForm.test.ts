import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import * as cmds from '../../net/commands'
import { requestDeckValidation } from '../DeckIssuesDialog'
import { ADVANCED_DECK, DEFAULT_DECK, PRESET_DEFAULT_DECK_NAME, deckRef, type Deck } from '../decks'
import { setBundledCorpusForTests } from '../../decks/bundledDecks'
import { useCreateTableForm } from './useCreateTableForm'
import { defaultLlmConfig } from './llmConfig'
import { STORAGE_KEY } from './constants'
import { setState } from '../../state/state'
import type { Capabilities } from '../../state/slices/session'

vi.mock('../../net/commands', () => ({
  getGameTypes: vi.fn(),
  getDeckTypes: vi.fn(),
  getPlayerTypes: vi.fn(),
  getTournamentTypes: vi.fn(),
  getDraftCubes: vi.fn(),
  getExpansionsWithBoosters: vi.fn(),
  getP1Decks: vi.fn(),
  createTable: vi.fn(),
  createTournamentTable: vi.fn(),
  joinTable: vi.fn(),
  joinTournamentTable: vi.fn(),
  startMatch: vi.fn(),
  watchTable: vi.fn(),
  removeTable: vi.fn(),
}))

// The real issues dialog waits for the user; here it resolves at once.
vi.mock('../DeckIssuesDialog', () => ({ requestDeckValidation: vi.fn() }))

const ls = new Map<string, string>()

beforeEach(() => {
  ls.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => ls.get(k) ?? null,
    setItem: (k: string, v: string) => { ls.set(k, v) },
    removeItem: (k: string) => { ls.delete(k) },
  })
  vi.mocked(cmds.getGameTypes).mockReset().mockResolvedValue([
    { name: 'Two Player Duel', minPlayers: 2, maxPlayers: 2 },
    { name: 'Free For All', minPlayers: 3, maxPlayers: 10 },
    { name: 'Commander Free For All', minPlayers: 3, maxPlayers: 10 },
  ])
  vi.mocked(cmds.getDeckTypes).mockReset().mockResolvedValue(['Constructed - Modern', 'Variant Magic - Commander', 'Limited'])
  vi.mocked(cmds.getPlayerTypes).mockReset().mockResolvedValue(['COMPUTER_MAD', 'COMPUTER_DRAFT_BOT'])
  vi.mocked(cmds.getTournamentTypes).mockReset().mockResolvedValue(['Constructed Swiss', 'Constructed Elimination', 'Booster Draft Elimination'])
  vi.mocked(cmds.getDraftCubes).mockReset().mockResolvedValue([])
  vi.mocked(cmds.getExpansionsWithBoosters).mockReset().mockResolvedValue([])
  vi.mocked(cmds.getP1Decks).mockReset().mockResolvedValue({ decks: [], default: '', ok: true })
  vi.mocked(cmds.createTable).mockReset().mockResolvedValue({ ok: true, data: { tableId: 'tbl' } } as any)
  vi.mocked(cmds.createTournamentTable).mockReset().mockResolvedValue({ ok: true, data: { tableId: 'tour' } } as any)
  vi.mocked(cmds.joinTable).mockReset().mockResolvedValue({ ok: true } as any)
  vi.mocked(cmds.joinTournamentTable).mockReset().mockResolvedValue({ ok: true } as any)
  vi.mocked(cmds.startMatch).mockReset().mockResolvedValue({ ok: true } as any)
  vi.mocked(cmds.watchTable).mockReset().mockResolvedValue({ ok: true } as any)
  vi.mocked(cmds.removeTable).mockReset().mockResolvedValue({ ok: true } as any)
  vi.mocked(requestDeckValidation).mockReset().mockImplementation(async (deck) => deck)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  setState({ capabilities: null } as never)
})

const LLM_CAPS: Capabilities = {
  llm: true, p1: false, replayScrubber: false, replaySidecar: false,
  serverVersion: '1.4.62-V1', playerTypes: ['HUMAN', 'SIM', 'COMPUTER_LLM'],
}

async function mount() {
  const onClose = vi.fn()
  const hook = renderHook(() => useCreateTableForm(onClose))
  await waitFor(() => expect(cmds.getTournamentTypes).toHaveBeenCalled())
  await act(async () => {})
  return { ...hook, onClose, form: () => hook.result.current }
}

/** Constructed tournament with N native AI seats (COMPUTER_MAD) besides the human. */
async function constructedTourneyWithBots(bots: number) {
  const m = await mount()
  act(() => m.form().setTableCategory('tourney'))
  act(() => m.form().setTournamentCategory('constructed'))
  act(() => m.form().setNumPlayers(bots + 1))
  act(() => m.form().applySeatTypeToAll('COMPUTER_MAD'))
  expect(m.form().isConstructedTournament).toBe(true)
  expect(m.form().seatConfigs.map((s) => s.type)).toEqual(Array(bots).fill('COMPUTER_MAD'))
  return m
}

describe('table category', () => {
  it('multiplayer picks a game type for more than 2 and keeps a compatible format', async () => {
    const m = await mount()
    act(() => m.form().setTableCategory('multi'))
    expect(m.form().gameType).toBe('Free For All')
    expect(m.form().deckType).toBe('Constructed - Modern')
    expect(m.form().numPlayers).toBe(4)

    act(() => m.form().setTableCategory('duel'))
    expect(m.form().gameType).toBe('Two Player Duel')
    expect(m.form().numPlayers).toBe(2)
  })

  it('a constructed tournament leaves Limited and uses a constructed tournament type', async () => {
    const m = await mount()
    act(() => m.form().setTableCategory('tourney'))
    act(() => m.form().setTournamentCategory('limited'))
    expect(m.form().deckType).toBe('Limited')
    expect(m.form().useDraftTournament).toBe(true)

    act(() => m.form().setTournamentCategory('constructed'))
    expect(m.form().deckType).toBe('Constructed - Modern')
    expect(m.form().useDraftTournament).toBe(false)
    expect(m.form().tournamentType).toBe('Constructed Swiss')
  })

  it('the draft checkbox inside a tournament switches the subcategory', async () => {
    const m = await mount()
    act(() => m.form().setTableCategory('tourney'))
    act(() => m.form().setUseDraftTournament(false))
    expect(m.form().tournamentCategory).toBe('constructed')
    act(() => m.form().setUseDraftTournament(true))
    expect(m.form().tournamentCategory).toBe('limited')
  })

  it('setSeatSkill clamps the skill to 1-10', async () => {
    const m = await mount()
    act(() => m.form().setNumPlayers(2))
    act(() => m.form().setSeatSkill(0, 42))
    expect(m.form().seatConfigs[0].skill).toBe(10)
    act(() => m.form().setSeatSkill(0, -3))
    expect(m.form().seatConfigs[0].skill).toBe(1)
  })
})

describe('submit: constructed tournament with native AI', () => {
  it('joins every bot with a checked deck and then the human', async () => {
    const m = await constructedTourneyWithBots(2)
    await act(() => m.form().submit())

    expect(cmds.createTournamentTable).toHaveBeenCalledOnce()
    const joins = vi.mocked(cmds.joinTournamentTable).mock.calls.map(([a]) => a)
    expect(joins.map((a) => [a.playerName, a.playerType])).toEqual([
      ['Computer 1', 'COMPUTER_MAD'],
      ['Computer 2', 'COMPUTER_MAD'],
      ['player', 'HUMAN'],
    ])
    for (const a of joins) {
      expect(a).toMatchObject({ tableId: 'tour', deckType: 'Constructed - Modern' })
      expect(a.deck).toBeDefined()
    }
    // human + one deck per bot
    expect(requestDeckValidation).toHaveBeenCalledTimes(3)
    expect(m.onClose).toHaveBeenCalled()
    expect(cmds.removeTable).not.toHaveBeenCalled()
  })

  it('a single bot is called "Computer"', async () => {
    const m = await constructedTourneyWithBots(1)
    await act(() => m.form().submit())
    expect(vi.mocked(cmds.joinTournamentTable).mock.calls[0][0].playerName).toBe('Computer')
  })

  it('if a bot cannot join, the just-created table is removed', async () => {
    const m = await constructedTourneyWithBots(2)
    vi.mocked(cmds.joinTournamentTable).mockResolvedValueOnce({ ok: false, error: 'boom' } as any)
    await act(() => m.form().submit())

    expect(cmds.removeTable).toHaveBeenCalledWith('tour')
    expect(cmds.joinTournamentTable).toHaveBeenCalledOnce()
    expect(m.form().error).toBeTruthy()
    expect(m.onClose).not.toHaveBeenCalled()
  })

  it('cancelling the deck check of a bot removes the table', async () => {
    const m = await constructedTourneyWithBots(1)
    vi.mocked(requestDeckValidation)
      .mockImplementationOnce(async (deck) => deck) // human
      .mockResolvedValueOnce(null) // bot
    await act(() => m.form().submit())

    expect(cmds.removeTable).toHaveBeenCalledWith('tour')
    expect(cmds.joinTournamentTable).not.toHaveBeenCalled()
    expect(m.onClose).not.toHaveBeenCalled()
  })

  it('if the human cannot join, the table is removed', async () => {
    const m = await constructedTourneyWithBots(1)
    vi.mocked(cmds.joinTournamentTable)
      .mockResolvedValueOnce({ ok: true } as any)
      .mockResolvedValueOnce({ ok: false, error: 'boom' } as any)
    await act(() => m.form().submit())

    expect(cmds.removeTable).toHaveBeenCalledWith('tour')
    expect(m.onClose).not.toHaveBeenCalled()
  })

  it('cancelling the human deck check creates nothing', async () => {
    const m = await constructedTourneyWithBots(1)
    vi.mocked(requestDeckValidation).mockResolvedValueOnce(null)
    await act(() => m.form().submit())

    expect(cmds.createTournamentTable).not.toHaveBeenCalled()
    expect(m.form().busy).toBe(false)
  })

  it('shows the error when the server rejects the tournament', async () => {
    const m = await constructedTourneyWithBots(1)
    vi.mocked(cmds.createTournamentTable).mockResolvedValueOnce({ ok: false, error: 'nope' } as any)
    await act(() => m.form().submit())

    expect(m.form().error).toBe('nope')
    expect(cmds.joinTournamentTable).not.toHaveBeenCalled()
    expect(m.onClose).not.toHaveBeenCalled()
  })
})

describe('submit: match with native AI', () => {
  async function duelVsBot() {
    const m = await mount()
    act(() => m.form().setNumPlayers(2))
    act(() => m.form().applySeatTypeToAll('COMPUTER_MAD'))
    return m
  }

  it('creates the table and joins the bot with its checked deck', async () => {
    const m = await duelVsBot()
    await act(() => m.form().submit())

    expect(cmds.createTable).toHaveBeenCalledOnce()
    expect(cmds.joinTable).toHaveBeenCalledWith(expect.objectContaining({ tableId: 'tbl', playerName: 'Computer', playerType: 'COMPUTER_MAD' }))
    expect(m.onClose).toHaveBeenCalled()
  })

  it('cancelling the bot deck check does not create the table', async () => {
    const m = await duelVsBot()
    vi.mocked(requestDeckValidation)
      .mockImplementationOnce(async (deck) => deck)
      .mockResolvedValueOnce(null)
    await act(() => m.form().submit())

    expect(cmds.createTable).not.toHaveBeenCalled()
    expect(m.form().busy).toBe(false)
  })

  it('shows the error when the server rejects the table', async () => {
    const m = await duelVsBot()
    vi.mocked(cmds.createTable).mockResolvedValueOnce({ ok: false, error: 'nope' } as any)
    await act(() => m.form().submit())
    expect(m.form().error).toBe('nope')
    expect(cmds.joinTable).not.toHaveBeenCalled()
  })
})

describe('runDemoTable', () => {
  // The demo now seats the curated REAL bundled corpus deck (Boros Burn):
  // every create-side test seeds it through the corpus test seam (the real
  // picker awaits the lazy asset; the unit tests inject it).
  const burn: Deck = {
    id: 'majors:Modern/16525_Grand_Prix_Birmingham_2017/1__Boros_Burn_by_loic_le_briand.txt',
    name: PRESET_DEFAULT_DECK_NAME,
    cards: [{ cardName: 'Lightning Bolt', setCode: '', cardNumber: '', amount: 4 }],
    sideboard: [],
  }

  it('creates a SIM vs SIM table, starts it and watches it', async () => {
    setBundledCorpusForTests([burn])
    const m = await mount()
    await act(() => m.form().runDemoTable())

    expect(cmds.createTable).toHaveBeenCalledWith(expect.objectContaining({ playerTypes: ['SIM', 'SIM'], winsNeeded: 1 }))
    expect(cmds.startMatch).toHaveBeenCalledWith('tbl')
    expect(cmds.watchTable).toHaveBeenCalledWith('tbl')
    expect(m.onClose).toHaveBeenCalled()
    expect(m.form().busy).toBe(false)
  })

  it('seats the bundled REAL preset deck (never the e2e lands deck) into both SIM seats', async () => {
    setBundledCorpusForTests([burn])
    const m = await mount()
    await act(() => m.form().runDemoTable())

    const sent = vi.mocked(cmds.createTable).mock.calls.at(-1)![0]
    for (const deck of [sent.simDecks![0], sent.simDecks![1]]) {
      // identity through the corpus transform: the same deck object, real cards
      expect(deck.name).toBe(PRESET_DEFAULT_DECK_NAME)
      expect(deck.name).not.toBe(DEFAULT_DECK.name)
    }
  })

  it('fails fast when the preset deck is not in the (loaded) corpus: no table, the error is surfaced', async () => {
    const m = await mount()
    await act(() => m.form().runDemoTable())
    expect(cmds.createTable).not.toHaveBeenCalled()
    expect(m.form().busy).toBe(false)
    expect(m.form().error).toContain('Boros Burn')
    expect(m.onClose).not.toHaveBeenCalled()
  })

  it('accepts a capitalized TableId and does not watch if it fails to start', async () => {
    setBundledCorpusForTests([burn])
    vi.mocked(cmds.createTable).mockResolvedValueOnce({ ok: true, data: { TableId: 'T2' } } as any)
    vi.mocked(cmds.startMatch).mockResolvedValueOnce({ ok: false } as any)
    const m = await mount()
    await act(() => m.form().runDemoTable())

    expect(cmds.startMatch).toHaveBeenCalledWith('T2')
    expect(cmds.watchTable).not.toHaveBeenCalled()
    expect(m.onClose).toHaveBeenCalled()
  })

  it('keeps the dialog open if the table cannot be created', async () => {
    setBundledCorpusForTests([burn])
    vi.mocked(cmds.createTable).mockResolvedValueOnce({ ok: false } as any)
    const m = await mount()
    await act(() => m.form().runDemoTable())

    expect(cmds.startMatch).not.toHaveBeenCalled()
    expect(m.onClose).not.toHaveBeenCalled()
    expect(m.form().busy).toBe(false)
  })
})

describe('LLM seats — capabilities gate + config plumbing', () => {
  it('COMPUTER_LLM is listed in playerTypes only when capabilities.llm is true', async () => {
    vi.mocked(cmds.getPlayerTypes).mockResolvedValue(['COMPUTER_MAD', 'COMPUTER_LLM'])
    const withoutCaps = await mount()
    expect(withoutCaps.form().llmEnabled).toBe(false)
    expect(withoutCaps.form().playerTypes).toEqual(['COMPUTER_MAD'])
    cleanup()

    setState({ capabilities: LLM_CAPS } as never)
    const m = await mount()
    expect(m.form().llmEnabled).toBe(true)
    expect(m.form().playerTypes).toContain('COMPUTER_LLM')
  })

  it('switching a seat to COMPUTER_LLM materialises the default config; away drops it', async () => {
    setState({ capabilities: LLM_CAPS } as never)
    const m = await mount()
    act(() => m.form().setNumPlayers(2))
    act(() => m.form().setSeatType(0, 'COMPUTER_LLM'))
    const cfg = m.form().seatConfigs[0].llmConfig
    expect(cfg).toBeDefined()
    expect(cfg?.model).toBe('')
    expect(cfg?.thinkingEnabled).toBe(true)
    // Derived, not a magic count: the schema's own field list is the contract
    // (`llmConfig.test.ts` pins its exact contents once).
    expect(Object.keys(cfg ?? {})).toEqual(Object.keys(defaultLlmConfig()))

    act(() => m.form().setSeatType(0, 'SIM'))
    expect(m.form().seatConfigs[0].llmConfig).toBeUndefined()
  })

  it('setSeatLlmConfig replaces the seat config (and survives on the seat)', async () => {
    setState({ capabilities: LLM_CAPS } as never)
    const m = await mount()
    act(() => m.form().setNumPlayers(2))
    act(() => m.form().setSeatType(0, 'COMPUTER_LLM'))
    act(() => m.form().setSeatLlmConfig(0, { model: 'z-ai/glm-4.5', thinkingEnabled: false }))
    expect(m.form().seatConfigs[0].llmConfig).toEqual({ model: 'z-ai/glm-4.5', thinkingEnabled: false })
  })

  it('a seat stuck on COMPUTER_LLM without the capability degrades to SIM', async () => {
    vi.mocked(cmds.getPlayerTypes).mockResolvedValue(['COMPUTER_MAD', 'COMPUTER_LLM'])
    const m = await mount()
    act(() => m.form().setNumPlayers(2))
    // force the seat type past the UI filter (as a stale persisted state would)
    act(() => m.form().setSeatConfigs((prev) => prev.map((s) => ({ ...s, type: 'COMPUTER_LLM' }))))
    await waitFor(() => {
      expect(m.form().seatConfigs.every((s) => s.type !== 'COMPUTER_LLM')).toBe(true)
    })
  })

  it('submit carries llmConfigs aligned with the LLM seats (match path)', async () => {
    setState({ capabilities: LLM_CAPS } as never)
    const m = await mount()
    act(() => m.form().setGameType('Free For All'))
    act(() => m.form().setNumPlayers(3))
    act(() => m.form().setSeatType(0, 'COMPUTER_LLM'))
    act(() => m.form().setSeatLlmConfig(0, { model: 'first' }))
    act(() => m.form().setSeatType(1, 'COMPUTER_LLM'))
    act(() => m.form().setSeatLlmConfig(1, { model: 'second' }))
    await act(() => m.form().submit())

    const sent = vi.mocked(cmds.createTable).mock.calls[0][0]
    expect(sent.playerTypes).toEqual(['HUMAN', 'COMPUTER_LLM', 'COMPUTER_LLM'])
    expect(sent.llmConfigs).toEqual([{ model: 'first' }, { model: 'second' }])
    // the LLM seat still joins (the server instantiates the player on join)
    expect(vi.mocked(cmds.joinTable).mock.calls.map(([a]) => a.playerType)).toEqual(['COMPUTER_LLM', 'COMPUTER_LLM', 'HUMAN'])
  })

  it('submit omits llmConfigs entirely when there is no LLM seat', async () => {
    const m = await mount()
    act(() => m.form().setNumPlayers(2))
    await act(() => m.form().submit())
    expect(vi.mocked(cmds.createTable).mock.calls[0][0]).not.toHaveProperty('llmConfigs')
  })

  it('strips the apiKey from what is persisted to localStorage', async () => {
    setState({ capabilities: LLM_CAPS } as never)
    const m = await mount()
    act(() => m.form().setNumPlayers(2))
    act(() => m.form().setSeatType(0, 'COMPUTER_LLM'))
    act(() => m.form().setSeatLlmConfig(0, { model: 'm', apiKey: 'XXXXXX-not-a-real-key' }))
    await waitFor(() => {
      const raw = ls.get(STORAGE_KEY)
      expect(raw).toBeDefined()
      expect(raw).not.toContain('XXXXXX-not-a-real-key')
      expect(raw).not.toContain('apiKey')
    })
    // the in-memory state keeps it (submit converts it to a clientKeyTag)
    expect(m.form().seatConfigs[0].llmConfig?.apiKey).toBe('XXXXXX-not-a-real-key')
  })
})

describe('preset stale tournament state', () => {
  const SWISS_DUEL_SHAPE = {
    gameType: 'Two Player Duel',
    deckType: 'Constructed - Modern',
    numPlayers: 2,
  }

  it('applyPreset(swiss) then applyPreset(bo3): the tournament shape is fully reset — table kind is a match', async () => {
    const m = await mount()
    act(() => m.form().applyPreset('modern_swiss_8p'))
    expect(m.form().tableCategory).toBe('tourney')
    expect(m.form().tournamentCategory).toBe('constructed')
    expect(m.form().isConstructedTournament).toBe(true)
    expect(m.form().isTournament).toBe(true)
    expect(m.form().tournamentType).toBe('Constructed Swiss')

    act(() => m.form().setWins(1)) // Bo1: Modern Bo3's shape minus the wins chip
    act(() => m.form().applyPreset('modern_bo3'))
    expect(m.form().isTournament).toBe(false)
    expect(m.form().isConstructedTournament).toBe(false)
    expect(m.form().tournamentType).toBe('')
    for (const [k, v] of Object.entries(SWISS_DUEL_SHAPE)) {
      expect(m.form()[k as 'gameType' | 'deckType' | 'numPlayers']).toBe(v)
    }
  })

  it('preset reset also restores the human seat + SIM shortcut a tournament run had reconfigured', async () => {
    const m = await mount()
    act(() => m.form().applyPreset('modern_swiss_8p'))
    act(() => m.form().setNumPlayers(2))
    act(() => m.form().setSeatType(0, 'COMPUTER_MAD'))
    expect(m.form().seatConfigs).toHaveLength(1)

    act(() => m.form().applyPreset('modern_bo3'))
    expect(m.form().isTournament).toBe(false)
    expect(m.form().humanSeat).toBe(true)
    expect(m.form().playerTypesSel).toEqual(['SIM'])
  })

  it('manual mode-card revert: swiss → duel mode → submit produces a DUEL table (createTable, no tournament)', async () => {
    const m = await mount()
    act(() => m.form().applyPreset('modern_swiss_8p'))
    expect(m.form().isTournament).toBe(true)
    act(() => m.form().setTableCategory('duel')) // the mode card, i.e. applyMode('duel')
    expect(m.form().isTournament).toBe(false)
    expect(m.form().isConstructedTournament).toBe(false)
    expect(m.form().tournamentType).toBe('')

    await act(() => m.form().submit())
    expect(cmds.createTournamentTable).not.toHaveBeenCalled()
    expect(cmds.createTable).toHaveBeenCalledTimes(1)
    const sent = vi.mocked(cmds.createTable).mock.calls[0][0]
    expect(sent.playerTypes).toEqual(['HUMAN', 'SIM'])
    expect(sent.gameType).toBe('Two Player Duel')
    // the submitted table kind follows the CURRENT form — the swiss preset's
    // own Bo3 wins (req 1: the current shape wins), only the tournament state
    // must be gone
    expect(sent.winsNeeded).toBe(2)
    expect(m.onClose).toHaveBeenCalled()

    // and the same revert without any preset-derived wins keeps Bo1 (the mode
    // card never touches wins): the CTA cannot resurrect the tournament
    act(() => m.form().setWins(1))
    expect(m.form().isTournament).toBe(false)
  })

  it('manual sub-tab revert inside tournament mode keeps the tournament state (constructed ↔ limited)', async () => {
    const m = await mount()
    act(() => m.form().applyPreset('modern_swiss_8p'))
    act(() => m.form().setTournamentCategory('limited'))
    expect(m.form().isTournament).toBe(true)
    expect(m.form().isDraftLimited).toBe(true)
    expect(m.form().tournamentType).toBe('Booster Draft Elimination')
    act(() => m.form().setTournamentCategory('constructed'))
    expect(m.form().isTournament).toBe(true)
    expect(m.form().isConstructedTournament).toBe(true)
    expect(m.form().tournamentType).toBe('Constructed Swiss')
  })

  it('preset chips round-trip: swiss → commander → swiss keeps each complete shape', async () => {
    const m = await mount()
    act(() => m.form().applyPreset('modern_swiss_8p'))
    act(() => m.form().applyPreset('commander_4p'))
    expect(m.form().isTournament).toBe(false)
    expect(m.form().tournamentType).toBe('')
    expect(m.form().gameType).toBe('Commander Free For All')

    act(() => m.form().applyPreset('modern_swiss_8p'))
    expect(m.form().isTournament).toBe(true)
    expect(m.form().isConstructedTournament).toBe(true)
    expect(m.form().gameType).toBe('Two Player Duel')
    expect(m.form().deckType).toBe('Constructed - Modern')
    expect(m.form().numPlayers).toBe(8)
    expect(m.form().wins).toBe(2)
  })

  it('draft preset after swiss: the tournament shape is rebuilt as draft, not inherited', async () => {
    const m = await mount()
    act(() => m.form().applyPreset('modern_swiss_8p'))
    act(() => m.form().applyPreset('draft_8p'))
    expect(m.form().isTournament).toBe(true)
    expect(m.form().isDraftLimited).toBe(true)
    expect(m.form().isConstructedTournament).toBe(false)
    expect(m.form().deckType).toBe('Limited')
    expect(m.form().draftSetsRaw).toBe('MH3, MH3, MH3')
  })

  it('reopen with a persisted duel + stale tournament shape restores a PLAIN duel (match kind, no chip)', async () => {
    // The persisted payload never stores `tournamentType`, so any tournament
    // type on reopen comes from the mount-time keeper — not from saved state.
    // Reopening a duel form must resolve to a plain match: no gold chip, no
    // tournament CTA, submit creates a DUEL table. (Matched by hand: the
    // keeper's type-string value is not observable, only the kind is.)
    vi.mocked(cmds.getGameTypes).mockResolvedValue([
      { name: 'Free For All', minPlayers: 3, maxPlayers: 10 },
      { name: 'Commander Free For All', minPlayers: 3, maxPlayers: 10 },
    ])
    ls.set(
      STORAGE_KEY,
      JSON.stringify({ tableCategory: 'duel', gameType: 'Two Player Duel', deckType: 'Constructed - Modern', tournamentType: 'Constructed Swiss' }),
    )

    const m = await mount()
    await waitFor(() => {
      expect(m.form().isTournament).toBe(false)
      expect(m.form().isConstructedTournament).toBe(false)
    })
    // the gameType select itself stays on the server's list (the mount-time
    // revalidation is pre-existing base behavior, out of this unit's scope);
    // req 1 is about the KIND: the stale tournament shape must not survive
    await act(() => m.form().submit())
    expect(cmds.createTournamentTable).not.toHaveBeenCalled()
    expect(cmds.createTable).toHaveBeenCalledOnce()
  })
})

describe('LLM vs LLM all-bot preset (discoverability fix)', () => {
  it('applyLlmVsLlm sets spectator mode + both seats to COMPUTER_LLM with the default config', async () => {
    setState({ capabilities: LLM_CAPS } as never)
    const m = await mount()
    act(() => m.form().setNumPlayers(2))
    // start from the gated default: human seat, SIM bot
    expect(m.form().humanSeat).toBe(true)

    act(() => m.form().applyLlmVsLlm())

    expect(m.form().humanSeat).toBe(false)
    expect(m.form().numPlayers).toBe(2)
    expect(m.form().seatConfigs.map((s) => s.type)).toEqual(['COMPUTER_LLM', 'COMPUTER_LLM'])
    for (const s of m.form().seatConfigs) {
      expect(s.llmConfig).toBeDefined()
      expect(s.llmConfig?.thinkingEnabled).toBe(true)
      expect(Object.keys(s.llmConfig ?? {})).toEqual(Object.keys(defaultLlmConfig()))
    }
  })

  it('the preset submit carries playerTypes [COMPUTER_LLM,COMPUTER_LLM] and one llmConfig per LLM seat', async () => {
    setState({ capabilities: LLM_CAPS } as never)
    const m = await mount()
    act(() => m.form().setNumPlayers(2))
    act(() => m.form().applyLlmVsLlm())
    await act(() => m.form().submit())

    expect(cmds.createTable).toHaveBeenCalledOnce()
    const sent = vi.mocked(cmds.createTable).mock.calls[0][0]
    expect(sent.playerTypes).toEqual(['COMPUTER_LLM', 'COMPUTER_LLM'])
    expect(sent.llmConfigs).toHaveLength(2)
    // both seats join as COMPUTER_LLM (the server instantiates the player on join)
    expect(vi.mocked(cmds.joinTable).mock.calls.map(([a]) => a.playerType)).toEqual(['COMPUTER_LLM', 'COMPUTER_LLM'])
    // no human seat is joined
    expect(vi.mocked(cmds.joinTable).mock.calls.map(([a]) => a.playerName)).not.toContain('player')
    expect(m.onClose).toHaveBeenCalled()
  })

  it('is a no-op without capabilities.llm', async () => {
    const m = await mount()
    expect(m.form().llmEnabled).toBe(false)
    act(() => m.form().setNumPlayers(2))
    const before = m.form().seatConfigs.map((s) => s.type)
    act(() => m.form().applyLlmVsLlm())
    // nothing referenced the LLM seat: seats and humanSeat untouched
    expect(m.form().seatConfigs.map((s) => s.type)).toEqual(before)
    expect(m.form().humanSeat).toBe(true)
  })

  it('STAMPS the preset deck into both seats, overriding the wizard default (the e2e lands deck)', async () => {
    setState({ capabilities: LLM_CAPS } as never)
    // The corpus landed before the wizard opens (the real picker awaits it),
    // BUT the demo/seats default to the 'Mage Web bolt' lands deck through
    // bundledDecks() until the seat choice is stamped by the preset.
    const m = await mount()
    act(() => m.form().setNumPlayers(2))
    act(() => m.form().applyLlmVsLlm())

    const seats = m.form().seatConfigs
    for (const s of seats) {
      expect(s.type).toBe('COMPUTER_LLM')
      expect(s.deckName).toBe(deckRef({ ...DEFAULT_DECK, name: PRESET_DEFAULT_DECK_NAME }))
      expect(s.deckName).not.toBe(deckRef(DEFAULT_DECK))
    }
  })

  it('seats the preset deck ref resolvable by the same form (submit resolves and joins both seats with it)', async () => {
    setState({ capabilities: LLM_CAPS } as never)
    const burn = {
      id: 'majors:Modern/16525_Grand_Prix_Birmingham_2017/1__Boros_Burn_by_loic_le_briand.txt',
      name: PRESET_DEFAULT_DECK_NAME,
      cards: [{ cardName: 'Lightning Bolt', setCode: '', cardNumber: '', amount: 4 }],
      sideboard: [],
    }
    setBundledCorpusForTests([burn])
    const m = await mount()
    act(() => m.form().setNumPlayers(2))
    act(() => m.form().applyLlmVsLlm())

    const expectedRef = deckRef(burn)
    expect(m.form().seatConfigs.map((s) => s.deckName)).toEqual([expectedRef, expectedRef])
    await act(() => m.form().submit())

    const sent = vi.mocked(cmds.createTable).mock.calls.at(-1)![0]
    expect(sent.llmConfigs).toHaveLength(2)
    expect(vi.mocked(cmds.joinTable).mock.calls.map(([a]) => a.deck?.name)).toEqual([PRESET_DEFAULT_DECK_NAME, PRESET_DEFAULT_DECK_NAME])
  })
})

describe('cancel discards the unsubmitted draft (parity 2026-10-10, gap 2 half)', () => {
  it('cancel: the persisted draft is dropped — reopen starts from the defaults, not the tournament preset', async () => {
    const onClose = vi.fn()
    const first = renderHook(() => useCreateTableForm(onClose))
    await waitFor(() => expect(cmds.getTournamentTypes).toHaveBeenCalled())
    await act(async () => {})
    act(() => first.result.current.applyPreset('modern_swiss_8p'))
    expect(first.result.current.isTournament).toBe(true)
    // the draft persistence effect has written the tournament shape
    await waitFor(() => {
      expect(JSON.parse(ls.get(STORAGE_KEY) ?? '{}').tableCategory).toBe('tourney')
    })

    act(() => first.result.current.cancel())
    expect(onClose).toHaveBeenCalledOnce()
    expect(ls.has(STORAGE_KEY)).toBe(false)
    cleanup()

    const second = renderHook(() => useCreateTableForm(vi.fn()))
    await waitFor(() => expect(cmds.getTournamentTypes).toHaveBeenCalled())
    await act(async () => {})
    expect(second.result.current.tableCategory).toBe('duel')
    expect(second.result.current.isTournament).toBe(false)
    expect(second.result.current.isConstructedTournament).toBe(false)
  })

  it('cancel: unsaved edits (name, seats, draft sets) do not survive either — even ones written before the discard', async () => {
    const first = renderHook(() => useCreateTableForm(vi.fn()))
    await waitFor(() => expect(cmds.getTournamentTypes).toHaveBeenCalled())
    await act(async () => {})
    act(() => first.result.current.setName('Half-typed table'))
    act(() => first.result.current.setNumPlayers(4))
    act(() => first.result.current.setDraftSetsRaw('MH3, BLB, DSK'))
    await waitFor(() => expect(ls.get(STORAGE_KEY)).toContain('Half-typed table'))

    act(() => first.result.current.cancel())
    expect(ls.has(STORAGE_KEY)).toBe(false)
    cleanup()

    const second = renderHook(() => useCreateTableForm(vi.fn()))
    await waitFor(() => expect(cmds.getTournamentTypes).toHaveBeenCalled())
    await act(async () => {})
    expect(second.result.current.name).toBe("player's table")
    expect(second.result.current.numPlayers).toBe(2)
    expect(second.result.current.draftSetsRaw).toBe('M21, M21, M21')
  })

  it('control: a submitted tournament flow still persists its draft for reopen (only Cancel discards)', async () => {
    const m = await constructedTourneyWithBots(1)
    await act(() => m.form().submit())
    expect(m.onClose).toHaveBeenCalled()
    expect(JSON.parse(ls.get(STORAGE_KEY) ?? '{}').tableCategory).toBe('tourney')
    expect(cmds.removeTable).not.toHaveBeenCalled()
  })
})

describe('useDeckChoices — default SIM deck is the real preset deck', () => {
  const SWISS_BOTS = 3
  // The curated corpus deck, seeded through the test seam (as the loader builds it).
  const burn: Deck = {
    id: 'majors:Modern/16525_Grand_Prix_Birmingham_2017/1__Boros_Burn_by_loic_le_briand.txt',
    name: PRESET_DEFAULT_DECK_NAME,
    cards: [{ cardName: 'Lightning Bolt', setCode: '', cardNumber: '', amount: 4 }],
    sideboard: [],
  }
  /** The `bundledDecks.generated.json` entry shape for the fetch-stubbed lazy load. */
  const BURN_FILE = {
    generated: '', source: '',
    manifest: { decks: 1, majors: 1, sample: 0, byFormat: { Modern: 1 }, byGroup: { majors: 1 } },
    decks: [{
      id: 'majors:Modern/16525_Grand_Prix_Birmingham_2017/1__Boros_Burn_by_loic_le_briand.txt',
      name: PRESET_DEFAULT_DECK_NAME,
      format: 'Modern', group: 'majors', source: 'majors',
      cards: [[4, 'Lightning Bolt'], [56, 'Mountain']],
      sideboard: [],
    }],
  }
  // The module-level store keeps the last test's ACTIVE_DECK ('mage-web-active-deck'
  // survives the per-test localStorage stub switch): an unset wizard default would
  // ride it into MY deck's init. These tests pin MY deck to the bare default.
  beforeEach(() => { setState({ myDeck: null } as never) })
  afterEach(() => { setState({ myDeck: null } as never) })

  it('applyPreset(swiss): fresh SIM bots seat the corpus preset deck, never the e2e lands deck', async () => {
    // Corpus up before the wizard opens (the real picker awaits it before paint).
    setBundledCorpusForTests([burn])
    const m = await mount()
    expect(m.form().simDeck?.name).toBe(PRESET_DEFAULT_DECK_NAME)
    expect(m.form().simDeck?.name).not.toBe(DEFAULT_DECK.name)
    act(() => m.form().applyPreset('modern_swiss_8p'))
    act(() => m.form().setNumPlayers(SWISS_BOTS + 1))
    expect(m.form().seatConfigs.map((s) => s.deckName)).toEqual([...Array(SWISS_BOTS)].map(() => deckRef(burn)))
    await act(() => m.form().submit())
    const sent = vi.mocked(cmds.createTournamentTable).mock.calls[0][0]
    expect(sent.playerTypes).toEqual(['HUMAN', 'SIM', 'SIM', 'SIM'])
    // tournament seats join with their deck (the args carry no simDecks)
    const joins = vi.mocked(cmds.joinTournamentTable).mock.calls.map(([a]) => a)
    for (const j of joins.filter((a) => a.playerType === 'SIM')) {
      expect(j.deck?.name).toBe(PRESET_DEFAULT_DECK_NAME)
      expect(j.deck?.name).not.toBe(DEFAULT_DECK.name)
    }
  })

  it('wizard opened before the corpus landed: the default re-derives to the preset when it arrives', async () => {
    // The lazy corpus asset answers AFTER the wizard's first paint (the parked
    // fetch below): the default rested on the bundled list head — it must be
    // re-derived once the corpus lands (untouched default), so the submit-able
    // global deck is never the e2e lands deck.
    let open: (file: unknown) => void = () => {}
    vi.stubGlobal('fetch', vi.fn(() => new Promise((res) => { open = (file) => res({ ok: true, json: async () => file }) })))
    const m = await mount()
    expect(m.form().simDeck?.name).toBe(DEFAULT_DECK.name) // pre-corpus fallback

    await act(async () => { open(BURN_FILE) })
    await waitFor(() => {
      expect(m.form().simDeck?.name).toBe(PRESET_DEFAULT_DECK_NAME)
      expect(m.form().simDeck?.name).not.toBe(DEFAULT_DECK.name)
    })

    // and the untouched default flows into freshly filled seats + the join
    // payloads (seats are wiped first: the ones filled at wizard-open time —
    // before the corpus landed — carry the pre-corpus stamp, which the
    // seat-fill effect deliberately never rewrites; multiplayer game so 3
    // players survive the clamp)
    act(() => m.form().setSeatConfigs(() => []))
    act(() => {
      m.form().setGameType('Free For All')
      m.form().setNumPlayers(3)
    })
    expect(m.form().seatConfigs.map((s) => s.deckName)).toEqual([deckRef(burn), deckRef(burn)])
    await act(() => m.form().submit())
    // a plain match: the SIM decks ride the createTable args, the human joins after
    const sent = vi.mocked(cmds.createTable).mock.calls.at(-1)![0]
    expect(sent.playerTypes).toEqual(['HUMAN', 'SIM', 'SIM'])
    for (const deck of sent.simDecks as Array<{ name: string }>) {
      expect(deck.name).toBe(PRESET_DEFAULT_DECK_NAME)
      expect(deck.name).not.toBe(DEFAULT_DECK.name)
    }
  })

  it('user picked a sim deck before the corpus landed: the choice is kept when the corpus arrives', async () => {
    let open: (file: unknown) => void = () => {}
    vi.stubGlobal('fetch', vi.fn(() => new Promise((res) => { open = (file) => res({ ok: true, json: async () => file }) })))
    const m = await mount()
    expect(m.form().simDeck?.name).toBe(DEFAULT_DECK.name)

    act(() => m.form().selectGlobalSimDeck(deckRef(ADVANCED_DECK)))
    expect(m.form().simDeck?.name).toBe(ADVANCED_DECK.name)

    await act(async () => { open(BURN_FILE) })
    await waitFor(() => {
      expect(m.form().availableDecks.some((d) => d.name === PRESET_DEFAULT_DECK_NAME)).toBe(true)
    })
    expect(m.form().simDeck?.name).toBe(ADVANCED_DECK.name) // the user's choice survived
  })
})

describe('COMPUTER_P1 training-deck picker — capabilities gate + deck plumbing', () => {
  const P1_CAPS: Capabilities = {
    llm: false, p1: true, replayScrubber: false, replaySidecar: false,
    serverVersion: '1.4.62-V1', playerTypes: ['HUMAN', 'SIM', 'COMPUTER_P1'],
  }
  const P1_POOL = {
    decks: [
      { name: 'Izzet Spellementals', deck: '4 Lightning Bolt\n24 Island\n' },
      { name: 'Mono Red Aggro', deck: '4 Monastery Swiftspear\n' },
    ],
    default: 'Izzet Spellementals',
    ok: true,
  }

  it('COMPUTER_P1 is appended to playerTypes only when capabilities.p1 is true', async () => {
    const without = await mount()
    expect(without.form().p1Enabled).toBe(false)
    expect(without.form().playerTypes).not.toContain('COMPUTER_P1')
    // the pool is never fetched without the capability
    expect(cmds.getP1Decks).not.toHaveBeenCalled()
    cleanup()

    setState({ capabilities: P1_CAPS } as never)
    const m = await mount()
    expect(m.form().p1Enabled).toBe(true)
    expect(m.form().playerTypes).toContain('COMPUTER_P1')
  })

  it('fetches the P1 pool ONCE per form open and holds it in the form state', async () => {
    vi.mocked(cmds.getP1Decks).mockResolvedValue(P1_POOL)
    setState({ capabilities: P1_CAPS } as never)
    const m = await mount()
    await waitFor(() => expect(m.form().p1Decks).toHaveLength(2))
    expect(m.form().p1Default).toBe('Izzet Spellementals')
    // re-renders (numPlayers etc.) must not re-fetch: it is a once-per-open read
    act(() => m.form().setNumPlayers(2))
    act(() => m.form().setName('x'))
    expect(cmds.getP1Decks).toHaveBeenCalledTimes(1)
  })

  it('switching a seat to COMPUTER_P1 materializes the default training deck TEXT', async () => {
    vi.mocked(cmds.getP1Decks).mockResolvedValue(P1_POOL)
    setState({ capabilities: P1_CAPS } as never)
    const m = await mount()
    await waitFor(() => expect(m.form().p1Decks).toHaveLength(2))
    act(() => m.form().setNumPlayers(2))
    act(() => m.form().setSeatType(0, 'COMPUTER_P1'))
    expect(m.form().seatConfigs[0].type).toBe('COMPUTER_P1')
    expect(m.form().seatConfigs[0].deckName).toBe('4 Lightning Bolt\n24 Island\n')

    // switching away clears the training text (falls back to the saved-deck path)
    act(() => m.form().setSeatType(0, 'SIM'))
    expect(m.form().seatConfigs[0].type).toBe('SIM')
    expect(m.form().seatConfigs[0].deckName).toBe('')
  })

  it('a P1 seat cannot join a server without the capability (degrades to SIM)', async () => {
    const m = await mount()
    act(() => m.form().setNumPlayers(2))
    // force the seat type past the UI filter (as a stale persisted state would)
    act(() => m.form().setSeatConfigs((prev) => prev.map((s) => ({ ...s, type: 'COMPUTER_P1', deckName: '4 x\n' }))))
    await waitFor(() => {
      expect(m.form().seatConfigs.every((s) => s.type !== 'COMPUTER_P1')).toBe(true)
    })
  })

  it('submit joins a COMPUTER_P1 seat with its training deck parsed from the seat text', async () => {
    vi.mocked(cmds.getP1Decks).mockResolvedValue(P1_POOL)
    setState({ capabilities: P1_CAPS } as never)
    const m = await mount()
    await waitFor(() => expect(m.form().p1Decks).toHaveLength(2))
    act(() => m.form().setNumPlayers(2))
    act(() => m.form().setSeatType(0, 'COMPUTER_P1'))
    await act(() => m.form().submit())

    expect(cmds.createTable).toHaveBeenCalledOnce()
    expect(vi.mocked(cmds.createTable).mock.calls[0][0].playerTypes).toEqual(['HUMAN', 'COMPUTER_P1'])
    const botJoin = vi.mocked(cmds.joinTable).mock.calls[0][0]
    expect(botJoin.playerType).toBe('COMPUTER_P1')
    expect(botJoin.deck?.cards.map((c) => c.cardName)).toContain('Lightning Bolt')
    expect(botJoin.deck?.cards.map((c) => c.cardName)).toContain('Island')
    // the P1 seat skips the format-fix dialog (it could break pool membership):
    // only the human deck is validated
    expect(requestDeckValidation).toHaveBeenCalledTimes(1)
  })

  it('surfaces a REFUSED pool (ok:false) as p1PoolStatus error and recovers it on retry', async () => {
    vi.mocked(cmds.getP1Decks).mockResolvedValueOnce({ decks: [], default: '', ok: false, errorCode: 'CAPABILITY_UNAVAILABLE' })
    setState({ capabilities: P1_CAPS } as never)
    const m = await mount()
    await waitFor(() => expect(m.form().p1PoolStatus).toBe('error'))
    expect(m.form().p1Decks).toHaveLength(0)

    // user hits Retry in the picker → the fetch re-runs and the pool arrives
    vi.mocked(cmds.getP1Decks).mockResolvedValueOnce(P1_POOL)
    act(() => m.form().reloadP1Decks())
    await waitFor(() => expect(m.form().p1PoolStatus).toBe('ready'))
    expect(m.form().p1Decks).toHaveLength(2)
    expect(cmds.getP1Decks).toHaveBeenCalledTimes(2)
  })

  it('an ok answer carrying no decks is ready+empty, not an error', async () => {
    vi.mocked(cmds.getP1Decks).mockResolvedValueOnce({ decks: [], default: '', ok: true })
    setState({ capabilities: P1_CAPS } as never)
    const m = await mount()
    await waitFor(() => expect(m.form().p1PoolStatus).toBe('ready'))
    expect(m.form().p1Decks).toHaveLength(0)
  })
})
