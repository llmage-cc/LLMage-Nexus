import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { awaitImageUrl, awaitCardMeta, resetCardImageCache, cardKey, hasVigilance, hiddenFaceDownName, largeImageUrl } from './cardImages'
import { resetCardArtPreferences, setCardArtPreference } from './artPreferences'
import { setImageIndexForTests, type ScryfallImageIndex } from './offlineIndex'
import type { CardView } from '../net/types'

const UUID_FOREST = '1e6f9b5e-1111-4222-8333-944440555666'
const UUID_BOLT = '435589bb-27c6-4a6d-9d63-394d5092b9d8'
const UUID_DELVER = '11bf83bb-c95b-4b4f-9a56-ce7a1816307a'
const UUID_GOBLIN = 'b27dc0bd-ba46-4a5c-9559-7c11eb4ec37b'
const UUID_GOBLIN_TSET_MISS = 'aaaabbbb-cccc-4ddd-8eee-ffff00001111'

/** Index fixture mirroring what the builder ships (sampled). */
function index(): ScryfallImageIndex {
  return {
    cards: {
      Forest: UUID_FOREST,
      'Lightning Bolt': UUID_BOLT,
      'Delver of Secrets': UUID_DELVER,
      'Insectile Aberration': UUID_DELVER,
      'Goblin Token': UUID_GOBLIN_TSET_MISS,
    },
    backs: new Set(['Delver of Secrets']),
    printings: {
      'lea/299': [UUID_FOREST, 'Forest'],
      'm10/146': [UUID_BOLT, 'Lightning Bolt'],
      'm10/147': [UUID_BOLT, 'Lightning Bolt'],
      'isd/51': [UUID_DELVER, 'Delver of Secrets'],
      'tgrn/4': [UUID_GOBLIN, 'Goblin'],
    },
    tokenArts: {
      Goblin: [{ id: UUID_GOBLIN, set: 'tgrn', num: '4', released: '2018-10-05' }],
    },
  }
}

const card = {
  name: 'Forest',
  expansionSetCode: 'LEA',
  cardNumber: '299',
} as CardView

describe('card image resolution (offline index)', () => {
  beforeEach(() => {
    resetCardImageCache()
    resetCardArtPreferences()
    setImageIndexForTests(index())
    vi.restoreAllMocks()
  })
  afterEach(() => {
    setImageIndexForTests(null)
  })

  it('resolves a card through the offline index without any network call', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(awaitImageUrl(card)).resolves.toBe(`https://cards.scryfall.io/normal/front/1/e/${UUID_FOREST}.jpg`)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('deduplicates concurrent resolutions and caches the result', async () => {
    const [first, second] = [awaitImageUrl(card), awaitImageUrl(card)]
    const firstUrl = await first
    expect(firstUrl).toBeTruthy()
    await expect(second).resolves.toBe(firstUrl)
    await expect(awaitImageUrl(card)).resolves.toBe(firstUrl)
  })

  it('returns null for a map miss instead of hitting the API', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const unknown = { name: 'Totally Unknown Card', expansionSetCode: 'ZZZ', cardNumber: '1' } as CardView

    await expect(awaitImageUrl(unknown)).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falls back to the name when the printing is not in the map', async () => {
    const unknownPrinting = {
      name: 'Lightning Bolt',
      expansionSetCode: 'UNKNOWN_SET',
      cardNumber: '999',
    } as CardView

    await expect(awaitImageUrl(unknownPrinting)).resolves.toBe(`https://cards.scryfall.io/normal/front/4/3/${UUID_BOLT}.jpg`)
  })

  it('resolves card metadata through the index (sideboard names)', async () => {
    await expect(awaitCardMeta('M10', '146')).resolves.toEqual({
      name: 'Lightning Bolt',
      typeLine: '',
      manaCost: '',
      imageUrl: `https://cards.scryfall.io/normal/front/4/3/${UUID_BOLT}.jpg`,
    })
    await expect(awaitCardMeta('ZZZ', '1')).resolves.toBeNull()
    await expect(awaitCardMeta('', '146')).resolves.toBeNull()
  })
})

