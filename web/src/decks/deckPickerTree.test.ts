import { describe, expect, it } from 'vitest'
import {
  ALL_EVENTS,
  NO_FORMAT,
  buildDeckPickerTree,
  deckEventLabel,
  deckPickerEvents,
  deckPickerFormatFor,
  deckPickerListSections,
  defaultDeckPickerSelection,
  libraryForDeckType,
  ownFormatForDeckType,
} from './deckPickerTree'
import { SAMPLE_DECKS_GROUP } from './deckOrder'
import type { Deck } from '../lobby/decks'

function corpus(name: string, group: string, id: string): Deck {
  return { id, name, group, cards: [], sideboard: [] }
}

function own(name: string, id: string, format?: string): Deck {
  return { id, name, format, cards: [], sideboard: [] } as Deck
}

const SAMPLE_DECK: Deck = { id: 'precon:Mage Web bolt', name: 'Mage Web bolt', group: SAMPLE_DECKS_GROUP, cards: [], sideboard: [] }

const DECKS: Deck[] = [
  SAMPLE_DECK,
  corpus('Monastery Miracles', 'Legacy', 'majors:Legacy/10022_Grand_Prix_Lille_2015/1__Monastery_Miracles_by_Claudio_Bonanni.txt'),
  corpus('Affinity', 'Legacy', 'majors:Legacy/10022_Grand_Prix_Lille_2015/2__Affinity_by_X.txt'),
  corpus('Bazaar', 'Legacy', 'majors:Legacy/10106_Finnish_Legacy_Championship/1__Bazaar.txt'),
  corpus('Boros Burn', 'Modern', 'majors:Modern/16525_Grand_Prix_Birmingham_2017/1__Boros_Burn_by_loic_le_briand.txt'),
  own('My Modern deck', 'v2:1', 'Modern'),
]

describe('deck picker — event label (the corpus id folder tier)', () => {
  it('humanizes the majors tournament folder, keeping its id number', () => {
    expect(deckEventLabel('majors:Legacy/10022_Grand_Prix_Lille_2015/1__Monastery_Miracles.txt'))
      .toBe('10022 Grand Prix Lille 2015')
  })

  it('joins the nested sample folders', () => {
    expect(deckEventLabel('sample:2013/Modern/DailyMTG/x.dck')).toBe('Modern / DailyMTG')
  })

  it('is empty when the deck sits directly in its library', () => {
    expect(deckEventLabel('sample:AI/Attack of the Vampires.dck')).toBe('')
    expect(deckEventLabel('precon:Mage Web bolt')).toBe('')
    expect(deckEventLabel('v2:My Modern deck')).toBe('')
    expect(deckEventLabel(undefined)).toBe('')
  })
})

describe('deck picker — tree', () => {
  const tree = buildDeckPickerTree(DECKS)

  it('keeps the player own decks out of the built-in tiers', () => {
    expect(tree.libraries).toEqual(['Legacy', 'Modern'])
    expect(tree.builtinByLibrary.get('Legacy')?.map((d) => d.name)).toEqual(['Affinity', 'Bazaar', 'Monastery Miracles'])
    expect(tree.ownByFormat.get('Modern')?.map((d) => d.name)).toEqual(['My Modern deck'])
    expect(tree.ownFormats).toEqual(['Modern'])
  })

  it('indexes the events per library, alphabetical', () => {
    expect(deckPickerEvents(tree, 'Legacy')).toEqual([
      '10022 Grand Prix Lille 2015',
      '10106 Finnish Legacy Championship',
    ])
    // a library without a folder tier offers no event (and no tournament level)
    expect(deckPickerEvents(tree, 'Modern')).toEqual(['16525 Grand Prix Birmingham 2017'])
  })

  it('offers the compiled samples separately from the corpus libraries', () => {
    expect(tree.samples.map((d) => d.name)).toEqual(['Mage Web bolt'])
    expect(SAMPLE_DECKS_GROUP).toBe('samples')
  })

  it('puts an own deck without a format in the unspecified bucket', () => {
    const withUnknown = buildDeckPickerTree([own('Legacy thing', 'v2:2')])
    expect(withUnknown.ownFormats).toEqual([NO_FORMAT])
  })
})

