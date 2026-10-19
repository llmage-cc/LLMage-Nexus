import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import DecksGallery, { mergeEnrichedColors, pruneSelectedId } from './DecksGallery'
import { cloneDeckForEdit } from './cloneDeck'
import { setBundledCorpusForTests } from './bundledDecks'
import type { DeckV2 } from './types'

const storeState = vi.hoisted(() => ({ decks: [] as DeckV2[] }))
const confirmState = vi.hoisted(() => ({ calls: [] as string[], resolve: true }))

vi.mock('./storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./storage')>()
  return {
    ...actual,
    getDeckStorage: () => ({
      list: async () => [...storeState.decks],
      get: async (id: string) => storeState.decks.find((d) => d.id === id) ?? null,
      put: async (d: DeckV2) => {
        const i = storeState.decks.findIndex((x) => x.id === d.id)
        if (i >= 0) storeState.decks[i] = d
        else storeState.decks.unshift(d)
      },
      del: async (id: string) => {
        storeState.decks = storeState.decks.filter((d) => d.id !== id)
      },
      count: async () => storeState.decks.length,
    }),
  }
})

vi.mock('../ui/confirmDialog', () => ({
  confirmDialog: vi.fn(async (msg: string) => {
    confirmState.calls.push(msg)
    return confirmState.resolve
  }),
  alertDialog: vi.fn(async () => undefined),
}))

const customDeck = (over: Partial<DeckV2> = {}): DeckV2 => ({
  id: 'c1',
  name: 'Mi Burn',
  format: 'Freeform',
  colors: ['R'],
  cards: [{ cardName: 'Lightning Bolt', setCode: 'M10', cardNumber: '146', amount: 4 }],
  sideboard: [],
  createdAt: 1,
  updatedAt: 2,
  source: 'custom',
  ...over,
}) as DeckV2

beforeEach(() => {
  storeState.decks = []
  confirmState.calls = []
  confirmState.resolve = true
  setBundledCorpusForTests(null)
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false }) as never))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  setBundledCorpusForTests(null)
})

describe('cloneDeckForEdit (AUDIT bloqueante)', () => {
  it('conserva comandante, pareja y favorito al clonar un precon Commander', () => {
    const atraxa = { cardName: "Atraxa, Praetors' Voice", setCode: 'C16', cardNumber: '28', amount: 1 }
    const sidar = { cardName: 'Sidar Kondo of Jamuraa', setCode: 'PC2', cardNumber: '1', amount: 1 }
    const tana = { cardName: 'Tana, the Bloodsower', setCode: 'C16', cardNumber: '56', amount: 1 }
    const precon = {
      id: 'precon-0-x',
      name: 'CMD',
      format: 'Commander',
      colors: ['W', 'U', 'B', 'G'],
      cards: [atraxa],
      sideboard: [],
      coverCard: atraxa,
      commanderCard: sidar,
      partnerCard: tana,
      favorite: true,
      createdAt: 1,
      updatedAt: 1,
      source: 'precon',
      group: 'Commander',
    } as unknown as DeckV2

    const clone = cloneDeckForEdit(precon)
    expect(clone.id).not.toBe(precon.id)
    expect(clone.source).toBe('custom')
    expect(clone.commanderCard).toEqual(sidar)
    expect(clone.partnerCard).toEqual(tana)
    expect(clone.favorite).toBe(true)
    expect(clone.coverCard).toEqual(atraxa)
    // the bundle's corpus library describes where the BORROWED deck came from;
    // the clone is the player's own deck and must not keep it (the deck pickers
    // group by `group` — see decks/deckOrder.ts).
    expect(precon.group).toBe('Commander')
    expect(clone.group).toBeUndefined()
  })
})

describe('mergeEnrichedColors (AUDIT)', () => {
  const mountain = { cardName: 'Mountain', setCode: 'LEA', cardNumber: '292', amount: 60 }
  const forest = { cardName: 'Forest', setCode: 'LEA', cardNumber: '294', amount: 60 }
  const deckOf = (over: Record<string, unknown>) => ({
    id: 'd1',
    name: 'D',
    format: 'Freeform',
    colors: [],
    cards: [mountain],
    sideboard: [],
    createdAt: 0,
    updatedAt: 0,
    source: 'custom',
    ...over,
  }) as unknown as DeckV2

  it('aplica colores cuando el mazo no cambió', () => {
    const cur = [deckOf({})]
    const enriched = [deckOf({ colors: ['R'] })]
    const merged = mergeEnrichedColors(cur, enriched)
    expect(merged[0].colors).toEqual(['R'])
  })

  it('no pisa ediciones del usuario hechas durante los fetches', () => {
    const cur = [deckOf({ cards: [mountain, forest] })]
    const enriched = [deckOf({ colors: ['R'] })]
    expect(mergeEnrichedColors(cur, enriched)).toBe(cur)
  })

  it('no toca mazos que ya tienen colores', () => {
    const cur = [deckOf({ colors: ['G'] })]
    const enriched = [deckOf({ colors: ['R'] })]
    expect(mergeEnrichedColors(cur, enriched)).toBe(cur)
  })
})

