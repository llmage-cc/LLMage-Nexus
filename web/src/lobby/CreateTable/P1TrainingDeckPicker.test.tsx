import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import P1TrainingDeckPicker from './P1TrainingDeckPicker'
import type { P1DeckEntry } from '../../net/commands'

/**
 * Lifecycle surfacing of the COMPUTER_P1 picker.
 *
 * The pool is fetched once per wizard open; when the proxy REFUSES the verb
 * (`getP1Decks` ok:false — e.g. typed CAPABILITY_UNAVAILABLE because the running
 * artifacts lack `P1DeckPool`) the control must say so and offer a retry, instead
 * of sitting on the "loading…" hint forever as if the pool were still in flight.
 */

const POOL: P1DeckEntry[] = [
  { name: 'Izzet Spellementals', deck: '4 Lightning Bolt\n24 Island\n' },
  { name: 'Mono Red Aggro', deck: '4 Monastery Swiftspear\n' },
]

function renderPicker(over: Partial<Parameters<typeof P1TrainingDeckPicker>[0]> = {}) {
  const props: Parameters<typeof P1TrainingDeckPicker>[0] = {
    decks: [],
    defaultName: '',
    selectedName: '',
    onPickText: vi.fn(),
    status: 'loading',
    onRetry: vi.fn(),
    ...over,
  }
  return { ...render(<P1TrainingDeckPicker {...props} />), props }
}

describe('P1TrainingDeckPicker — pool fetch lifecycle', () => {
  afterEach(() => cleanup())

  it('shows the loading hint (no error) while the pool has not answered', () => {
    renderPicker({ status: 'loading' })
    expect(screen.getByTestId('p1-deck-picker-empty')).toBeDefined()
    expect(screen.queryByTestId('p1-deck-picker-error')).toBeNull()
    expect(screen.queryByTestId('p1-deck-picker-retry')).toBeNull()
  })

  it('surfaces a REFUSED pool as an error + retry, never as an eternal loading', () => {
    const first = renderPicker({ status: 'loading' })
    const loadingText = screen.getByTestId('p1-deck-picker-empty').textContent
    first.unmount()

    const { props } = renderPicker({ status: 'error' })
    const err = screen.getByTestId('p1-deck-picker-error')
    expect(err.textContent).toBeTruthy()
    expect(err.textContent).not.toBe(loadingText)
    expect(screen.queryByTestId('p1-deck-picker-empty')).toBeNull()

    fireEvent.click(screen.getByTestId('p1-deck-picker-retry'))
    expect(props.onRetry).toHaveBeenCalledTimes(1)
  })

  it('renders the select (default marked) once the pool arrived', () => {
    renderPicker({ decks: POOL, defaultName: 'Izzet Spellementals', status: 'ready' })
    const select = screen.getByTestId('p1-deck-picker') as HTMLSelectElement
    expect(select.querySelectorAll('option')).toHaveLength(2)
    expect(select.value).toBe('Izzet Spellementals')
    expect(screen.queryByTestId('p1-deck-picker-error')).toBeNull()
    expect(screen.queryByTestId('p1-deck-picker-retry')).toBeNull()
  })

  it('picking a name writes that deck TEXT through onPickText', () => {
    const { props } = renderPicker({ decks: POOL, defaultName: 'Izzet Spellementals', status: 'ready' })
    fireEvent.change(screen.getByTestId('p1-deck-picker'), { target: { value: 'Mono Red Aggro' } })
    expect(props.onPickText).toHaveBeenCalledWith('4 Monastery Swiftspear\n')
  })
})
