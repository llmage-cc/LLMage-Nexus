import { useEffect, useState, useMemo, type ReactNode } from 'react'
import Chip from '../ui/Chip'
import type { MetaDeckItem } from './metaDeckCatalog'
import { META_DECK_CATALOG } from './metaDeckCatalog'
import { DeckInspectorModal } from './DeckInspectorModal'
import { colorIdentityFromCards, type DeckFormat, type DeckV2 } from './types'
import { ALL_FORMATS } from './formatRules'
import { ManaPip } from './ArenaManaSymbols'
import Icon from '../ui/Icon'
import { clickableProps } from '../ui/clickable'
import { useTranslation } from '../i18n'
import { useCardArtUrl } from './useCardArtUrl'
import { ensureBundledDecksLoaded, type Deck, type DeckCard } from '../lobby/decks'
import { bundledCorpusDecks } from './bundledDecks'
import './DeckBrowser.css'
import Button from '../ui/Button'

const KNOWN_FORMATS = new Set<string>(ALL_FORMATS)

/** Bounds the rendered result boxes (mirrors the gallery's GALLERY_RENDER_CAP):
 *  a corpus-sized grid hangs the page, so render the first N and let the refine
 *  hint + search narrow it. */
const BROWSER_RENDER_CAP = 200

/** A bundled-corpus deck as the browser's curated card shape. The corpus carries
 *  no archetype, so it is classified as `Precon`; its library (`group`) doubles as
 *  the format chip when it names one. */
function corpusDeckToItem(d: Deck): MetaDeckItem {
  const group = d.group ?? ''
  return {
    id: d.id ?? `corpus:${d.name}`,
    name: d.name,
    format: (KNOWN_FORMATS.has(group) ? group : 'Freeform') as DeckFormat,
    archetype: 'Precon',
    colors: colorIdentityFromCards(d.cards),
    coverCard: d.cards[0] ?? { cardName: d.name, setCode: '', cardNumber: '', amount: 0 },
    description: KNOWN_FORMATS.has(group) ? '' : group,
    cards: d.cards,
    sideboard: d.sideboard,
  }
}

function BrowserDeckArt({ cover, children }: { cover: DeckCard; children: ReactNode }) {
  const artUrl = useCardArtUrl(cover)
  return (
    <div className="browser-deck-art-header" style={artUrl ? { backgroundImage: `url(${artUrl})` } : undefined}>
      {children}
    </div>
  )
}

