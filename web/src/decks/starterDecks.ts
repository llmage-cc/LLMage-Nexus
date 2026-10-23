import { loadMetaDeckCatalog, type MetaDeckItem } from './metaDeckCatalog'
import { cloneDeckForEdit } from './cloneDeck'
import { getDeckStorage } from './storage'
import type { DeckFormat, DeckV2 } from './types'

export const STARTER_DECK_IDS = ['meta-mod-burn', 'meta-pio-mono-white-humans', 'meta-edh-krenko'] as const

const VALIDATED_FORMAT: Partial<Record<string, DeckFormat>> = { 'meta-pio-mono-white-humans': 'Modern' }

/**
 * The three starters, resolved out of the curated catalog. Async because the catalog is its own
 * chunk: the lobby and the join/create dialogs must not carry 50 KB of decklists for a list that
 * only appears when the player has no decks yet.
 */
export async function starterDeckItems(): Promise<MetaDeckItem[]> {
  const catalog = await loadMetaDeckCatalog()
  return STARTER_DECK_IDS.map((id) => {
    const item = catalog.find((d) => d.id === id)
    if (!item) throw new Error(`starter deck ${id} is not in the catalog`)
    return item
  })
}

export async function addStarterDecks(): Promise<DeckV2[]> {
  const storage = getDeckStorage()
  const decks = (await starterDeckItems()).map((item) => {
    const deck = { ...cloneDeckForEdit(item), format: VALIDATED_FORMAT[item.id] ?? item.format }
    return item.format === 'Commander' ? { ...deck, commanderCard: item.cards[0] } : deck
  })
  for (const deck of decks) await storage.put(deck)
  return decks
}
