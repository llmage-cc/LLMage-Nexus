import { bundledCorpusDecks, loadBundledCorpus } from '../decks/bundledDecks'
import { SAMPLE_DECKS_GROUP } from '../decks/deckOrder'

export interface DeckCard {
  cardName: string
  setCode: string
  cardNumber: string
  amount: number
}
export interface Deck {
  /** Identidad estable del mazo (puede faltar en mazos legacy/bundled). */
  id?: string
  name: string
  cards: DeckCard[]
  sideboard: DeckCard[]
  /** Comandantes designados por el importador (sección Commander). */
  commanders?: DeckCard[]
  /**
   * Source library of a deck from the bundled corpus (e.g. `Legacy`, `Modern`,
   * `cEDH`, `Decks to Beat`); absent on the player's own decks and on the 9
   * compiled samples (`SAMPLE_DECKS_GROUP`). This is what groups the deck
   * pickers (`decks/deckOrder.ts`).
   */
  group?: string
}

export const STABLE_DECK: Deck = {
  name: 'Mage Web starter',
  cards: [
    { cardName: 'Island', setCode: 'LEA', cardNumber: '288', amount: 28 },
    { cardName: 'Mountain', setCode: 'LEA', cardNumber: '292', amount: 28 },
    { cardName: 'Lightning Bolt', setCode: 'M10', cardNumber: '146', amount: 4 },
  ],
  sideboard: [],
}

// Mazo para partidas humanas: mucha tierra + Bolts, para poder jugar
// hechizos con objetivo en los primeros turnos (usado por los E2E de interacción).
// ORDENADO para partidas deterministas (skipInitShuffling): mano inicial con
// 4 Mountain + 3 Bolt → Bolt jugable en el turno 2.
// LEGAL en Construido (60 cartas, máximo 4 copias): el servidor en modo normal
// (y beta) rechaza los mazos de test con 8-16 copias que aceptaba el testMode.
export const DEFAULT_DECK: Deck = {
  name: 'Mage Web bolt',
  cards: [
    { cardName: 'Mountain', setCode: 'LEA', cardNumber: '292', amount: 4 },
    { cardName: 'Lightning Bolt', setCode: 'M10', cardNumber: '146', amount: 4 },
    { cardName: 'Mountain', setCode: 'LEA', cardNumber: '292', amount: 52 },
  ],
  sideboard: [],
}

// Mazo de verificación de flujos avanzados de Fase 2: X costs (Blaze), elección
// de modo (Boros Charm), multi-target (Arc Trail) y contadores (Walking Ballista).
// ORDENADO para partidas deterministas (skipInitShuffling): las 7 primeras cartas
// son la mano inicial (3 Mountain + Plains + 3 hechizos), la 8ª (Ballista) llega
// al turno 1, y los turnos 2-8 roban tierras para el Ballista X=4 (8 maná).
// LEGAL en Construido (4 copias máximo por carta, 60 cartas): ver DEFAULT_DECK.
export const ADVANCED_DECK: Deck = {
  name: 'Mage Web advanced',
  cards: [
    { cardName: 'Mountain', setCode: 'LEA', cardNumber: '292', amount: 3 },
    { cardName: 'Plains', setCode: 'LEA', cardNumber: '287', amount: 1 },
    { cardName: 'Blaze', setCode: '6ED', cardNumber: '168', amount: 1 },
    { cardName: 'Arc Trail', setCode: 'SOM', cardNumber: '81', amount: 1 },
    { cardName: 'Boros Charm', setCode: 'FDN', cardNumber: '721', amount: 1 },
    { cardName: 'Walking Ballista', setCode: '2XM', cardNumber: '306', amount: 1 },
    { cardName: 'Mountain', setCode: 'LEA', cardNumber: '292', amount: 7 },
    { cardName: 'Blaze', setCode: '6ED', cardNumber: '168', amount: 3 },
    { cardName: 'Plains', setCode: 'LEA', cardNumber: '287', amount: 3 },
    { cardName: 'Arc Trail', setCode: 'SOM', cardNumber: '81', amount: 3 },
    { cardName: 'Boros Charm', setCode: 'FDN', cardNumber: '721', amount: 3 },
    { cardName: 'Walking Ballista', setCode: '2XM', cardNumber: '306', amount: 3 },
    { cardName: 'Mountain', setCode: 'LEA', cardNumber: '292', amount: 30 },
  ],
  sideboard: [],
}

