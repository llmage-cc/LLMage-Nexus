import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { findPresetDefaultDeck, getAllAvailableDecks, ensureBundledDecksLoaded, deckRef, sameDeck, type Deck } from '../decks'
import { isHumanSeatType, type SeatConfig } from './constants'

/**
 * The wizard's DEFAULT SIM (global bot) deck — the picker's initial selection
 * and the deck a fresh SIM seat inherits (`useCreateTableForm`'s seat-fill
 * effect) whenever the user does not touch the choice: the curated REAL bundled
 * corpus deck ('Boros Burn', the preset default), never DEFAULT_DECK (the
 * 'Mage Web bolt' lands deck, the deterministic e2e harness's deck). It falls
 * back to the bundled list head ONLY when the corpus deck is unavailable
 * (corpus still loading or `VITE_BUNDLED_DECKS` disabled). DEFAULT_DECK itself
 * is untouched — the e2e harness still selects it by name.
 */
function defaultSimDeck(available: Deck[]): Deck | null {
  return findPresetDefaultDeck() ?? available[0] ?? null
}

/**
 * The decks the Create Table wizard can seat: the list (bundled samples + the
 * lazily loaded ~5,000-deck corpus + legacy right away, the stored decks once
 * the async storage answers), my deck and the default deck for bot seats.
 */
export function useDeckChoices(storeDeck: Deck | null, setSeatConfigs: Dispatch<SetStateAction<SeatConfig[]>>) {
  const [availableDecks, setAvailableDecks] = useState<Deck[]>(() => getAllAvailableDecks())
  const [decksLoaded, setDecksLoaded] = useState(false)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        // Wait for the bundled corpus first, so the merge below already sees the
        // ~5,000 decks (they arrive after the first paint; the samples show meanwhile).
        await ensureBundledDecksLoaded()
        const mod = await import('../../decks/storage')
        const st = mod.getDeckStorage()
        const v2 = await st.list()
        if (cancelled) return
        const maps = new Map<string, Deck>()
        for (const d of v2) {
          const deck: Deck = { ...d, id: d.id || `v2:${d.name}` }
          maps.set(deckRef(deck), deck)
        }
        for (const d of getAllAvailableDecks()) {
          if (!maps.has(deckRef(d))) maps.set(deckRef(d), d)
        }
        setAvailableDecks([...maps.values()])
      } catch {}
      if (!cancelled) setDecksLoaded(true)
    })()
    return () => { cancelled = true }
  }, [])
  const [myDeck, setMyDeckState] = useState<Deck | null>(() => {
    const avail = getAllAvailableDecks()
    if (storeDeck) {
      const match = avail.find((d) => sameDeck(d, storeDeck))
      if (match) return match
      return storeDeck
    }
    return avail[0] ?? null
  })
  const [simDeck, setSimDeck] = useState<Deck | null>(() => defaultSimDeck(getAllAvailableDecks()))

  // Si la lista de mazos llega tarde (storage async) y no hay selección, coger el primero.
  // Ambos "primero" son el DEFAULT del picker, no una elección del usuario: pasan
  // por `defaultSimDeck` (corpus preset, head of the bundled list only when the
  // corpus deck is unavailable) — nunca aterriza el mazo de tierras del e2e.
  //
  // `touched`: el usuario ya movió el select del mazo SIM. La carga perezosa del
  // corpus puede aterrizar DESPUÉS de que el wizard abriese (simDeck cayó al head
  // de la lista porque `findPresetDefaultDeck()` aún no estaba), así que el
  // default SE RE-DERIVA cuando la lista completa llega — pero una elección real
  // del usuario (o la de `selectGlobalSimDeck`) nunca se pisa.
  const simDeckTouched = useRef(false)
  useEffect(() => {
    if (availableDecks.length === 0) return
    if (!myDeck) setMyDeckState(availableDecks[0])
    if (!simDeck) {
      simDeckTouched.current = true // the unset refill is the default, not a choice
      setSimDeck(defaultSimDeck(availableDecks))
    } else if (!simDeckTouched.current) {
      setSimDeck(defaultSimDeck(availableDecks))
    }
  }, [availableDecks, simDeck, myDeck])

  /** Resuelve un mazo por referencia estable (id) con fallback por nombre (form persistido antiguo). */
  const findDeck = (ref?: string): Deck | undefined => {
    if (!ref) return undefined
    return availableDecks.find((d) => deckRef(d) === ref) ?? availableDecks.find((d) => d.name === ref)
  }
  const selectMyDeck = (ref: string) => {
    setMyDeckState(findDeck(ref) ?? null)
  }
  const selectGlobalSimDeck = (ref: string) => {
    const d = findDeck(ref) ?? null
    simDeckTouched.current = true
    setSimDeck(d)
    if (d) setSeatConfigs((prev) => prev.map((s) => !isHumanSeatType(s.type) ? { ...s, deckName: deckRef(d) } : s))
  }

  const adoptStarterDecks = (decks: Deck[], mine: Deck, botDeck: Deck) => {
    setAvailableDecks((prev) => [...prev, ...decks])
    setMyDeckState(mine)
    // The user's adopt is a real choice: the late-list re-derive must never
    // clobber `botDeck` (the fit-ranked starter deck) with the corpus default.
    simDeckTouched.current = true
    setSimDeck((current) => current ?? botDeck)
    setSeatConfigs((prev) => prev.map((s) => !isHumanSeatType(s.type) && !s.deckName ? { ...s, deckName: deckRef(botDeck) } : s))
  }

  return { availableDecks, decksLoaded, myDeck, simDeck, findDeck, selectMyDeck, selectGlobalSimDeck, adoptStarterDecks }
}
