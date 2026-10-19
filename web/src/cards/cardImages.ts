import type { CardView } from '../net/types'
import { extractOwnedKeywords } from '../data/keywordExtractor'
import { cardArtPreference } from './artPreferences'
import { loadImageIndex, resolveKeyImage } from './offlineIndex'
import tokenImageData from '../data/tokenImages.generated.json'

const memory = new Map<string, string | null>()
const inflight = new Map<string, Promise<string | null>>()
const MAX_MEMORY_ENTRIES = 2000

/** Card metadata resolved from the offline image index (name + image URL). */
export interface ScryfallCardInfo {
  name: string
  typeLine: string
  manaCost: string
  power?: string
  toughness?: string
  imageUrl: string | null
}

const TOKEN_TABLE = tokenImageData as Record<string, string>
const tokenPins = new Map<string, string>()

const metaMemory = new Map<string, ScryfallCardInfo>()
const metaInflight = new Map<string, Promise<ScryfallCardInfo | null>>()

export function isAbilityCard(card: Pick<CardView, 'mageObjectType'>): boolean {
  const t = card.mageObjectType ?? ''
  return t.includes('Ability') || t.includes('ABILITY')
}

export function isTokenCard(card: CardView): boolean {
  return card.isToken === true || card.mageObjectType === 'TOKEN'
}

/** Returns true if the permanent/card has Vigilance (does not tap when attacking). */
export function hasVigilance(card: CardView | unknown): boolean {
  if (!card || typeof card !== 'object') return false
  const icons = (card as { cardIcons?: Array<{ cardIconType?: string } | null> }).cardIcons
  if (Array.isArray(icons) && icons.some((i) => i?.cardIconType === 'ABILITY_VIGILANCE')) return true
  return extractOwnedKeywords(card as CardView).some((k) => k.id === 'vigilance')
}