// Mazo del oponente IA en mesas humanas: solo tierras. La IA con Bolts (DEFAULT_DECK)
// mata al humano en partidas largas y los E2E de hechizos avanzados se vuelven flakes.
export const AI_OPPONENT_DECK: Deck = {
  name: 'Mage Web AI lands',
  cards: [
    { cardName: 'Island', setCode: 'LEA', cardNumber: '288', amount: 50 },
    { cardName: 'Mountain', setCode: 'LEA', cardNumber: '292', amount: 50 },
  ],
  sideboard: [],
}

// Mazo del humano en el E2E de combate: solo tierras. El humano nunca lanza nada y
// solo pasa (observa cómo el Sim ataca); su vida es el reloj del daño de combate.
export const LANDS_DECK: Deck = {
  name: 'Mage Web lands',
  cards: [
    { cardName: 'Mountain', setCode: 'LEA', cardNumber: '292', amount: 50 },
    { cardName: 'Island', setCode: 'LEA', cardNumber: '288', amount: 50 },
  ],
  sideboard: [],
}

// Mazo del oponente Sim en el E2E de combate: tierras + Raging Goblin (1/1 haste).
// ORDENADO para partidas deterministas: la mano inicial es 4 Mountain + 2 Raging
// Goblin + Mountain; el Sim juega tierra en el turno 1, lanza un Goblin en el turno
// 2 (haste: ataca ese mismo turno) y ataca con todo cada turno.
// LEGAL en Construido (4 Goblins máximo, 60 cartas): ver DEFAULT_DECK.
export const COMBAT_OPPONENT_DECK: Deck = {
  name: 'Mage Web combat sim',
  cards: [
    { cardName: 'Mountain', setCode: 'LEA', cardNumber: '292', amount: 4 },
    { cardName: 'Raging Goblin', setCode: 'M10', cardNumber: '153', amount: 2 },
    { cardName: 'Mountain', setCode: 'LEA', cardNumber: '292', amount: 26 },
    { cardName: 'Raging Goblin', setCode: 'M10', cardNumber: '153', amount: 2 },
    { cardName: 'Mountain', setCode: 'LEA', cardNumber: '292', amount: 26 },
  ],
  sideboard: [],
}

// Mazo del humano en los E2E de combate humano: tierras + Raging Goblin (1/1
// haste). ORDENADO para partidas deterministas (skipInitShuffling): mano inicial
// con 4 Mountain + 1 Goblin → el humano lanza el Goblin en el turno 1-2 y puede
// atacar ese mismo turno (haste) o bloquear el ataque del Sim.
// LEGAL en Construido (60 cartas, 4 copias máximo): ver DEFAULT_DECK.
export const COMBAT_HUMAN_DECK: Deck = {
  name: 'Mage Web combat human',
  cards: [
    { cardName: 'Mountain', setCode: 'LEA', cardNumber: '292', amount: 4 },
    { cardName: 'Raging Goblin', setCode: 'M10', cardNumber: '153', amount: 1 },
    { cardName: 'Mountain', setCode: 'LEA', cardNumber: '292', amount: 26 },
    { cardName: 'Raging Goblin', setCode: 'M10', cardNumber: '153', amount: 2 },
    { cardName: 'Mountain', setCode: 'LEA', cardNumber: '292', amount: 27 },
  ],
  sideboard: [],
}

// Mazo del oponente Sim en el E2E de bloqueo humano: tierras + Raging Goblin
// (1/1 haste) en la mano inicial. ORDENADO (skipInitShuffling): el Sim
// lanza el Goblin en su turno 1 y ataca SOLO con él cada turno (un atacante por
// combate → el bloqueo del humano es de asignación automática, sin GAME_TARGET).
// LEGAL en Construido (60 cartas, 4 copias máximo): ver DEFAULT_DECK.
export const COMBAT_BLOCK_SIM_DECK: Deck = {
  name: 'Mage Web block sim',
  cards: [
    { cardName: 'Mountain', setCode: 'LEA', cardNumber: '292', amount: 5 },
    { cardName: 'Raging Goblin', setCode: 'M10', cardNumber: '153', amount: 1 },
    { cardName: 'Mountain', setCode: 'LEA', cardNumber: '292', amount: 20 },
    { cardName: 'Raging Goblin', setCode: 'M10', cardNumber: '153', amount: 2 },
    { cardName: 'Mountain', setCode: 'LEA', cardNumber: '292', amount: 32 },
  ],
  sideboard: [],
}

