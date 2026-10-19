import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SeatsTab from './SeatsTab'
import type { CreateTableForm } from './useCreateTableForm'
import { P1_SEAT, SIM_SEAT } from './constants'
import type { Deck } from '../decks'
import type { P1DeckEntry } from '../../net/commands'

const POOL: P1DeckEntry[] = [
  { name: 'Izzet Spellementals', deck: '4 Lightning Bolt\n24 Island\n' },
  { name: 'Mono Red Aggro', deck: '4 Monastery Swiftspear\n' },
]

const deck = (name: string, id: string): Deck => ({
  id,
  name,
  cards: [{ cardName: 'Island', setCode: '', cardNumber: '', amount: 60 }],
  sideboard: [],
})

/** A CreateTableForm stub with only the fields SeatsTab reads. */
function stubForm(over: Partial<Record<string, unknown>> = {}) {
  return {
    seatConfigs: [{ type: SIM_SEAT, deckName: '', skill: 2 }],
    humanSeat: true,
    setHumanSeat: vi.fn(),
    isDraftLimited: false,
    myDeck: { name: 'Mine', cards: [], sideboard: [] },
    selectMyDeck: vi.fn(),
    availableDecks: [],
    decksLoaded: true,
    adoptStarterDecks: vi.fn(),
    mySkill: 2,
    setMySkill: vi.fn(),
    numPlayers: 2,
    selectedGameTypeInfo: undefined,
    isTournament: false,
    isMultiplayerGame: false,
    playerTypes: ['COMPUTER_MAD'],
    setSeatType: vi.fn(),
    setSeatSkill: vi.fn(),
    setSeatDeck: vi.fn(),
    llmEnabled: false,
    setSeatLlmConfig: vi.fn(),
    playerTypesSel: [],
    toggleAi: vi.fn(),
    applySeatTypeToAll: vi.fn(),
    applyLlmVsLlm: vi.fn(),
    simDeck: null,
    selectGlobalSimDeck: vi.fn(),
    p1Enabled: false,
    p1Decks: [],
    p1Default: '',
    p1PoolStatus: 'loading',
    reloadP1Decks: vi.fn(),
    ...over,
  } as unknown as CreateTableForm
}

/**
 * The old upstream UI had ONE seat editor, always visible, whose seat type was a
 * <select data-testid="seat-type-N"> and whose deck was the tiered DeckSelectOptions.
 * Upstream's redesign renders the seats as a radiogroup of nodes and only the active
 * seat's editor: with `humanSeat` the node at index 0 is the "you" node, so editing
 * `seatConfigs[0]` requires `humanSeat: false` (or clicking `seat-node-1`). The seat
 * type is now a radiogroup of ChipButtons; the seat deck is a DeckCarousel.
 */

