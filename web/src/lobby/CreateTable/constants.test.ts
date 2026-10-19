import { describe, expect, it } from 'vitest'
import {
  aiSeatTypes,
  DEFAULT_DRAFT_TOURNAMENT_TYPE,
  defaultTournamentType,
  getEffectiveMaxPlayers,
  isHumanSeatType,
  isLlmSeatType,
  isNativeAiSeatType,
  isSimSeatType,
  normalizeSeatType,
  normalizeTournamentType,
  recommendedFreeMulligans,
  seatTypeLabel,
  gameTypeLabel,
  seatDeckIsEmpty,
  tournamentTypeNameOf,
} from './constants'
import { deckRef } from '../decks'

describe('seat types (HUMAN seats)', () => {
  it('normalizes enum names, descriptions and legacy aliases', () => {
    expect(normalizeSeatType('HUMAN')).toBe('HUMAN')
    expect(normalizeSeatType('Human')).toBe('HUMAN')
    expect(normalizeSeatType('SIM')).toBe('SIM')
    expect(normalizeSeatType('sim')).toBe('SIM')
    expect(normalizeSeatType('COMPUTER_MAD')).toBe('COMPUTER_MAD')
    expect(normalizeSeatType('Computer - mad')).toBe('COMPUTER_MAD')
    expect(normalizeSeatType('COMPUTER_MONTE_CARLO')).toBe('COMPUTER_MONTE_CARLO')
    expect(normalizeSeatType('Computer - monte carlo')).toBe('COMPUTER_MONTE_CARLO')
    expect(normalizeSeatType('COMPUTER_DRAFT')).toBe('COMPUTER_DRAFT_BOT')
    expect(normalizeSeatType('Computer - draftbot')).toBe('COMPUTER_DRAFT_BOT')
  })

  it('classifies HUMAN, SIM and native AI seats', () => {
    expect(isHumanSeatType('HUMAN')).toBe(true)
    expect(isHumanSeatType('Human')).toBe(true)
    expect(isHumanSeatType('SIM')).toBe(false)
    expect(isSimSeatType('SIM')).toBe(true)
    expect(isSimSeatType('HUMAN')).toBe(false)
    expect(isSimSeatType('COMPUTER_MAD')).toBe(false)
    expect(isNativeAiSeatType('COMPUTER_MAD')).toBe(true)
    expect(isNativeAiSeatType('Computer - mad')).toBe(true)
    expect(isNativeAiSeatType('COMPUTER_MONTE_CARLO')).toBe(true)
    expect(isNativeAiSeatType('HUMAN')).toBe(false)
    expect(isNativeAiSeatType('SIM')).toBe(false)
  })

  it('aiSeatTypes excludes HUMAN and SIM without duplicates', () => {
    expect(aiSeatTypes(['HUMAN', 'SIM', 'COMPUTER_MAD', 'Human', 'COMPUTER_DRAFT'])).toEqual([
      'COMPUTER_MAD',
      'COMPUTER_DRAFT_BOT',
    ])
  })

  it('labels seats for the dropdown', () => {
    expect(seatTypeLabel('HUMAN')).toMatch(/espera/i)
    expect(seatTypeLabel('SIM')).toBe('SIM')
    expect(seatTypeLabel('COMPUTER_DRAFT_BOT')).toMatch(/draftbot/i)
  })
})

describe('COMPUTER_LLM seat type (LLMage fork)', () => {
  it('normalizes the enum name and its aliases', () => {
    expect(normalizeSeatType('COMPUTER_LLM')).toBe('COMPUTER_LLM')
    expect(normalizeSeatType('Computer - LLM')).toBe('COMPUTER_LLM')
    expect(normalizeSeatType('computer_llm_seat')).toBe('COMPUTER_LLM')
    expect(normalizeSeatType('COMPUTER_LLM_SEAT')).toBe('COMPUTER_LLM')
  })

  it('isLlmSeatType is true only for the LLM seat and is not SIM/HUMAN', () => {
    expect(isLlmSeatType('COMPUTER_LLM')).toBe(true)
    expect(isLlmSeatType('Computer - LLM')).toBe(true)
    expect(isLlmSeatType('COMPUTER_MAD')).toBe(false)
    expect(isLlmSeatType('HUMAN')).toBe(false)
    expect(isLlmSeatType('SIM')).toBe(false)
    expect(isHumanSeatType('COMPUTER_LLM')).toBe(false)
    expect(isSimSeatType('COMPUTER_LLM')).toBe(false)
  })

  it('is counted as a native AI seat (joins the bot-seat path)', () => {
    expect(isNativeAiSeatType('COMPUTER_LLM')).toBe(true)
    expect(aiSeatTypes(['HUMAN', 'SIM', 'COMPUTER_MAD', 'COMPUTER_LLM'])).toEqual(['COMPUTER_MAD', 'COMPUTER_LLM'])
  })

  it('labels the LLM seat through the i18n helper', () => {
    expect(seatTypeLabel('COMPUTER_LLM')).toMatch(/llm/i)
  })

  it('maps the raw game-type enum to a translated label, else passes it through', () => {
    // Without `t` the raw server name is kept (no crash, still selectable).
    expect(gameTypeLabel('Two Player Duel')).toBe('Two Player Duel')
    // With `t` the known enum maps to its catalog key.
    const t = ((_cat: string, key: string) => `«${key}»`) as never
    expect(gameTypeLabel('Two Player Duel', t)).toBe('«game_type_two_player_duel»')
    expect(gameTypeLabel('Free For All', t)).toBe('«game_type_free_for_all»')
    // An unmapped/unknown server game type falls through to its raw name.
    expect(gameTypeLabel('Custom Pillar of the Paruns Two Player Duel', t)).toBe('Custom Pillar of the Paruns Two Player Duel')
  })

  it('a seat is "empty" only when nothing can resolve to a deck', () => {
    const deck = { id: 'mwb', name: 'Mage Web bolt', cards: [{ cardName: 'X', setCode: 'A', cardNumber: '1', amount: 60 }], sideboard: [] }
    const ref = deckRef(deck as never)
    // A resolvable per-seat deck ref is never empty (the transient false warning).
    expect(seatDeckIsEmpty(ref, [deck as never], null)).toBe(false)
    // An empty seat with a global sim deck falls back -> NOT empty.
    expect(seatDeckIsEmpty('', [], deck as never)).toBe(false)
    // Positive control: an empty seat with no deck at all IS empty.
    expect(seatDeckIsEmpty('', [], null)).toBe(true)
    // Positive control: a deck ref that resolves to nothing IS empty.
    expect(seatDeckIsEmpty('gone:deck', [deck as never], deck as never)).toBe(true)
  })
})