// Mazo de verificación de Mutate contra el servidor real (beta.xmage.today):
// un objetivo no-Humano barato (Elvish Mystic, {G}) y criaturas mutate (Gemrazer,
// {3}{G}, mutate {1}{G}{G}) encima de él. ORDENADO para partidas deterministas
// (skipInitShuffling): la mano inicial es [Elvish Mystic, Gemrazer, 5 Forest] →
// turno 1 juega la tierra + Elvish, turno 2 muta Gemrazer sobre Elvish (la Elvish
// aporta el maná verde del coste).
export const MUTATE_DECK: Deck = {
  name: 'Mage Web mutate',
  cards: [
    { cardName: 'Elvish Mystic', setCode: 'm14', cardNumber: '169', amount: 1 },
    { cardName: 'Gemrazer', setCode: 'iko', cardNumber: '155', amount: 1 },
    { cardName: 'Forest', setCode: 'iko', cardNumber: '272', amount: 54 },
    { cardName: 'Elvish Mystic', setCode: 'm14', cardNumber: '169', amount: 2 },
    { cardName: 'Gemrazer', setCode: 'iko', cardNumber: '155', amount: 2 },
  ],
  sideboard: [],
}

export const DECKS = [DEFAULT_DECK, ADVANCED_DECK, STABLE_DECK, AI_OPPONENT_DECK, COMBAT_OPPONENT_DECK, COMBAT_HUMAN_DECK, COMBAT_BLOCK_SIM_DECK, LANDS_DECK, MUTATE_DECK]

/**
 * The curated REAL deck the LLM-vs-LLM preset and the SIM-vs-SIM demo seat:
 * 'Boros Burn' (GP Birmingham 2017 winner, `majors:Modern/16525_...`), from the
 * bundled mtgtop8 corpus — 60 main + 15 sideboard, creatures + cheap spells, so
 * early turns produce visible plays and games end by damage instead of deck-out.
 *
 * DEFAULT_DECK ('Mage Web bolt', 56 Mountain + 4 Bolt) is KEPT for the
 * deterministic e2e interaction harness (ordered skipInitShuffling opening
 * hand) but must never reach a live LLM/demo table: with real shuffling its
 * opening hand is all lands ≈60% of the time and the game is unwinnable.
 *
 * The deck is resolved FROM the bundled corpus BY NAME at runtime, never
 * duplicated here. `bundledCorpusDecks()` is empty until the lazy corpus asset
 * has landed (or when `VITE_BUNDLED_DECKS` disables it), so callers must handle
 * absence — `submitTable` falls through to the existing no-deck error path,
 * and `runDemoTable`/tests use the throwing wrapper below (fail-fast).
 */
export const PRESET_DEFAULT_DECK_NAME = 'Boros Burn'

/** The bundled corpus deck `PRESET_DEFAULT_DECK_NAME` picks (first match).
 *  Honours the `VITE_BUNDLED_DECKS` flag exactly like `bundledDecks()`: an
 *  operator who disabled built-in decks gets none of them as a preset default. */
export function findPresetDefaultDeck(): Deck | undefined {
  if (!bundledDecksEnabled()) return undefined
  return bundledCorpusDecks().find((d) => d.name === PRESET_DEFAULT_DECK_NAME)
}

/**
 * Fail-fast resolver: throws (with the deck name in the message) when the
 * bundled corpus doesn't carry `PRESET_DEFAULT_DECK_NAME`. Callers that run on
 * UI interaction paths should prefer `findPresetDefaultDeck()` and surface the
 * existing no-deck error instead of letting this throw.
 */
export function presetDefaultDeck(): Deck {
  const found = findPresetDefaultDeck()
  if (!found) {
    throw new Error(`preset default deck '${PRESET_DEFAULT_DECK_NAME}' not found in the bundled corpus (corpus disabled or not yet loaded; VITE_BUNDLED_DECKS must stay on)`)
  }
  return found
}

/**
 * Built-in decks ship in production builds too. They used to be gated on
 * `import.meta.env.DEV`, so a `npm run build` artifact shipped none of them and the
 * Decks Gallery and the Create Table seat-deck dropdown came up empty until the user
 * imported a deck. The gate is now an explicit build flag instead of the DEV/PROD mode:
 *
 *   VITE_BUNDLED_DECKS unset (or '1' / 'true')  => on  (the default: a plain `npm run build`
 *                                                       ships the decks, and `vite dev` keeps them)
 *   VITE_BUNDLED_DECKS '0' / 'false'            => off (an operator can build a deployment with
 *                                                       no built-in decks)
 *
 * Keying on an env var rather than `import.meta.env.DEV` also makes the behavior testable
 * (a vitest run can `vi.stubEnv('VITE_BUNDLED_DECKS', '0')`).
 */