describe('SeatsTab — COMPUTER_P1 seat option + training-deck picker', () => {
  afterEach(() => cleanup())

  const p1Radio = () => within(screen.getByTestId('seat-type-0')).queryByRole('radio', { name: /P1/ })

  it('offers the COMPUTER_P1 option only when it is in the visible player types (capabilities.p1)', () => {
    // SeatsTab renders whatever playerTypes the form exposes; useCreateTableForm is
    // what filters COMPUTER_P1 out when capabilities.p1 is off (see GeneralTab).
    const { unmount } = render(<SeatsTab form={stubForm({
      humanSeat: false,
      p1Enabled: false,
      playerTypes: ['COMPUTER_MAD'],
    })} />)
    expect(p1Radio()).toBeNull()
    // the human option is always offered
    expect(within(screen.getByTestId('seat-type-0')).getByRole('radio', { name: /humano|human/i })).toBeDefined()
    unmount()

    render(<SeatsTab form={stubForm({
      humanSeat: false,
      p1Enabled: true,
      playerTypes: ['COMPUTER_MAD', P1_SEAT],
    })} />)
    expect(p1Radio()).not.toBeNull()
  })

  it('switches the active seat to COMPUTER_P1 through the seat-type radiogroup', () => {
    const setSeatType = vi.fn()
    render(<SeatsTab form={stubForm({
      humanSeat: false,
      p1Enabled: true,
      playerTypes: ['COMPUTER_MAD', P1_SEAT],
      setSeatType,
    })} />)
    fireEvent.click(p1Radio() as HTMLElement)
    expect(setSeatType).toHaveBeenCalledWith(0, P1_SEAT)
  })

  it('shows the picker (not the saved-deck carousel) for a COMPUTER_P1 seat', () => {
    const { container } = render(<SeatsTab form={stubForm({
      humanSeat: false,
      p1Enabled: true,
      p1Decks: POOL,
      p1Default: 'Izzet Spellementals',
      p1PoolStatus: 'ready',
      seatConfigs: [{ type: P1_SEAT, deckName: POOL[0].deck, skill: 2 }],
    })} />)
    // the P1 seat is restricted to the training pool: no user saved-deck carousel
    expect(container.querySelector('.deck-carousel')).toBeNull()

    const select = screen.getByTestId('p1-deck-picker') as HTMLSelectElement
    // the stored deck TEXT resolves back to its NAME for the controlled value
    expect(select.value).toBe('Izzet Spellementals')
    // the default deck's option is marked with the localized "(default)" suffix
    const defaultOpt = Array.from(select.options).find((o) => o.value === 'Izzet Spellementals')
    expect(defaultOpt?.textContent).toMatch(/predeterminado|default/i)
  })

  it('writes the chosen training deck TEXT into the seat through setSeatDeck', () => {
    const setSeatDeck = vi.fn()
    render(<SeatsTab form={stubForm({
      humanSeat: false,
      p1Enabled: true,
      p1Decks: POOL,
      p1Default: 'Izzet Spellementals',
      p1PoolStatus: 'ready',
      setSeatDeck,
      seatConfigs: [{ type: P1_SEAT, deckName: POOL[0].deck, skill: 2 }],
    })} />)
    fireEvent.change(screen.getByTestId('p1-deck-picker'), { target: { value: 'Mono Red Aggro' } })
    expect(setSeatDeck).toHaveBeenCalledWith(0, '4 Monastery Swiftspear\n')
  })

  it('shows the loading empty state while the pool has not arrived', () => {
    render(<SeatsTab form={stubForm({
      humanSeat: false,
      p1Enabled: true,
      p1Decks: [],
      p1PoolStatus: 'loading',
      seatConfigs: [{ type: P1_SEAT, deckName: '', skill: 2 }],
    })} />)
    expect(screen.getByTestId('p1-deck-picker-empty')).toBeDefined()
    expect(screen.queryByTestId('p1-deck-picker')).toBeNull()
  })
})

describe('SeatsTab — LLM vs LLM preset chip (capabilities.llm gate)', () => {
  afterEach(() => cleanup())

  it('offers the one-click LLM vs LLM chip only when capabilities.llm', () => {
    const { unmount } = render(<SeatsTab form={stubForm({ llmEnabled: false })} />)
    expect(screen.queryByTestId('llm-vs-llm-preset')).toBeNull()
    unmount()

    render(<SeatsTab form={stubForm({ llmEnabled: true, playerTypes: ['COMPUTER_MAD', 'COMPUTER_LLM'] })} />)
    expect(screen.getByTestId('llm-vs-llm-preset')).toBeDefined()
  })

  it('clicking the chip calls applyLlmVsLlm', () => {
    const applyLlmVsLlm = vi.fn()
    render(<SeatsTab form={stubForm({ llmEnabled: true, playerTypes: ['COMPUTER_LLM'], applyLlmVsLlm })} />)
    fireEvent.click(screen.getByTestId('llm-vs-llm-preset'))
    expect(applyLlmVsLlm).toHaveBeenCalledOnce()
  })
})

/**
 * The four old tiered-picker specs (format/event/own-deck tiering of
 * DeckSelectOptions through `active-deck-select`) were dropped: SeatsTab no longer
 * mounts DeckSelectOptions for the player's or a seat's deck — they are now
 * DeckCarousel — so that tiering is covered where it lives,
 * DeckSelectOptions.test.tsx, and the carousel's own selection/keyboard behaviour in
 * DeckCarousel.test.tsx. What stays here is SeatsTab's WIRING of those controls.
 */