export function getSourceCardName(card: CardView): string {
  const src = card.sourceCard || card.ability
  if (src && src.name && !/^ability$/i.test(src.name)) {
    return src.displayName || src.name
  }
  if (card.displayName && !/^ability$/i.test(card.displayName)) {
    return card.displayName
  }
  if (card.name && !/^ability$/i.test(card.name)) {
    return card.name
  }
  const rules = card.rules ?? []
  for (const rule of rules) {
    if (!rule) continue
    const emDash = /^([A-Z0-9][A-Za-z0-9,'.\s/-]+?)\s+[—–-]\s+/.exec(rule)
    if (emDash && emDash[1].length < 40 && !/^(?:Target|Choose|Each|You|Tap|Sacrifice)/i.test(emDash[1])) {
      return emDash[1].trim()
    }
    const trigger = /^(?:When|Whenever|At the beginning of [^,]+,|As|If)\s+(.+?)\s+(?:enters(?: the battlefield)?|attacks|blocks|deals|dies|leaves(?: the battlefield)?|becomes|transforms|is put into|is dealt)/i.exec(rule)
    if (trigger && trigger[1].length < 45 && !/^(?:a|an|the|target|another|each|all|any)\s+/i.test(trigger[1])) {
      return trigger[1].trim()
    }
    const action = /^([A-Z][A-Za-z0-9,'.\s/-]+?)\s+(?:deals|gets|has|can't|enters|fights)\s+/i.exec(rule)
    if (action && action[1].length < 45 && !/^(?:This spell|This creature|Target|Each|You)\b/i.test(action[1])) {
      return action[1].trim()
    }
  }
  return 'Habilidad'
}

/** Face flags set on the client (split/flip renders, the inspector); the server view has none of them. */
type FaceFlags = { isSecondCardFace?: boolean; isBackFace?: boolean; isFrontFace?: boolean }

export function isCardBackFace(card: CardView & FaceFlags): boolean {
  if (card.isSecondCardFace === true || card.isBackFace === true) return true
  if (card.transformed === true && !card.isFrontFace) return true
  return false
}

function tokenImageName(card: CardView): string {
  const raw = card.imageFileName || card.displayName || card.name || ''
  return raw.replace(/\s+Token$/i, '').trim()
}

/**
 * Carta de Scryfall exacta de un token según la tabla del cliente de escritorio
 * de XMage (`SET/Nombre[/imageNumber]`): el motor manda set + `imageFileName` +
 * `imageNumber` y esa terna identifica la variante. Devuelve `set/coleccionista`
 * (con `#back` si es la cara trasera) o null si la tabla no la conoce.
 */
export function tokenTableKey(card: CardView, isBack: boolean): string | null {
  const set = (card.expansionSetCode ?? '').toUpperCase()
  if (!set) return null
  const name = tokenImageName(card)
  if (!name) return null
  const base = `${set}/${name}`
  const n = card.imageNumber ?? 0
  const lookups = (suffix: string) =>
    (n > 0 ? TOKEN_TABLE[`${base}/${n}${suffix}`] : undefined) ??
    TOKEN_TABLE[`${base}${suffix}`] ??
    (n > 0 ? undefined : TOKEN_TABLE[`${base}/1${suffix}`])
  const front = lookups('')
  const back = isBack || front === undefined ? lookups('#back') : undefined
  const hit = back ?? front
  if (!hit) return null
  return back !== undefined || isBack ? `${hit}#back` : hit
}

const HIDDEN_FACE_DOWN = /^(?:Morph|Manifest|Disguise|Cloak|Face Down|Foretell)\b[^:]*:\s*(.+)$/i

/**
 * Nombre real de un permanente boca abajo que el motor deja ver a su
 * controlador ("Morph: Den Protector"); null para el rival o si no hay.
 */
export function hiddenFaceDownName(card: CardView): string | null {
  if (card.faceDown !== true) return null
  const match = HIDDEN_FACE_DOWN.exec(card.displayName || card.name || '')
  const name = match?.[1]?.trim()
  return name || null
}

function faceDownArtKey(card: CardView): string | null {
  if ((card.expansionSetCode ?? '').toUpperCase() !== 'XMAGE' || !card.imageFileName) return null
  const exact = tokenTableKey(card, isCardBackFace(card))
  return exact ? pinTokenKey(card, exact) : null
}

/**
 * El motor puede elegir una variante distinta por cada token (p. ej. 15
 * Treasures con 4 artes distintos): la primera que se ve de cada jugador + set +
 * nombre + P/T se mantiene para todos los demás, así el mazo se ve unificado y
 * sigue respetando el set de la carta que el usuario eligió en su mazo.
 */
function pinTokenKey(card: CardView, key: string): string {
  const controller = card.controllerId
  if (!controller) return key
  const pin = [
    controller,
    (card.expansionSetCode ?? '').toUpperCase(),
    tokenImageName(card).toLowerCase(),
    card.power ?? '',
    card.toughness ?? '',
    key.endsWith('#back') ? 'back' : 'front',
  ].join('|')
  const pinned = tokenPins.get(pin)
  if (pinned) return pinned
  tokenPins.set(pin, key)
  return key
}

export function cardKey(card: CardView): string | null {
  if (card.faceDown === true) return faceDownArtKey(card)
  const isBack = isCardBackFace(card)
  const backSuffix = isBack ? '#back' : ''

  const isAbility = isAbilityCard(card)
  if (isAbility) {
    const src = card.sourceCard || card.ability
    if (src) {
      const srcKey = cardKey(src)
      if (srcKey) return srcKey
    }
    const sourceName = getSourceCardName(card)
    if (sourceName && !/^habilidad$/i.test(sourceName) && !/^ability$/i.test(sourceName)) {
      return `named:${sourceName}${backSuffix}`
    }
    return null
  }

  const set = card.expansionSetCode
  const num = card.cardNumber
  const isToken = isTokenCard(card)

  if (isToken) {
    const exact = tokenTableKey(card, isBack)
    if (exact) return pinTokenKey(card, exact)
  }

  if (!isToken) {
    const preferred = cardArtPreference(card.name)
    if (preferred) return `${preferred.setCode}/${preferred.cardNumber}${backSuffix}`
  }

  // Cards with a real card number (including copy tokens that inherited the original's number)
  if (set && num && num !== '0') {
    return `${set}/${num}${backSuffix}`
  }

  // Token with cardNumber=0 — resolve via the token art table (t-set + slug)
  if (isToken) {
    if (!set || set === 'XMAGE') return null
    const name = card.displayName || card.name || ''
    if (!name) return null
    const tokenSet = 't' + set.toLowerCase()
    // Strip " Token" suffix for the token table lookup (e.g. "Goblin Token" → "goblin")
    const stripped = name.replace(/\s+Token$/i, '')
    const slug = stripped.replace(/\s+/g, '-').toLowerCase()
    return `${tokenSet}/${slug}`
  }

  // Card with only a name (e.g. from game log feed or action history or reminder tokens)
  const name = card.displayName || card.name
  if (name && name.trim()) {
    return `named:${name.trim()}${backSuffix}`
  }

  return null
}

/** Imagen ya resuelta y en memoria (sin red), o null. */
export function peekImageUrl(key: string | null): string | null {
  if (!key) return null
  return memory.get(key) ?? null
}

/** Variante grande (672×936) de una URL CDN de Scryfall, para la inspección a tamaño completo. */
export function largeImageUrl(url: string | null): string | null {
  if (!url) return null
  return url.replace(/\/(?:normal|small)\//, '/large/')
}

function scryfallKey(setCode: string, cardNumber: string): string | null {
  if (!setCode || !cardNumber || cardNumber === '0') return null
  return `${setCode}/${cardNumber}`
}

async function load(key: string): Promise<string | null> {
  const index = await loadImageIndex()
  const hit = resolveKeyImage(index, key, 'normal')
  return hit ? hit.url : null
}

export async function awaitImageUrl(card: CardView): Promise<string | null> {
  const key = cardKey(card)
  if (!key) return null
  const cached = memory.get(key)
  if (cached !== undefined) return cached
  const current = inflight.get(key)
  if (current) return current

  const name = card.displayName || card.name
  const cleanName = name && !/^ability$/i.test(name) && !/^habilidad$/i.test(name) ? name.trim() : null

  const p = (async () => {
    let url = await load(key).catch(() => null)
    if (!url && cleanName && !key.replace(/#back$/, '').startsWith('named:')) {
      const isBack = key.endsWith('#back')
      const fallbackKey = `named:${cleanName}${isBack ? '#back' : ''}`
      url = await load(fallbackKey).catch(() => null)
    }
    if (url) {
      try {
        const img = new Image()
        img.src = url
        await img.decode()
      } catch {}
    }
    remember(key, url)
    return url
  })().finally(() => {
    if (inflight.get(key) === p) inflight.delete(key)
  })

  inflight.set(key, p)
  return p
}

/**
 * Metadata already in memory, no network and no wait. For read-only surfaces that
 * must paint on the same frame they receive a view (the top-card peek): a hit gives
 * the name instantly, a miss means "paint without a name", never "paint `undefined`".
 */
export function peekCardMeta(setCode: string | undefined, cardNumber: string | undefined): ScryfallCardInfo | null {
  const key = scryfallKey(setCode ?? '', cardNumber ?? '')
  if (!key) return null
  return metaMemory.get(key) ?? null
}

/**
 * Async version: waits for the metadata to be resolved.
 */
export async function awaitCardMeta(setCode: string, cardNumber: string): Promise<ScryfallCardInfo | null> {
  const key = scryfallKey(setCode, cardNumber)
  if (!key) return null
  const cached = metaMemory.get(key)
  if (cached) return cached
  const pending = metaInflight.get(key)
  if (pending) return pending

  const p = (async (): Promise<ScryfallCardInfo | null> => {
    const index = await loadImageIndex()
    const hit = resolveKeyImage(index, key, 'normal')
    if (!hit) return null
    const info: ScryfallCardInfo = {
      name: hit.name ?? key,
      typeLine: '',
      manaCost: '',
      imageUrl: hit.url,
    }
    metaMemory.set(key, info)
    return info
  })()
    .catch(() => null)
    .finally(() => {
      if (metaInflight.get(key) === p) metaInflight.delete(key)
    })

  metaInflight.set(key, p)
  return p
}

function remember(key: string, url: string | null) {
  if (url === null) {
    memory.delete(key)
    return
  }
  memory.delete(key)
  memory.set(key, url)
  while (memory.size > MAX_MEMORY_ENTRIES) {
    const oldest = memory.keys().next().value as string | undefined
    if (!oldest) break
    memory.delete(oldest)
  }
}

/** Solo para tests y para limpiar el estado al desmontar una sesión local. */
export function resetCardImageCache() {
  memory.clear()
  inflight.clear()
  metaMemory.clear()
  metaInflight.clear()
  tokenPins.clear()
}

export function cardName(card: CardView): string {
  if (isAbilityCard(card)) {
    return getSourceCardName(card)
  }
  return card.displayName || card.name || card.alternateName || '?'
}
