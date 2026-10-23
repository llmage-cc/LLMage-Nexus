import type { DeckCard } from '../lobby/decks'
import type { DeckFormat } from './types'

export interface MetaDeckItem {
  id: string
  name: string
  format: DeckFormat
  archetype: 'Aggro' | 'Midrange' | 'Control' | 'Combo' | 'Ramp' | 'Tribal' | 'Precon'
  colors: ('W' | 'U' | 'B' | 'R' | 'G')[]
  coverCard: DeckCard
  description: string
  tier?: string
  author?: string
  cards: DeckCard[]
  sideboard: DeckCard[]
}

let catalog: MetaDeckItem[] | null = null
let pending: Promise<MetaDeckItem[]> | null = null

/**
 * Loads the curated catalog (its own chunk) and hands back the shared array. Callers that render
 * the deck gallery, the deck browser or the starter-deck offer await this once: the promise is
 * memoised, so several surfaces asking at the same time cause one fetch.
 */
export function loadMetaDeckCatalog(): Promise<MetaDeckItem[]> {
  pending ??= import('./metaDeckCatalogData').then((m) => {
    catalog = m.META_DECK_CATALOG
    return m.META_DECK_CATALOG
  })
  return pending
}

/**
 * The catalog if its chunk already landed. For a render that must not suspend (the deck browser
 * paints its filters first and fills the list when the chunk arrives); `null` means "not yet".
 */
export function metaDeckCatalogIfLoaded(): MetaDeckItem[] | null {
  return catalog
}