describe('tournament types (draft NPE)', () => {
  const serverNames = [
    'Constructed Elimination',
    'Constructed Swiss',
    'Booster Draft Elimination',
    'Booster Draft Swiss',
    'Sealed Elimination',
  ]

  it('default draft type is a real server type', () => {
    expect(serverNames).toContain(DEFAULT_DRAFT_TOURNAMENT_TYPE)
    expect(DEFAULT_DRAFT_TOURNAMENT_TYPE).not.toBe('Booster Draft')
  })

  it('tournamentTypeNameOf unwraps TournamentTypeView objects', () => {
    expect(tournamentTypeNameOf('Booster Draft Elimination')).toBe('Booster Draft Elimination')
    expect(tournamentTypeNameOf({ name: 'Sealed Swiss' })).toBe('Sealed Swiss')
    expect(tournamentTypeNameOf(null)).toBe('')
  })

  it('normalizeTournamentType maps the legacy bare Booster Draft to a valid name', () => {
    expect(normalizeTournamentType('Booster Draft Elimination', serverNames)).toBe('Booster Draft Elimination')
    expect(normalizeTournamentType('Booster Draft', serverNames)).toBe('Booster Draft Elimination')
    expect(normalizeTournamentType('Constructed Swiss', serverNames)).toBe('Constructed Swiss')
    expect(normalizeTournamentType('No Existe', serverNames)).toBe('No Existe')
  })

  it('defaultTournamentType prefers a draft type over names[0]', () => {
    expect(defaultTournamentType(serverNames)).toBe('Booster Draft Elimination')
    expect(defaultTournamentType(['Constructed Elimination', 'Constructed Swiss'])).toBe('Constructed Elimination')
    expect(defaultTournamentType([])).toBe(DEFAULT_DRAFT_TOURNAMENT_TYPE)
  })

  it('getEffectiveMaxPlayers caps drafts at 8 regardless of gameType', () => {
    const gameTypes = [{ name: 'Two Player Duel', minPlayers: 2, maxPlayers: 2 }]
    expect(getEffectiveMaxPlayers('Two Player Duel', gameTypes, true)).toBe(8)
    expect(getEffectiveMaxPlayers('Two Player Duel', gameTypes, false)).toBe(2)
  })
})

describe('recommendedFreeMulligans (CR 103.5c)', () => {
  it('recommends 1 for any multiplayer table', () => {
    expect(recommendedFreeMulligans('Free For All', 4)).toBe(1)
    expect(recommendedFreeMulligans('Commander Free For All', 4)).toBe(1)
    expect(recommendedFreeMulligans('Penny Dreadful Commander Free For All', 3)).toBe(1)
    expect(recommendedFreeMulligans('Momir Basic Free For All', 3)).toBe(1)
    expect(recommendedFreeMulligans('Oathbreaker Free For All', 3)).toBe(1)
  })

  it('recommends 1 for Brawl at any player count', () => {
    expect(recommendedFreeMulligans('Brawl Two Player Duel', 2)).toBe(1)
    expect(recommendedFreeMulligans('Brawl Free For All', 4)).toBe(1)
  })

  it('depends on the player count for commander variants without FFA in the name', () => {
    expect(recommendedFreeMulligans('Freeform Unlimited Commander', 2)).toBe(0)
    expect(recommendedFreeMulligans('Freeform Unlimited Commander', 3)).toBe(1)
  })

  it('recommends 0 for 1v1 duel formats', () => {
    expect(recommendedFreeMulligans('Two Player Duel', 2)).toBe(0)
    expect(recommendedFreeMulligans('Commander Two Player Duel', 2)).toBe(0)
    expect(recommendedFreeMulligans('Tiny Leaders Two Player Duel', 2)).toBe(0)
    expect(recommendedFreeMulligans('Freeform Commander Two Player Duel', 3)).toBe(0)
    expect(recommendedFreeMulligans('', 2)).toBe(0)
  })
})