describe('pruneSelectedId', () => {
  const decks = [{ id: 'a' }, { id: 'b' }] as DeckV2[]

  it('conserva el seleccionado si sigue existiendo', () => {
    expect(pruneSelectedId(decks, 'a')).toBe('a')
  })

  it('limpia el seleccionado si ya no existe tras load()', () => {
    expect(pruneSelectedId(decks, 'fantasma')).toBeNull()
  })

  it('null se queda en null', () => {
    expect(pruneSelectedId(decks, null)).toBeNull()
  })
})

describe('DecksGallery footer', () => {
  const openMoreMenu = async () => {
    fireEvent.click(await screen.findByTestId('decks-more-menu'))
  }

  it('deshabilita el backup sin customs y lo habilita con customs', async () => {
    const { unmount } = render(<DecksGallery onEdit={() => {}} />)
    await openMoreMenu()
    const backupEmpty = await screen.findByText('Copia de seguridad de todos los mazos (0)')
    expect((backupEmpty.closest('button') as HTMLButtonElement).disabled).toBe(true)
    unmount()

    storeState.decks = [customDeck()]
    render(<DecksGallery onEdit={() => {}} />)
    await openMoreMenu()
    const backupOne = await screen.findByText('Copia de seguridad de todos los mazos (1)')
    expect((backupOne.closest('button') as HTMLButtonElement).disabled).toBe(false)
  })

  it('etiqueta restore como restaurar copia y favorito con ★ visible', async () => {
    storeState.decks = [customDeck({ favorite: true })]
    render(<DecksGallery onEdit={() => {}} />)
    await openMoreMenu()
    expect(await screen.findByText('Restaurar copia de seguridad (.json)')).not.toBeNull()
    const stars = await screen.findAllByText('★')
    const favBtn = stars.map((s) => s.closest('button')).find(Boolean)
    expect(favBtn?.getAttribute('aria-pressed')).toBe('true')
    expect(favBtn?.textContent).toContain('Favorito')
  })

  it('agrupa los formatos de exportación en un menú que descarga el mazo elegido', async () => {
    storeState.decks = [customDeck()]
    render(<DecksGallery onEdit={() => {}} />)
    const trigger = await screen.findByTestId('decks-export-menu')
    expect((trigger as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(trigger)
    for (const fmt of ['.dck', 'Arena', 'Plain', '.dek']) {
      expect(await screen.findByRole('menuitem', { name: fmt })).not.toBeNull()
    }
  })

  it('el confirm de borrado muestra el NOMBRE del mazo', async () => {
    storeState.decks = [customDeck()]
    render(<DecksGallery onEdit={() => {}} />)
    const delBtn = await screen.findByText('Eliminar')
    fireEvent.click(delBtn.closest('button')!)
    await waitFor(() => expect(confirmState.calls.length).toBe(1))
    expect(confirmState.calls[0]).toContain('Mi Burn')
    await waitFor(() => expect(storeState.decks.length).toBe(0))
  })

  it('el borrado de precon queda deshabilitado con marca visible', async () => {
    render(<DecksGallery onEdit={() => {}} />)
    fireEvent.click(await screen.findByText('Mage Web bolt'))
    const delBtn = await screen.findByText('Eliminar')
    expect((delBtn.closest('button') as HTMLButtonElement).disabled).toBe(true)
    expect(delBtn.closest('button')?.getAttribute('title')).toContain('Precon')
  })
})

describe('DecksGallery deck counter', () => {
  it('gives the n/MAX counter a visible + accessible label', async () => {
    render(<DecksGallery onEdit={() => {}} />)
    const counter = await screen.findByTestId('decks-counter')
    // A bare "0/75" is meaningless; the label names what is counted (es locale).
    expect(counter.textContent).toBe('Mazos 0/75')
    expect(counter.getAttribute('aria-label')).toBe('Mazos 0/75')
    expect(counter.getAttribute('title')).toBe('Mazos 0/75')
  })
})

describe('DecksGallery empty state + Create Deck', () => {
  it('hides the empty hint while the bundled decks fill the grid', async () => {
    render(<DecksGallery onEdit={() => {}} />)
    // The pre-fix copy ("No decks yet…") asserted an empty list right above this
    // populated grid; it must not be claimed while decks are on screen.
    expect(await screen.findByText('Mage Web bolt')).not.toBeNull()
    expect(screen.queryByTestId('decks-empty-hint')).toBeNull()
  })

  it('shows the empty hint only when nothing at all is listed (bundled decks off)', async () => {
    vi.stubEnv('VITE_BUNDLED_DECKS', '0')
    render(<DecksGallery onEdit={() => {}} />)
    const hint = await screen.findByTestId('decks-empty-hint')
    expect(hint.textContent).toContain('Aún no hay mazos')
    // With no grid at all the own-decks nudge is meaningless: it rides on
    // visible precon boxes, and here there are none.
    expect(screen.queryByTestId('decks-empty-hint-own')).toBeNull()
  })

  it('nudges create/import when only the bundled grid is visible (own=0, nudge key)', async () => {
    render(<DecksGallery onEdit={() => {}} />)
    expect(await screen.findByText('Mage Web bolt')).not.toBeNull()
    // The old all-empty hint must stay OFF over the populated grid (bug fix
    // from 24a4b8c172), while the OWN-decks nudge shows: zero own decks.
    expect(screen.queryByTestId('decks-empty-hint')).toBeNull()
    const nudge = await screen.findByTestId('decks-empty-hint-own')
    expect(nudge.textContent).toContain('mazos iniciales')
  })

  it('hides the nudge once the user has own decks, even with the bundled grid visible', async () => {
    storeState.decks = [customDeck()]
    render(<DecksGallery onEdit={() => {}} />)
    expect(await screen.findByText('Mage Web bolt')).not.toBeNull()
    await screen.findAllByText('Mi Burn')
    expect(screen.queryByTestId('decks-empty-hint-own')).toBeNull()
    expect(screen.queryByTestId('decks-empty-hint')).toBeNull()
  })

  it('hides the hint once a custom deck exists', async () => {
    vi.stubEnv('VITE_BUNDLED_DECKS', '0')
    storeState.decks = [customDeck()]
    render(<DecksGallery onEdit={() => {}} />)
    await screen.findAllByText('Mi Burn')
    expect(screen.queryByTestId('decks-empty-hint')).toBeNull()
  })

  it('Create Deck creates a deck and opens the builder via onEdit', async () => {
    const onEdit = vi.fn()
    render(<DecksGallery onEdit={onEdit} />)
    // The tile is labelled by the "box_create" key (es locale).
    fireEvent.click((await screen.findByText('Crear Mazo')).closest('.deck-box-create')!)
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1))
    // A new custom deck was persisted (the mock storage list now holds one).
    expect(storeState.decks).toHaveLength(1)
    expect(storeState.decks[0].source).toBe('custom')
    expect(onEdit).toHaveBeenCalledWith(storeState.decks[0].id)
  })
})