export function bundledDecksEnabled(): boolean {
  const flag = (import.meta.env.VITE_BUNDLED_DECKS as string | undefined)?.trim().toLowerCase()
  return flag !== '0' && flag !== 'false'
}

/**
 * Built-in decks: the 9 sample decks that ship compiled in, plus the lazily
 * loaded 5,013-deck corpus (mtgtop8 majors + XMage samples — see
 * `decks/bundledDecks.ts`) once it has arrived. The corpus is empty until its
 * async load lands, so this stays synchronous and cheap for the login paint.
 */
export function bundledDecks(): Deck[] {
  if (!bundledDecksEnabled()) return []
  const corpus = bundledCorpusDecks()
  return corpus.length > 0 ? [...DECKS, ...corpus] : DECKS
}

/** Kick the lazy corpus load (idempotent, never throws). */
export async function ensureBundledDecksLoaded(): Promise<void> {
  if (!bundledDecksEnabled()) return
  try {
    await loadBundledCorpus()
  } catch {
    // the 9 sample decks still work; the corpus is a convenience
  }
}

/** How many corpus decks are in memory right now (0 before the load lands). */
export function bundledCorpusDeckCount(): number {
  return bundledCorpusDecks().length
}

export const CUSTOM_DECKS_STORAGE_KEY = 'mage_custom_decks'

export function loadSavedCustomDecks(): Deck[] {
  try {
    const raw = localStorage.getItem(CUSTOM_DECKS_STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as Deck[]
  } catch {
    return []
  }
}

export function saveCustomDecks(decks: Deck[]) {
  try {
    localStorage.setItem(CUSTOM_DECKS_STORAGE_KEY, JSON.stringify(decks))
  } catch {}
}

/** Referencia estable para selects/persistencia: id si existe, si no el nombre. */
export function deckRef(d: Deck): string {
  return d.id ?? d.name
}

/** Compara identidad de mazos: por id cuando ambos lo tienen; por nombre si a
 *  alguno le falta (mazos legacy/recién importados aún sin registrar). */
export function sameDeck(a: Deck | null | undefined, b: Deck | null | undefined): boolean {
  if (!a || !b) return false
  if (a.id && b.id) return a.id === b.id
  return a.name === b.name
}

export function getAllAvailableDecks(): Deck[] {
  const legacy = loadSavedCustomDecks()
  let v2: Deck[] = []
  try {
    const raw = localStorage.getItem('mage_decks_v2')
    if (raw) {
      const arr = JSON.parse(raw) as (Deck & { id?: string })[]
      if (Array.isArray(arr)) {
        v2 = arr.map((d) => ({ ...d, id: d.id || `v2:${d.name}` }))
      }
    }
  } catch {}
  // Los mazos v2 pisan a los legacy con el mismo nombre (migración), pero un
  // mazo del usuario NO debe ocultar a un precon con el mismo nombre: cada uno
  // conserva su id y ambos se pueden elegir.
  const v2Names = new Set(v2.map((d) => d.name))
  const decks: Deck[] = []
  // The compiled sample decks are tagged with the samples group here (the one
  // place that identifies them as bundled, next to their `precon:` id) so the
  // deck pickers keep them in their own section instead of mixing them into a
  // corpus library — see `decks/deckOrder.ts`.
  for (const d of bundledDecks()) decks.push({ ...d, id: d.id ?? `precon:${d.name}`, group: d.group ?? SAMPLE_DECKS_GROUP })
  const seenLegacy = new Set<string>()
  for (const d of legacy) {
    if (v2Names.has(d.name) || seenLegacy.has(d.name)) continue
    seenLegacy.add(d.name)
    decks.push({ ...d, id: d.id ?? `legacy:${d.name}` })
  }
  for (const d of v2) decks.push(d)
  return decks
}

export function getAllAvailableDecksV2Raw(): Deck[] {
  return getAllAvailableDecks()
}

/**
 * Async companion of `getAllAvailableDecks()`: waits for the lazy bundled
 * corpus, then returns the full list (samples + corpus + the user's decks). The
 * Create-Table seat picker and the Join dialog call this so the ~5,000 bundled
 * decks appear once they land instead of being missed by the first synchronous read.
 */
export async function getAllAvailableDecksAsync(): Promise<Deck[]> {
  await ensureBundledDecksLoaded()
  return getAllAvailableDecks()
}
