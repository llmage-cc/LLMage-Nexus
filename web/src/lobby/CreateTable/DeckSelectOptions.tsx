import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from '../../i18n'
import Field from '../../ui/Field'
import ChipButton from '../../ui/ChipButton'
import { deckRef, type Deck } from '../decks'
import {
  ALL_EVENTS,
  buildDeckPickerTree,
  deckPickerEvents,
  deckPickerFormatFor,
  deckPickerListSections,
  defaultDeckPickerSelection,
  type DeckPickerCategory,
} from '../../decks/deckPickerTree'

/** `<option key>` for the "no format" bucket (an empty key would collide with the sentinels). */
const NO_FORMAT_KEY = '__no_format__'

export interface DeckSelectOptionsProps {
  /** The merged deck list (the player's own decks + the bundled samples + corpus). */
  decks: Deck[]
  /** The option text for one deck (the call site keeps its own card-count suffix). */
  label: (deck: Deck) => string
  /** The `<select>`'s controlled value (`deckRef`) and its change handler. */
  value?: string
  onChange?: (ref: string) => void
  disabled?: boolean
  /** `data-testid` of the deck `<select>`; the cascade's own controls append `-own`/`-builtin`/`-format`/`-tournament`. */
  testid?: string
  /** The wizard field's label: the deck `<select>` keeps its own `<label>`. */
  fieldLabel: ReactNode
  /** The create-table form's selected deck type — the format tier's default. */
  currentFormat?: string
  /** Extra class on the picker's root (the call site's layout hook, e.g. spacing). */
  className?: string
}

/**
 * The Create-Table wizard's deck control, tiered the way the webui this port
 * replaces tiered its built-in picker (one flat ~5,000-option
 * dropdown is unmanageable):
 *
 *   [My decks | Built-in]   the player's own decks vs the bundled corpus
 *   [Format]                corpus library (`compareLibraries` order) / own format
 *   [Tournament]            the deck id's event folder, humanized, + all events
 *   [Deck]                  names A–Z inside the current selection
 *
 * The option VALUE stays `deckRef(deck)` (the e2e specs and the stored-form
 * round-trip depend on it) and the deck tier keeps the wizard's own default — the
 * curated preset deck — because the selection is the call site's, not this
 * component's. The corpus is indexed ONCE per deck list (`deckPickerTree`) and
 * this component owns no fetch.
 */
export default function DeckSelectOptions({
  decks,
  label,
  value = '',
  onChange,
  disabled = false,
  testid,
  fieldLabel,
  currentFormat,
  className,
}: DeckSelectOptionsProps) {
  const { t } = useTranslation()
  const tree = useMemo(() => buildDeckPickerTree(decks), [decks])
  const defaults = useMemo(() => defaultDeckPickerSelection(tree, currentFormat), [tree, currentFormat])

  const [category, setCategory] = useState<DeckPickerCategory>(defaults.category)
  const [format, setFormat] = useState(defaults.format)
  const [event, setEvent] = useState(defaults.event)
  // The corpus arrives after the wizard opened (the 9 bundled samples show
  // first), so an untouched picker re-derives its defaults when the tree grows —
  // a real choice (any of the three tiers) is never clobbered.
  const touched = useRef(false)

  useEffect(() => {
    if (touched.current) return
    setCategory(defaults.category)
    setFormat(defaults.format)
    setEvent(defaults.event)
  }, [defaults.category, defaults.format, defaults.event])

  const formatOptions = category === 'own' ? tree.ownFormats : tree.libraries
  // Self-healing guards: a tier whose value the tree no longer carries falls back
  // to the tier's first entry / all events instead of rendering a blank control.
  const activeFormat = formatOptions.includes(format) ? format : formatOptions[0] ?? ''
  const events = useMemo(
    () => (category === 'builtin' ? deckPickerEvents(tree, activeFormat) : []),
    [tree, category, activeFormat],
  )
  const activeEvent = events.includes(event) ? event : ALL_EVENTS

  const sections = useMemo(
    () => deckPickerListSections(tree, { category, format: activeFormat, event: activeEvent }),
    [tree, category, activeFormat, activeEvent],
  )
  // The seat/mine deck can sit outside the current selection (a format switch, the
  // wizard's preset default): pin it as the first option so the control never
  // renders a selection it does not list.
  const pinned = useMemo(() => {
    if (!value) return undefined
    const listed = sections.some((section) => section.decks.some((deck) => deckRef(deck) === value))
    if (listed) return undefined
    return decks.find((deck) => deckRef(deck) === value)
  }, [decks, value, sections])

  const pickCategory = (next: DeckPickerCategory) => {
    touched.current = true
    setCategory(next)
    setFormat(deckPickerFormatFor(tree, next, currentFormat))
    setEvent(ALL_EVENTS)
  }
  const pickFormat = (next: string) => {
    touched.current = true
    setFormat(next)
    setEvent(ALL_EVENTS)
  }
  const pickEvent = (next: string) => {
    touched.current = true
    setEvent(next)
  }

  const formatLabel = (name: string): string => (name === '' ? t('decks', 'deck_unknown') : name)
  const grouped = sections.length > 1

  return (
    <div className={['create-seats-section', className].filter(Boolean).join(' ')}>
      <div className="chip-row">
        <ChipButton
          pill
          size="sm"
          active={category === 'own'}
          data-testid={testid ? `${testid}-own` : undefined}
          onClick={() => pickCategory('own')}
        >
          {t('decks', 'my_decks')}
        </ChipButton>
        <ChipButton
          pill
          size="sm"
          active={category === 'builtin'}
          data-testid={testid ? `${testid}-builtin` : undefined}
          onClick={() => pickCategory('builtin')}
        >
          {t('decks', 'picker_builtin')}
        </ChipButton>
      </div>
      <div className="create-grid-2col">
        <Field label={t('decks', 'picker_format')}>
          <select
            data-testid={testid ? `${testid}-format` : undefined}
            value={activeFormat}
            onChange={(e) => pickFormat(e.target.value)}
          >
            {formatOptions.map((name) => (
              <option key={name || NO_FORMAT_KEY} value={name}>{formatLabel(name)}</option>
            ))}
          </select>
        </Field>
        {category === 'builtin' && events.length > 0 && (
          <Field label={t('decks', 'picker_tournament')}>
            <select
              data-testid={testid ? `${testid}-tournament` : undefined}
              value={activeEvent}
              onChange={(e) => pickEvent(e.target.value)}
            >
              <option value={ALL_EVENTS}>{t('decks', 'picker_all_events')}</option>
              {events.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </Field>
        )}
      </div>
      <Field label={fieldLabel}>
        <select
          data-testid={testid}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          disabled={disabled}
        >
          {pinned && <option value={value}>{label(pinned)}</option>}
          {sections.length === 0 && !pinned && (
            <option value="" disabled>{t('decks', 'corpus_loading')}</option>
          )}
          {sections.map((section) => {
            const options = section.decks.map((deck) => (
              <option key={`${section.key}:${deckRef(deck)}`} value={deckRef(deck)}>{label(deck)}</option>
            ))
            if (!grouped) return <Fragment key={section.key}>{options}</Fragment>
            const heading = section.library !== undefined
              ? `${section.library} (${section.decks.length})`
              : t('decks', section.labelKey ?? 'my_decks')
            return <optgroup key={section.key} label={heading}>{options}</optgroup>
          })}
        </select>
      </Field>
    </div>
  )
}