describe('deck picker — defaults', () => {
  const tree = buildDeckPickerTree(DECKS)

  it('always opens on Built-in, with the format tier following the create-table format', () => {
    expect(defaultDeckPickerSelection(tree, 'Constructed - Modern'))
      .toEqual({ category: 'builtin', format: 'Modern', event: ALL_EVENTS })
  })

  it('keeps Built-in even when the player owns a deck for that format', () => {
    expect(tree.ownFormats).toContain('Modern')
    expect(defaultDeckPickerSelection(tree, 'Constructed - Modern').category).toBe('builtin')
  })

  it('falls back to Built-in when the player has no own deck for that format', () => {
    expect(defaultDeckPickerSelection(tree, 'Constructed - Legacy'))
      .toEqual({ category: 'builtin', format: 'Legacy', event: ALL_EVENTS })
  })

  it('maps the fork deck types onto the corpus libraries', () => {
    const withCommander = buildDeckPickerTree([corpus('Precon', 'Commander', 'sample:Commander/x/y.dck')])
    expect(libraryForDeckType(withCommander, 'Variant Magic - Commander')).toBe('Commander')
    expect(defaultDeckPickerSelection(withCommander, 'Variant Magic - Commander'))
      .toEqual({ category: 'builtin', format: 'Commander', event: ALL_EVENTS })
  })

  it('falls back to the first library in old-webui order for an unmapped format', () => {
    expect(libraryForDeckType(tree, 'Limited')).toBeUndefined()
    expect(defaultDeckPickerSelection(tree, 'Limited'))
      .toEqual({ category: 'builtin', format: 'Legacy', event: ALL_EVENTS })
  })

  it('is empty-safe while the corpus has not landed', () => {
    const loading = buildDeckPickerTree([SAMPLE_DECK])
    expect(loading.libraries).toEqual([])
    expect(ownFormatForDeckType(loading, 'Constructed - Modern')).toBeUndefined()
    expect(defaultDeckPickerSelection(loading, 'Constructed - Modern'))
      .toEqual({ category: 'builtin', format: '', event: ALL_EVENTS })
    expect(deckPickerFormatFor(loading, 'own', 'Constructed - Modern')).toBe(NO_FORMAT)
  })

  it('switching category falls back inside that category', () => {
    expect(deckPickerFormatFor(tree, 'builtin', 'Constructed - Modern')).toBe('Modern')
    expect(deckPickerFormatFor(tree, 'own', 'Constructed - Legacy')).toBe('Modern')
  })
})

describe('deck picker — the deck list of a selection', () => {
  const tree = buildDeckPickerTree(DECKS)

  it('lists the samples plus the whole library on all events', () => {
    const sections = deckPickerListSections(tree, { category: 'builtin', format: 'Legacy', event: ALL_EVENTS })
    expect(sections.map((s) => s.key)).toEqual(['samples', 'library:Legacy'])
    expect(sections[0].labelKey).toBe('browser_filter_precon')
    expect(sections[0].decks.map((d) => d.name)).toEqual(['Mage Web bolt'])
    expect(sections[1].library).toBe('Legacy')
    expect(sections[1].decks.map((d) => d.name)).toEqual(['Affinity', 'Bazaar', 'Monastery Miracles'])
  })

  it('narrows to one event', () => {
    const sections = deckPickerListSections(tree, { category: 'builtin', format: 'Legacy', event: '10106 Finnish Legacy Championship' })
    expect(sections[1].decks.map((d) => d.name)).toEqual(['Bazaar'])
  })

  it('lists the own-decks bucket alone, A–Z, and nothing for an empty bucket', () => {
    const sections = deckPickerListSections(tree, { category: 'own', format: 'Modern', event: ALL_EVENTS })
    expect(sections.map((s) => s.key)).toEqual(['own'])
    expect(sections[0].decks.map((d) => d.name)).toEqual(['My Modern deck'])
    expect(deckPickerListSections(tree, { category: 'own', format: NO_FORMAT, event: ALL_EVENTS })).toEqual([])
  })
})