describe('face-down and engine-owned images', () => {
  beforeEach(() => {
    resetCardImageCache()
    setImageIndexForTests(index())
  })
  afterEach(() => {
    setImageIndexForTests(null)
  })

  const faceDown = (over: Record<string, unknown> = {}) =>
    ({ name: 'Morph: Den Protector', faceDown: true, expansionSetCode: 'XMAGE', cardNumber: '0', imageFileName: 'Morph', imageNumber: 2, controllerId: 'p1', ...over }) as unknown as CardView

  it('resolves a face-down permanent to the engine face-down image instead of nothing', () => {
    expect(cardKey(faceDown())).toBe('ta25/15')
    expect(cardKey(faceDown({ imageFileName: 'Manifest', imageNumber: 3 }))).toBe('tdsk/18')
    expect(cardKey(faceDown({ imageFileName: 'Cloak', imageNumber: 1 }))).toBe('tmkm/21')
  })

  it('keeps hidden hand cards without art', () => {
    expect(cardKey({ name: '?', faceDown: true, expansionSetCode: '', cardNumber: '0' } as unknown as CardView)).toBeNull()
  })

  it('resolves the engine Copy and Night images', () => {
    expect(cardKey({ name: 'Copy', expansionSetCode: 'XMAGE', imageFileName: 'Copy', imageNumber: 6, isToken: true } as unknown as CardView)).toBe('tlci/1')
    expect(cardKey({ name: 'Night', expansionSetCode: 'XMAGE', imageFileName: 'Night', imageNumber: 1, isToken: true } as unknown as CardView)).toBe('tvow/21#back')
  })

  it('exposes the real name the engine reveals to the controller', () => {
    expect(hiddenFaceDownName(faceDown())).toBe('Den Protector')
    expect(hiddenFaceDownName(faceDown({ name: 'Disguise: Unyielding Gatekeeper' }))).toBe('Unyielding Gatekeeper')
    expect(hiddenFaceDownName(faceDown({ name: '' }))).toBeNull()
    expect(hiddenFaceDownName(faceDown({ faceDown: false }))).toBeNull()
  })
})

