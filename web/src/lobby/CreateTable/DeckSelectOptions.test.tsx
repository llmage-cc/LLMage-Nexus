import type { ComponentProps } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DeckSelectOptions from './DeckSelectOptions'
import { SAMPLE_DECKS_GROUP } from '../../decks/deckOrder'

type DeckList = ComponentProps<typeof DeckSelectOptions>['decks']
type DeckLike = DeckList[number] & { format?: string }

function deck(name: string, id: string, group?: string, format?: string): DeckLike {
  return { id, name, group, format, cards: [{ cardName: 'Island', setCode: '', cardNumber: '', amount: 60 }], sideboard: [] }
}

const SAMPLE = deck('Mage Web bolt', 'precon:Mage Web bolt', SAMPLE_DECKS_GROUP)
const LEGACY_GP = 'majors:Legacy/10022_Grand_Prix_Lille_2015/1__Monastery_Miracles_by_Claudio_Bonanni.txt'
const LEGACY_CHAMP = 'majors:Legacy/10106_Finnish_Legacy_Championship/1__Bazaar_Infestation.txt'
const MODERN_BURN = 'majors:Modern/16525_Grand_Prix_Birmingham_2017/1__Boros_Burn_by_loic_le_briand.txt'

const DECKS = [
  SAMPLE,
  deck('Monastery Miracles', LEGACY_GP, 'Legacy'),
  deck('Bazaar Infestation', LEGACY_CHAMP, 'Legacy'),
  deck('Boros Burn', MODERN_BURN, 'Modern'),
] as unknown as DeckList

function renderPicker(over: Partial<ComponentProps<typeof DeckSelectOptions>> = {}) {
  return render(
    <DeckSelectOptions
      decks={DECKS}
      label={(d) => `${d.name} (${d.cards.reduce((sum, c) => sum + c.amount, 0)})`}
      testid="deck-picker"
      fieldLabel="Deck"
      currentFormat="Constructed - Modern"
      {...over}
    />,
  )
}

const values = (testid: string): string[] =>
  Array.from((screen.getByTestId(testid) as HTMLSelectElement).options).map((o) => o.value)
const texts = (testid: string): string[] =>
  Array.from((screen.getByTestId(testid) as HTMLSelectElement).options).map((o) => o.textContent ?? '')

describe('DeckSelectOptions — the tiered Create-Table deck picker', () => {
  afterEach(() => cleanup())

  it('defaults to Built-in at the form format, all events, and lists that library only', () => {
    renderPicker()

    expect(screen.getByTestId('deck-picker-builtin').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('deck-picker-own').getAttribute('aria-pressed')).toBe('false')
    // corpus libraries in old-webui order; the form format is preselected
    expect(values('deck-picker-format')).toEqual(['Legacy', 'Modern'])
    expect((screen.getByTestId('deck-picker-format') as HTMLSelectElement).value).toBe('Modern')
    // the event tier starts at all events
    expect((screen.getByTestId('deck-picker-tournament') as HTMLSelectElement).value).toBe('*')
    expect(values('deck-picker-tournament')).toEqual(['*', '16525 Grand Prix Birmingham 2017'])
    // samples + the selected library; the Legacy decks are NOT offered here
    expect(values('deck-picker')).toEqual([SAMPLE.id, MODERN_BURN])
    expect(texts('deck-picker')).toEqual(['Mage Web bolt (60)', 'Boros Burn (60)'])
  })

  it('keeps the option VALUE the stable deck ref and reports the choice', () => {
    const onChange = vi.fn()
    renderPicker({ onChange, value: SAMPLE.id })
    expect((screen.getByTestId('deck-picker') as HTMLSelectElement).value).toBe(SAMPLE.id)

    fireEvent.change(screen.getByTestId('deck-picker'), { target: { value: MODERN_BURN } })
    expect(onChange).toHaveBeenCalledWith(MODERN_BURN)
  })

  it('narrows the deck tier by format and by event', () => {
    renderPicker()

    fireEvent.change(screen.getByTestId('deck-picker-format'), { target: { value: 'Legacy' } })
    // decks A–Z inside the selection: Bazaar Infestation before Monastery Miracles
    expect(values('deck-picker')).toEqual([SAMPLE.id, LEGACY_CHAMP, LEGACY_GP])
    expect(values('deck-picker-tournament')).toEqual(['*', '10022 Grand Prix Lille 2015', '10106 Finnish Legacy Championship'])

    fireEvent.change(screen.getByTestId('deck-picker-tournament'), { target: { value: '10106 Finnish Legacy Championship' } })
    expect(values('deck-picker')).toEqual([SAMPLE.id, LEGACY_CHAMP])

    fireEvent.change(screen.getByTestId('deck-picker-tournament'), { target: { value: '*' } })
    expect(values('deck-picker')).toEqual([SAMPLE.id, LEGACY_CHAMP, LEGACY_GP])
  })

  it('opens on Built-in and still offers the player own decks on the My decks side', () => {
    const mine = deck('My Modern deck', 'v2:1', undefined, 'Modern')
    renderPicker({ decks: [...DECKS, mine] as unknown as DeckList })

    // Owning a deck for the form's format must NOT pull the default
    // away from Built-in.
    expect(screen.getByTestId('deck-picker-builtin').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('deck-picker-own').getAttribute('aria-pressed')).toBe('false')
    expect(values('deck-picker-format')).toEqual(['Legacy', 'Modern'])
    expect(values('deck-picker')).toEqual([SAMPLE.id, MODERN_BURN])
    expect(screen.getByTestId('deck-picker-tournament')).toBeTruthy()

    fireEvent.click(screen.getByTestId('deck-picker-own'))
    expect(values('deck-picker-format')).toEqual(['Modern'])
    expect(values('deck-picker')).toEqual(['v2:1'])
    // no event tier for the player's own decks
    expect(screen.queryByTestId('deck-picker-tournament')).toBeNull()
  })

  it('pins the current deck when the selection does not list it', () => {
    renderPicker({ value: LEGACY_GP })
    // the Legacy deck is not part of the Modern built-in selection: it stays visible
    expect(values('deck-picker')[0]).toBe(LEGACY_GP)
    expect(texts('deck-picker')[0]).toBe('Monastery Miracles (60)')
  })

  it('re-derives the untouched defaults when the corpus lands after mount', () => {
    const { rerender } = renderPicker({ decks: [SAMPLE] as unknown as DeckList })
    // only the compiled samples are known yet
    expect(values('deck-picker')).toEqual([SAMPLE.id])

    rerender(
      <DeckSelectOptions
        decks={DECKS}
        label={(d) => `${d.name} (${d.cards.reduce((sum, c) => sum + c.amount, 0)})`}
        testid="deck-picker"
        fieldLabel="Deck"
        currentFormat="Constructed - Modern"
      />,
    )
    expect((screen.getByTestId('deck-picker-format') as HTMLSelectElement).value).toBe('Modern')
    expect(values('deck-picker')).toEqual([SAMPLE.id, MODERN_BURN])
  })

  it('keeps the empty state and the disabled flag', () => {
    renderPicker({ decks: [], disabled: true })
    const select = screen.getByTestId('deck-picker') as HTMLSelectElement
    expect(select.disabled).toBe(true)
    expect(select.options).toHaveLength(1)
    expect(select.options[0].disabled).toBe(true)
  })
})