describe('SeatsTab — deck carousel wiring (replaces the tiered picker)', () => {
  afterEach(() => cleanup())

  const burn = deck('Mono Red', 'v2:10')
  const control = deck('Azorius Control', 'v2:11')

  it("selects the active bot seat's deck through setSeatDeck", () => {
    const setSeatDeck = vi.fn()
    render(<SeatsTab form={stubForm({
      humanSeat: false,
      seatConfigs: [{ type: 'COMPUTER_MAD', deckName: 'v2:10', skill: 2 }],
      availableDecks: [burn, control],
      setSeatDeck,
    })} />)

    const selected = screen.getByRole('radio', { name: /Mono Red/ })
    expect(selected.getAttribute('aria-checked')).toBe('true')

    fireEvent.click(screen.getByRole('radio', { name: /Azorius Control/ }))
    expect(setSeatDeck).toHaveBeenCalledWith(0, 'v2:11')
  })

  it("wires the 'you' node's carousel to selectMyDeck", () => {
    const selectMyDeck = vi.fn()
    render(<SeatsTab form={stubForm({
      myDeck: burn,
      availableDecks: [burn, control],
      selectMyDeck,
    })} />)

    fireEvent.click(screen.getByRole('radio', { name: /Azorius Control/ }))
    expect(selectMyDeck).toHaveBeenCalledWith('v2:11')
  })

  it('edits seatConfigs[i] when seat node i + 1 is picked under a human seat', () => {
    render(<SeatsTab form={stubForm({
      humanSeat: true,
      seatConfigs: [
        { type: 'COMPUTER_MAD', deckName: 'v2:10', skill: 2 },
        { type: 'COMPUTER_MONTE_CARLO', deckName: 'v2:11', skill: 3 },
      ],
      availableDecks: [burn, control],
    })} />)

    // the "you" node owns the editor first; the bots only get one once picked
    expect(screen.queryByTestId('seat-editor-0')).toBeNull()

    fireEvent.click(screen.getByTestId('seat-node-2'))
    expect(screen.getByTestId('seat-editor-1')).toBeDefined()
    // ...and its own deck is the selected card
    expect(screen.getByRole('radio', { name: /Azorius Control/ }).getAttribute('aria-checked')).toBe('true')
  })

  it('keeps the global SIM deck selector wired to selectGlobalSimDeck', () => {
    const selectGlobalSimDeck = vi.fn()
    render(<SeatsTab form={stubForm({
      availableDecks: [burn, control],
      simDeck: burn,
      selectGlobalSimDeck,
    })} />)

    // the current global SIM deck is pinned in the select even before the
    // "My decks" tier is opened
    expect((screen.getByTestId('sim-deck-select') as HTMLSelectElement).value).toBe('v2:10')

    fireEvent.click(screen.getByTestId('sim-deck-select-own'))
    const select = screen.getByTestId('sim-deck-select') as HTMLSelectElement
    // both own decks are listed A–Z in the "My decks" tier
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['v2:11', 'v2:10'])

    fireEvent.change(select, { target: { value: 'v2:11' } })
    expect(selectGlobalSimDeck).toHaveBeenCalledWith('v2:11')
  })
})

describe('SeatsTab — bot seat deck warning', () => {
  afterEach(() => cleanup())
  const bolt = { id: 'mwb', name: 'Mage Web bolt', cards: [{ cardName: 'Bolt', setCode: 'M10', cardNumber: '146', amount: 60 }], sideboard: [] }

  it('does NOT show the transient warning for a bot seat that will fall back to the global deck', () => {
    // During a P1 -> LLM switch the seat can briefly carry no per-seat deck ref,
    // but the submit path falls back to the global bot deck: warning here is the
    // false "Deck empty or missing" that self-resolved on the next render.
    render(<SeatsTab form={stubForm({
      humanSeat: false,
      seatConfigs: [{ type: 'COMPUTER_LLM', deckName: '', skill: 2 }],
      availableDecks: [bolt],
      simDeck: bolt,
    })} />)
    // the bot editor (not the "you" editor) must be the rendered one
    expect(screen.getByTestId('seat-editor-0')).toBeDefined()
    expect(screen.queryByText(/vacío o no encontrado|empty or missing/i)).toBeNull()
  })

  it('does NOT warn for a resolvable per-seat deck reference', () => {
    render(<SeatsTab form={stubForm({
      humanSeat: false,
      seatConfigs: [{ type: 'COMPUTER_LLM', deckName: 'mwb', skill: 2 }],
      availableDecks: [bolt],
      simDeck: bolt,
    })} />)
    expect(screen.getByTestId('seat-editor-0')).toBeDefined()
    expect(screen.queryByText(/vacío o no encontrado|empty or missing/i)).toBeNull()
  })

  it('STILL warns for a genuinely empty bot seat (positive control)', () => {
    render(<SeatsTab form={stubForm({
      humanSeat: false,
      seatConfigs: [{ type: 'COMPUTER_MAD', deckName: '', skill: 2 }],
      availableDecks: [bolt],
      simDeck: null,
    })} />)
    expect(screen.getByTestId('seat-editor-0')).toBeDefined()
    expect(screen.getByText(/vacío o no encontrado|empty or missing/i)).toBeDefined()
  })
})