describe('token image resolution', () => {
  beforeEach(() => {
    resetCardImageCache()
    setImageIndexForTests(index())
    vi.restoreAllMocks()
  })
  afterEach(() => {
    setImageIndexForTests(null)
  })

  it('resolves a token to the exact Scryfall card from the engine table (set + name)', () => {
    const token = { name: 'Goblin Token', expansionSetCode: 'GRN', cardNumber: '0', isToken: true } as CardView
    expect(cardKey(token)).toBe('tgrn/4')
  })

  it('prefers imageFileName over the display name when the engine sends it', () => {
    const token = { name: 'Treasure Token', imageFileName: 'Treasure', expansionSetCode: 'LCI', cardNumber: '', isToken: true } as CardView
    expect(cardKey(token)).toBe('tlci/18')
  })

  it('uses imageNumber to pick the variant inside a set', () => {
    const base = { name: 'Treasure Token', imageFileName: 'Treasure', expansionSetCode: 'XLN', cardNumber: '', isToken: true }
    expect(cardKey({ ...base, imageNumber: 1 } as CardView)).toBe('txln/7')
    expect(cardKey({ ...base, imageNumber: 3 } as CardView)).toBe('txln/9')
    expect(cardKey({ ...base } as CardView)).toBe('txln/7')
  })

  it('never confuses a Treasure with the Dinosaur token of the same set', () => {
    const treasure = { name: 'Treasure Token', imageFileName: 'Treasure', expansionSetCode: 'LCI', isToken: true } as CardView
    const dino = { name: 'Dinosaur Token', imageFileName: 'Dinosaur', imageNumber: 1, expansionSetCode: 'LCI', isToken: true } as CardView
    expect(cardKey(treasure)).not.toBe(cardKey(dino))
    expect(cardKey(dino)).toBe('tlci/10')
  })

  it('pins the first variant seen per controller so all copies share one art', () => {
    const treasure = (id: string, imageNumber: number, controllerId: string) =>
      ({ id, name: 'Treasure Token', imageFileName: 'Treasure', imageNumber, expansionSetCode: 'XLN', isToken: true, controllerId }) as CardView
    expect(cardKey(treasure('a', 2, 'p1'))).toBe('txln/8')
    expect(cardKey(treasure('b', 4, 'p1'))).toBe('txln/8')
    expect(cardKey(treasure('c', 3, 'p1'))).toBe('txln/8')
    expect(cardKey(treasure('d', 4, 'p2'))).toBe('txln/10')
  })

  it('keeps tokens of different sets of the same controller apart (deck printings are respected)', () => {
    const treasure = (set: string) =>
      ({ name: 'Treasure Token', imageFileName: 'Treasure', expansionSetCode: set, isToken: true, controllerId: 'p1' }) as CardView
    expect(cardKey(treasure('LCI'))).toBe('tlci/18')
    expect(cardKey(treasure('RNA'))).toBe('trna/12')
  })

  it('resolves the back face of a double-faced token', () => {
    const token = { name: 'Goblin Token', imageFileName: 'Goblin', expansionSetCode: 'GK1', isToken: true, isSecondCardFace: true } as unknown as CardView
    expect(cardKey(token)).toBe('tgk1/3#back')
  })

  it('falls back to the name slug when the set is not in the engine table', () => {
    const token = { name: 'Goblin Token', expansionSetCode: 'ZZZ', cardNumber: '0', isToken: true } as CardView
    expect(cardKey(token)).toBe('tzzz/goblin')
  })

  it('returns null for XMAGE set tokens (special/helper)', () => {
    const token = { name: 'Face Down', expansionSetCode: 'XMAGE', cardNumber: '0', isToken: true } as CardView
    expect(cardKey(token)).toBeNull()
  })

  it('copy token uses original card number for standard lookup', () => {
    // Copy token inherits the original's set + number (not "0")
    const copy = { name: 'Lightning Bolt', expansionSetCode: 'M10', cardNumber: '147', isToken: true } as unknown as CardView
    expect(cardKey(copy)).toBe('M10/147')
  })

  it('returns null for token without setCode', () => {
    const token = { name: 'Goblin Token', cardNumber: '0', isToken: true } as CardView
    expect(cardKey(token)).toBeNull()
  })

  it('returns null for token without name', () => {
    const token = { expansionSetCode: 'GRN', cardNumber: '0', isToken: true } as CardView
    expect(cardKey(token)).toBeNull()
  })

  it('returns null for face-down token with no identifiable name', () => {
    const token = { expansionSetCode: 'XMAGE', cardNumber: '0', isToken: true } as CardView
    expect(cardKey(token)).toBeNull()
  })

  it('resolves the engine-table token through its t-set printing without any network call', async () => {
    const token = { name: 'Goblin Token', expansionSetCode: 'GRN', cardNumber: '0', isToken: true } as CardView
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(awaitImageUrl(token)).resolves.toBe(`https://cards.scryfall.io/normal/front/b/2/${UUID_GOBLIN}.jpg`)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falls back to the token art table when the t-set printing is unknown', async () => {
    const token = { name: 'Goblin Token', expansionSetCode: 'ZZZ', cardNumber: '0', isToken: true } as CardView
    await expect(awaitImageUrl(token)).resolves.toBe(`https://cards.scryfall.io/normal/front/b/2/${UUID_GOBLIN}.jpg`)
  })

  it('renders no image (placeholder) when neither the printing, the token table nor the name knows the card', async () => {
    const token = { name: 'Weird Token', expansionSetCode: 'ZZZ', cardNumber: '0', isToken: true } as CardView
    await expect(awaitImageUrl(token)).resolves.toBeNull()
  })
})