export function DeckBrowser({
  onCloneDeck,
  onOpenBuilder,
}: {
  onCloneDeck: (deck: MetaDeckItem | DeckV2) => Promise<DeckV2 | void>
  onOpenBuilder: (deckId: string) => void
}) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [formatFilter, setFormatFilter] = useState<string>('All Formats')
  const [archetypeFilter, setArchetypeFilter] = useState<string>('All Archetypes')
  const [colorFilter, setColorFilter] = useState<Set<string>>(new Set())
  const [inspectingDeck, setInspectingDeck] = useState<MetaDeckItem | null>(null)
  const [corpus, setCorpus] = useState<Deck[]>(() => bundledCorpusDecks())

  // The ~5,000-deck corpus lands lazily off the login path; when it does, its
  // decks become searchable here too (see `results`).
  useEffect(() => {
    let cancelled = false
    void ensureBundledDecksLoaded().then(() => {
      if (!cancelled) setCorpus(bundledCorpusDecks())
    })
    return () => { cancelled = true }
  }, [])

  const toggleColor = (c: string) => {
    const next = new Set(colorFilter)
    if (next.has(c)) next.delete(c)
    else next.add(c)
    setColorFilter(next)
  }

  const results = useMemo(() => {
    const query = search.trim().toLowerCase()
    const matchQuery = (d: { name: string; cards: DeckCard[] }): boolean =>
      !query || d.name.toLowerCase().includes(query) || d.cards.some((c) => c.cardName.toLowerCase().includes(query))
    const passFilters = (d: MetaDeckItem): boolean =>
      (formatFilter === 'All Formats' || d.format === formatFilter) &&
      (archetypeFilter === 'All Archetypes' || d.archetype === archetypeFilter) &&
      (colorFilter.size === 0 || [...colorFilter].every((c) => d.colors.includes(c as never)))

    const catalog = META_DECK_CATALOG.filter((d) => matchQuery(d) && passFilters(d))
    // The curated catalog stays the default list: only a search reaches into the
    // bundled corpus, so the pane is never drowned by 5,000 boxes.
    if (!query) return catalog
    const corpusMatches = corpus
      .filter((d) => matchQuery(d))
      .map(corpusDeckToItem)
      .filter(passFilters)
    return [...catalog, ...corpusMatches]
  }, [search, formatFilter, archetypeFilter, colorFilter, corpus])

  const shown = results.slice(0, BROWSER_RENDER_CAP)

  const handleCopy = async (deck: MetaDeckItem | DeckV2) => {
    await onCloneDeck(deck)
  }

  const handleEdit = async (deck: MetaDeckItem | DeckV2) => {
    const cloned = await onCloneDeck(deck)
    onOpenBuilder(cloned?.id ?? deck.id)
  }

  return (
    <div className="deck-browser-container">
      {/* Filters Bar */}
      <div className="browser-filters-bar">
        <div className="browser-search-wrap">
          <input
            className="browser-search-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('common', 'search')}
          />
        </div>

        <select
          value={formatFilter}
          onChange={(e) => setFormatFilter(e.target.value)}
          className="browser-select"
        >
          <option value="All Formats">{t('decks', 'filter_all_formats')}</option>
          {ALL_FORMATS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>

        <select
          value={archetypeFilter}
          onChange={(e) => setArchetypeFilter(e.target.value)}
          className="browser-select"
        >
          <option value="All Archetypes">{t('common', 'all')}</option>
          <option value="Aggro">{t('decks', 'browser_filter_aggro')}</option>
          <option value="Midrange">{t('decks', 'browser_filter_midrange')}</option>
          <option value="Control">{t('decks', 'browser_filter_control')}</option>
          <option value="Combo">{t('decks', 'browser_filter_combo')}</option>
          <option value="Ramp">{t('decks', 'browser_filter_ramp')}</option>
          <option value="Tribal">{t('decks', 'browser_filter_tribal')}</option>
          <option value="Precon">{t('decks', 'browser_filter_precon')}</option>
        </select>

        <div className="deck-browser-colors">
          {(['W', 'U', 'B', 'R', 'G'] as const).map((c) => (
            <button
              key={c}
              type="button"
              className={`mana-filter-btn ${colorFilter.has(c) ? 'active' : ''} pip-${c.toLowerCase()}`}
              onClick={() => toggleColor(c)}
              title={`${t('decks', 'filter_cmc')} ${c}`}
            >
              <ManaPip symbol={c} size={16} />
            </button>
          ))}
        </div>
      </div>

      {/* Decks Grid */}
      <div className="browser-decks-grid">
        {shown.map((deck) => {
          const cover = deck.coverCard

          return (
            <div
              key={deck.id}
              className="browser-deck-card"
              onClick={() => setInspectingDeck(deck)}
              {...clickableProps(() => setInspectingDeck(deck))}
            >
              {/* Card Art Header */}
              <BrowserDeckArt cover={cover}>
                <div className="browser-deck-art-gradient" />
                <div className="browser-deck-badges-overlay">
                  <Chip solid tone="gold" pill>{deck.format}</Chip>
                  <Chip tone="brand" pill>{deck.archetype}</Chip>
                </div>
              </BrowserDeckArt>

              {/* Content */}
              <div className="browser-deck-content">
                <h3 className="browser-deck-name" title={deck.name}>
                  {deck.name}
                </h3>
                <p className="browser-deck-desc">{deck.description}</p>

                <div className="browser-deck-actions" onClick={(e) => e.stopPropagation()}>
                  <Button variant="subtle" size="sm" className="browser-deck-btn" onClick={() => setInspectingDeck(deck)}>
                    <Icon name="eye" size={12} /> {t('common', 'search')}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    className="browser-deck-btn"
                    onClick={() => handleCopy(deck)}
                  >
                    <Icon name="copy" size={12} /> {t('common', 'copy')}
                  </Button>
                </div>
              </div>
            </div>
          )
        })}
        {results.length > BROWSER_RENDER_CAP && (
          <p className="decks-truncated-hint" role="status" data-testid="decks-browser-truncated-hint">
            {t('decks', 'decks_truncated_hint', { shown: String(BROWSER_RENDER_CAP), total: String(results.length) })}
          </p>
        )}
      </div>

      {/* Deck Inspection Modal */}
      {inspectingDeck && (
        <DeckInspectorModal
          deck={inspectingDeck}
          onClose={() => setInspectingDeck(null)}
          onCopy={handleCopy}
          onEdit={handleEdit}
        />
      )}
    </div>
  )
}