describe('DecksGallery "Meta & Decks Populares" search (parity GAP 3)', () => {
  const corpusDeck = {
    id: 'majors:Modern/16525_boros-burn',
    name: 'Boros Burn',
    group: 'Modern',
    cards: [{ cardName: 'Lightning Bolt', setCode: 'M10', cardNumber: '146', amount: 4 }],
    sideboard: [],
  }

  it('reaches the bundled corpus through the pane search, without dumping it by default', async () => {
    setBundledCorpusForTests([corpusDeck])
    render(<DecksGallery onEdit={() => {}} />)
    fireEvent.click(await screen.findByText('Meta & Decks Populares'))

    // No query: still the curated catalog, and the corpus deck is not listed.
    expect(await screen.findByText('Mono Red Aggro')).not.toBeNull()
    expect(screen.queryByText('Boros Burn')).toBeNull()

    fireEvent.change(await screen.findByPlaceholderText('Buscar...'), { target: { value: 'boros burn' } })
    expect(await screen.findByText('Boros Burn')).not.toBeNull()
  })
})

describe('DecksGallery enriching (C.13 nit: progreso Scryfall)', () => {
  it('muestra indicador mientras enriquece colores y lo retira al terminar', async () => {
    storeState.decks = [customDeck({ id: 'c-nocolor', colors: [] })]
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})) as never)
    render(<DecksGallery onEdit={() => {}} />)
    expect(await screen.findByRole('status')).not.toBeNull()
  })

  it('sin trabajo de enriquecimiento no hay indicador', async () => {
    storeState.decks = [customDeck()]
    render(<DecksGallery onEdit={() => {}} />)
    await screen.findAllByText('Mi Burn')
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  })
})
