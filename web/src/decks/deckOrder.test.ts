// The bundled corpus must reach the pickers in the OLD webui's order.
//
// The asset is committed in the source corpus's file order (walked mtgtop8
// directories), so the ordering is applied by the loader — these tests pin both
// the comparators and the fact that `loadBundledCorpus()` returns the ordered
// list (a 5,013-entry dropdown in file order is unusable).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareLibraries, deckPickerSections, sortBundledEntries, sortDecksByName, SAMPLE_DECKS_GROUP } from './deckOrder'
import { loadBundledCorpus, setBundledCorpusForTests } from './bundledDecks'
import type { BundledDecksFile } from './builtinDecklist'
import type { Deck } from '../lobby/decks'

const HERE = path.dirname(fileURLToPath(import.meta.url))

function resolveAsset(): string {
  const candidates = [HERE, path.join(process.cwd(), 'src', 'data'), path.join(process.cwd(), 'web', 'src', 'data')]
  for (const dir of candidates) {
    const p = path.join(dir, 'bundledDecks.generated.json')
    if (fs.existsSync(p)) return p
  }
  throw new Error('bundledDecks.generated.json not found from ' + HERE)
}

const ASSET = JSON.parse(fs.readFileSync(resolveAsset(), 'utf8')) as BundledDecksFile

const okResponse = (file: BundledDecksFile) => ({ ok: true, json: async () => file }) as unknown as Response

describe('deck ordering — libraries (old webui buildTree parity)', () => {
  it('leads with the event formats in their fixed order', () => {
    const sorted = ['Decks to Beat', 'cEDH', 'Modern', '1998', 'Legacy', 'Commander', 'Pioneer'].sort(compareLibraries)
    expect(sorted).toEqual(['Legacy', 'Modern', 'Pioneer', 'cEDH', '1998', 'Commander', 'Decks to Beat'])
  })

  it('orders the remaining libraries alphabetically', () => {
    expect(compareLibraries('AI', 'Commander')).toBeLessThan(0)
    expect(compareLibraries('2011', 'Commander')).toBeLessThan(0)
    expect(compareLibraries('Top8 PT and Worlds decks (Standard)', 'Duel Decks')).toBeGreaterThan(0)
  })
})

describe('deck ordering — decks', () => {
  const dec = (name: string, id?: string): Deck => ({ id, name, cards: [], sideboard: [] })

  it('sorts decks A–Z and breaks duplicate names on the id, without mutating the input', () => {
    const input = [dec('Zoo', 'z'), dec('4c Delver', 'b'), dec('4c Delver', 'a'), dec('Affinity', 'c')]
    const sorted = sortDecksByName(input)
    expect(sorted.map((d) => d.id)).toEqual(['a', 'b', 'c', 'z'])
    expect(input.map((d) => d.id)).toEqual(['z', 'b', 'a', 'c'])
  })

  it('sorts the corpus entries: library first, then deck name', () => {
    const entries = [
      { id: 'majors:Modern/x/2_B.txt', name: 'Burn', format: 'Modern', group: 'Modern', source: 'majors', cards: [], sideboard: [] },
      { id: 'majors:Legacy/x/2_Z.txt', name: 'Zoo', format: 'Legacy', group: 'Legacy', source: 'majors', cards: [], sideboard: [] },
      { id: 'majors:Legacy/x/1_A.txt', name: 'Affinity', format: 'Legacy', group: 'Legacy', source: 'majors', cards: [], sideboard: [] },
      { id: 'sample:AI/x/AI.dck', name: 'Bots', format: 'Sample', group: 'AI', source: 'sample', cards: [], sideboard: [] },
    ]
    expect(sortBundledEntries(entries).map((e) => `${e.group}/${e.name}`)).toEqual([
      'Legacy/Affinity',
      'Legacy/Zoo',
      'Modern/Burn',
      'AI/Bots',
    ])
  })
})

describe('deck ordering — picker sections', () => {
  const dec = (name: string, group?: string): Deck => ({ name, group, cards: [], sideboard: [] })

  it('puts the player decks first, then the samples, then the libraries in order', () => {
    const sections = deckPickerSections([
      dec('Mine B'),
      dec('Modern Burn', 'Modern'),
      dec('Mage Web bolt', SAMPLE_DECKS_GROUP),
      dec('Legacy Zoo', 'Legacy'),
      dec('Mine A'),
      dec('Commander Deck', 'Commander'),
    ])
    expect(sections.map((s) => s.key)).toEqual([
      'own',
      'samples',
      'library:Legacy',
      'library:Modern',
      'library:Commander',
    ])
    expect(sections[0].labelKey).toBe('my_decks')
    expect(sections[0].decks.map((d) => d.name)).toEqual(['Mine A', 'Mine B'])
    expect(sections[1].labelKey).toBe('browser_filter_precon')
    expect(sections[1].decks.map((d) => d.name)).toEqual(['Mage Web bolt'])
    expect(sections[2].library).toBe('Legacy')
    expect(sections[3].decks.map((d) => d.name)).toEqual(['Modern Burn'])
  })

  it('returns no section for an empty list', () => {
    expect(deckPickerSections([])).toEqual([])
  })
})

describe('deck ordering — the shipped corpus', () => {
  beforeEach(() => {
    setBundledCorpusForTests(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    setBundledCorpusForTests(null)
  })

  it('the committed asset is NOT pre-sorted (the loader applies the order)', () => {
    const names = ASSET.decks.map((e) => e.name)
    expect(names).not.toEqual([...names].sort((a, b) => a.localeCompare(b)))
  })

  it('loadBundledCorpus() returns the corpus in the old webui order for every consumer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse(ASSET)) as never)
    const decks = await loadBundledCorpus()
    expect(decks).toHaveLength(5013)
    expect(decks.map((d) => `${d.group}/${d.name}`)).toEqual(sortBundledEntries(ASSET.decks).map((e) => `${e.group}/${e.name}`))
    // the picker's first corpus library is an event format, not '1998'/'2013'
    expect(decks[0].group).toBe('Legacy')
  })
})