describe('ability image and metadata resolution', () => {
  beforeEach(() => {
    resetCardImageCache()
    setImageIndexForTests(index())
    vi.restoreAllMocks()
  })
  afterEach(() => {
    setImageIndexForTests(null)
  })

  it('builds named Scryfall key for triggered ability card', () => {
    const ability = {
      name: 'Goblin Guide',
      mageObjectType: 'TRIGGERED_ABILITY',
      rules: ['Whenever Goblin Guide attacks, defending player reveals the top card of library.'],
    } as CardView
    expect(cardKey(ability)).toBe('named:Goblin Guide')
  })

  it('extracts source card name from rules when card name is "Ability"', () => {
    const ability = {
      name: 'Ability',
      mageObjectType: 'TRIGGERED_ABILITY',
      rules: ['When Cloud, Midgar Mercenary enters, search your library for an Equipment card, reveal it, put it into your hand, then shuffle.'],
    } as CardView
    expect(cardKey(ability)).toBe('named:Cloud, Midgar Mercenary')
  })

  it('uses sourceCard object when present on StackAbilityView', () => {
    const ability = {
      name: 'Ability',
      mageObjectType: 'TRIGGERED_ABILITY',
      sourceCard: {
        name: 'Dark Confidant',
        expansionSetCode: 'RAV',
        cardNumber: '81',
      },
      rules: ['At the beginning of your upkeep, reveal the top card of your library...'],
    } as unknown as CardView
    expect(cardKey(ability)).toBe('RAV/81')
  })

  it('builds named Scryfall key for cards with only a name (e.g. from action feed)', () => {
    const feedCard = { name: 'Lightning Bolt' } as CardView
    expect(cardKey(feedCard)).toBe('named:Lightning Bolt')
  })

  it('resolves an ability image through the source card', async () => {
    const ability = {
      name: 'Ability',
      mageObjectType: 'TRIGGERED_ABILITY',
      sourceCard: { name: 'Lightning Bolt', expansionSetCode: 'M10', cardNumber: '146' },
      rules: ['Lightning Bolt deals 3 damage to any target.'],
    } as unknown as CardView
    await expect(awaitImageUrl(ability)).resolves.toBe(`https://cards.scryfall.io/normal/front/4/3/${UUID_BOLT}.jpg`)
  })
})

