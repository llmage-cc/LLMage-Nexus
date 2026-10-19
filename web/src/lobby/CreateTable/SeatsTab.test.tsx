import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SeatsTab from './SeatsTab'
import type { CreateTableForm } from './useCreateTableForm'
import { P1_SEAT, SIM_SEAT } from './constants'
import type { P1DeckEntry } from '../../net/commands'

const POOL: P1DeckEntry[] = [
  { name: 'Izzet Spellementals', deck: '4 Lightning Bolt\n24 Island\n' },
  { name: 'Mono Red Aggro', deck: '4 Monastery Swiftspear\n' },
]

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
    ...over,
  } as unknown as CreateTableForm
}

describe('SeatsTab — COMPUTER_P1 seat option + training-deck picker', () => {
  afterEach(() => cleanup())

  it('offers the COMPUTER_P1 option only when it is in the visible player types (capabilities.p1)', () => {
    const { unmount } = render(<SeatsTab form={stubForm({ p1Enabled: false })} />)
    const select = screen.getByTestId('seat-type-0') as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.value)).not.toContain(P1_SEAT)
    unmount()

    render(<SeatsTab form={stubForm({ p1Enabled: true, playerTypes: ['COMPUTER_MAD', P1_SEAT] })} />)
    const withP1 = screen.getByTestId('seat-type-0') as HTMLSelectElement
    expect(Array.from(withP1.options).map((o) => o.value)).toContain(P1_SEAT)
  })

  it('shows the picker (not the saved-deck dropdown) for a COMPUTER_P1 seat', () => {
    render(<SeatsTab form={stubForm({
      p1Enabled: true,
      p1Decks: POOL,
      p1Default: 'Izzet Spellementals',
      seatConfigs: [{ type: P1_SEAT, deckName: POOL[0].deck, skill: 2 }],
    })} />)
    expect(screen.getByTestId('p1-deck-picker')).toBeDefined()
    // the default deck's option is marked with the localized "(default)" suffix
    const select = screen.getByTestId('p1-deck-picker') as HTMLSelectElement
    const defaultOpt = Array.from(select.options).find((o) => o.value === 'Izzet Spellementals')
    expect(defaultOpt?.textContent).toMatch(/default|predeterminado/i)
  })

  it('writes the chosen training deck TEXT into the seat through setSeatDeck', () => {
    const setSeatDeck = vi.fn()
    render(<SeatsTab form={stubForm({
      p1Enabled: true,
      p1Decks: POOL,
      p1Default: 'Izzet Spellementals',
      setSeatDeck,
      seatConfigs: [{ type: P1_SEAT, deckName: POOL[0].deck, skill: 2 }],
    })} />)
    fireEvent.change(screen.getByTestId('p1-deck-picker'), { target: { value: 'Mono Red Aggro' } })
    expect(setSeatDeck).toHaveBeenCalledWith(0, '4 Monastery Swiftspear\n')
  })

  it('shows the loading empty state while the pool has not arrived', () => {
    render(<SeatsTab form={stubForm({
      p1Enabled: true,
      p1Decks: [],
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

describe('SeatsTab — tiered deck picker', () => {
  afterEach(() => cleanup())

  const dec = (name: string, id: string, group?: string) => ({
    id, name, group, cards: [{ cardName: 'Island', setCode: '', cardNumber: '', amount: 60 }], sideboard: [],
  })

  const MIXED = [
    dec('Mage Web bolt', 'precon:Mage Web bolt', 'samples'),
    dec('Monastery Miracles', 'majors:Legacy/10022_Grand_Prix_Lille_2015/1__Monastery_Miracles.txt', 'Legacy'),
    dec('Affinity', 'majors:Legacy/10022_Grand_Prix_Lille_2015/2__Affinity.txt', 'Legacy'),
    dec('Boros Burn', 'majors:Modern/16525_Grand_Prix_Birmingham_2017/1__Boros_Burn.txt', 'Modern'),
  ]

  it('tiers the active-deck control by format and keeps its testids', () => {
    render(<SeatsTab form={stubForm({
      deckType: 'Constructed - Modern',
      myDeck: { id: 'precon:Mage Web bolt', name: 'Mage Web bolt', cards: [], sideboard: [] },
      availableDecks: MIXED,
    })} />)
    const select = screen.getByTestId('active-deck-select') as HTMLSelectElement
    // the samples keep their own section; the selected library is the second one
    expect(Array.from(select.querySelectorAll('optgroup')).map((g) => g.label)).toEqual(['Precon', 'Modern (1)'])
    // the format tier follows the form's format, the event tier starts at all events
    expect((screen.getByTestId('active-deck-select-format') as HTMLSelectElement).value).toBe('Modern')
    expect((screen.getByTestId('active-deck-select-tournament') as HTMLSelectElement).value).toBe('*')
    // only the current selection is listed (no Legacy deck), values stay the deck refs
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      'precon:Mage Web bolt',
      'majors:Modern/16525_Grand_Prix_Birmingham_2017/1__Boros_Burn.txt',
    ])
  })

  it('narrows the selection through the format dropdown', () => {
    render(<SeatsTab form={stubForm({ deckType: 'Constructed - Modern', availableDecks: MIXED })} />)
    fireEvent.change(screen.getByTestId('active-deck-select-format'), { target: { value: 'Legacy' } })
    const select = screen.getByTestId('active-deck-select') as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.value)).toContain('majors:Legacy/10022_Grand_Prix_Lille_2015/1__Monastery_Miracles.txt')
    expect(Array.from(select.querySelectorAll('optgroup')).map((g) => g.label)).toEqual(['Precon', 'Legacy (2)'])
  })

  it('keeps the seat deck picker wired to setSeatDeck', () => {
    const setSeatDeck = vi.fn()
    render(<SeatsTab form={stubForm({ deckType: 'Constructed - Modern', availableDecks: MIXED, setSeatDeck })} />)
    fireEvent.change(screen.getByTestId('seat-deck-0'), {
      target: { value: 'majors:Modern/16525_Grand_Prix_Birmingham_2017/1__Boros_Burn.txt' },
    })
    expect(setSeatDeck).toHaveBeenCalledWith(0, 'majors:Modern/16525_Grand_Prix_Birmingham_2017/1__Boros_Burn.txt')
  })

  it('renders the player own decks alone (bare options) when the list carries none', () => {
    render(<SeatsTab form={stubForm({
      deckType: 'Constructed - Modern',
      availableDecks: [{ ...dec('Zzz Mine', 'v2:1'), format: 'Modern' }],
    })} />)
    const select = screen.getByTestId('active-deck-select') as HTMLSelectElement
    expect(select.querySelectorAll('optgroup')).toHaveLength(0)
    expect(select.options).toHaveLength(1)
    expect(screen.queryByTestId('active-deck-select-tournament')).toBeNull()
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
      seatConfigs: [{ type: 'COMPUTER_LLM', deckName: '', skill: 2 }],
      availableDecks: [bolt],
      simDeck: bolt,
    })} />)
    expect(screen.queryByText(/vacío o no encontrado/i)).toBeNull()
  })

  it('does NOT warn for a resolvable per-seat deck reference', () => {
    render(<SeatsTab form={stubForm({
      seatConfigs: [{ type: 'COMPUTER_LLM', deckName: 'mwb', skill: 2 }],
      availableDecks: [bolt],
      simDeck: bolt,
    })} />)
    expect(screen.queryByText(/vacío o no encontrado/i)).toBeNull()
  })

  it('STILL warns for a genuinely empty bot seat (positive control)', () => {
    render(<SeatsTab form={stubForm({
      seatConfigs: [{ type: 'COMPUTER_MAD', deckName: '', skill: 2 }],
      availableDecks: [bolt],
      simDeck: null,
    })} />)
    expect(screen.getByText(/vacío o no encontrado/i)).toBeDefined()
  })
})