describe('double-faced and transform card resolution', () => {
  beforeEach(() => {
    resetCardImageCache()
    setImageIndexForTests(index())
    vi.restoreAllMocks()
  })
  afterEach(() => {
    setImageIndexForTests(null)
  })

  it('builds distinct cardKeys for front face and second/back face', () => {
    const front = {
      name: 'Delver of Secrets',
      expansionSetCode: 'ISD',
      cardNumber: '51',
    } as unknown as CardView

    const back = {
      name: 'Insectile Aberration',
      expansionSetCode: 'ISD',
      cardNumber: '51',
      isSecondCardFace: true,
    } as unknown as CardView

    expect(cardKey(front)).toBe('ISD/51')
    expect(cardKey(back)).toBe('ISD/51#back')
  })

  it('resolves front and back face CDN urls from the same uuid', async () => {
    const front = {
      name: 'Delver of Secrets',
      expansionSetCode: 'ISD',
      cardNumber: '51',
    } as unknown as CardView

    const back = {
      name: 'Insectile Aberration',
      expansionSetCode: 'ISD',
      cardNumber: '51',
      isSecondCardFace: true,
    } as unknown as CardView

    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(awaitImageUrl(front)).resolves.toBe(`https://cards.scryfall.io/normal/front/1/1/${UUID_DELVER}.jpg`)
    await expect(awaitImageUrl(back)).resolves.toBe(`https://cards.scryfall.io/normal/back/1/1/${UUID_DELVER}.jpg`)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('card art preference', () => {
  beforeEach(() => {
    resetCardImageCache()
    resetCardArtPreferences()
    setImageIndexForTests(index())
  })
  afterEach(() => {
    setImageIndexForTests(null)
  })

  it('la preferencia del jugador gana a la impresión de la vista, también en cartas del rival', () => {
    setCardArtPreference('Lightning Bolt', 'LEA', '161')
    const mine = { name: 'Lightning Bolt', expansionSetCode: 'M10', cardNumber: '146' } as CardView
    const rivals = { name: 'Lightning Bolt', expansionSetCode: '2XM', cardNumber: '130' } as CardView
    expect(cardKey(mine)).toBe('LEA/161')
    expect(cardKey(rivals)).toBe('LEA/161')
  })

  it('no aplica a tokens ni a cartas boca abajo', () => {
    setCardArtPreference('Forest', 'ZEN', '246')
    const token = { name: 'Forest', expansionSetCode: 'M10', cardNumber: '246', isToken: true, mageObjectType: 'TOKEN' } as CardView
    expect(cardKey(token)).not.toBe('ZEN/246')
    const morph = { name: 'Forest', faceDown: true } as CardView
    expect(cardKey(morph)).not.toBe('ZEN/246')
  })
})

describe('hasVigilance', () => {
  it('detects vigilance in rules text with word boundaries', () => {
    expect(hasVigilance({ name: 'Oakheaven Sentinel', rules: ['Vigilance'] } as unknown as CardView)).toBe(true)
    expect(hasVigilance({ name: 'Centaur Courser', rules: ['Vigilance, trample'] } as unknown as CardView)).toBe(true)
  })

  it('detects vigilance in ability objects', () => {
    expect(
      hasVigilance({ name: 'Yosei', abilities: [{ rule: 'Vigilance' }] } as unknown as CardView)
    ).toBe(true)
  })

  it('does not match partial words or unrelated text', () => {
    expect(hasVigilance({ name: 'Vigilant Sentry', rules: ["Attacking doesn't cause this to tap"] } as unknown as CardView)).toBe(false)
    expect(hasVigilance({ name: 'Goblin Piledriver', rules: ['Provoke'] } as unknown as CardView)).toBe(false)
  })

  it('ignores vigilance mentioned inside another ability', () => {
    expect(
      hasVigilance({ name: 'Healer of the Pride', rules: ['<i>Heroic</i> &mdash; Whenever you cast a spell that targets {this}, create a 1/1 white Cat Soldier creature token with vigilance.'] } as unknown as CardView)
    ).toBe(false)
  })

  it('trusts the server ABILITY_VIGILANCE icon', () => {
    expect(hasVigilance({ name: 'X', rules: [], cardIcons: [{ cardIconType: 'ABILITY_VIGILANCE' }] } as unknown as CardView)).toBe(true)
  })

  it('returns false for null/undefined or cards without text', () => {
    expect(hasVigilance(null)).toBe(false)
    expect(hasVigilance(undefined)).toBe(false)
    expect(hasVigilance({} as CardView)).toBe(false)
  })
})

describe('largeImageUrl', () => {
  it('upgrades the normal and small CDN paths to large', () => {
    expect(largeImageUrl('https://cards.scryfall.io/normal/front/a/b/c.jpg?1')).toBe('https://cards.scryfall.io/large/front/a/b/c.jpg?1')
    expect(largeImageUrl('https://cards.scryfall.io/small/front/a/b/c.jpg')).toBe('https://cards.scryfall.io/large/front/a/b/c.jpg')
  })

  it('leaves other sizes and null untouched', () => {
    expect(largeImageUrl('https://cards.scryfall.io/art_crop/front/a/b/c.jpg')).toBe('https://cards.scryfall.io/art_crop/front/a/b/c.jpg')
    expect(largeImageUrl(null)).toBeNull()
  })
})
