import { useTranslation } from '../../i18n'
import type { P1DeckEntry } from '../../net/commands'
import Chip from '../../ui/Chip'
import Button from '../../ui/Button'
import { buildP1SeatOptions, p1DeckText, p1DefaultDeckName } from './p1Decks'
import type { P1PoolStatus } from './types'

/**
 * COMPUTER_P1 training-deck picker.
 *
 * A P1 seat may only be given one of the 55 Standard training decklists the
 * policy net was trained on, so its deck control is a SELECT over the fetched
 * pool (name + paste-ready TEXT) — never the user's saved-deck dropdown and never
 * a free-text list. Selecting a name writes that deck's TEXT through
 * `onPickText`, the same seat-deck path the other seats use; the server's
 * authoritative P1DeckRestriction still rejects a crafted client at join.
 *
 * While the pool is empty the control reports WHY: `status === 'error'` (the proxy
 * refused/failed `getP1Decks`) renders a visible failure chip plus a retry; only
 * the short loading window shows the loading hint, so a refused pool is never
 * mistaken for an eternal "loading…".
 */
export default function P1TrainingDeckPicker({
  decks,
  defaultName,
  selectedName,
  onPickText,
  status,
  onRetry,
}: {
  /** The fetched training pool (empty until the once-per-open fetch answers). */
  decks: P1DeckEntry[]
  /** The proxy's deterministic default deck name. */
  defaultName: string
  /** The name of the deck currently stored on the seat ('' → falls back to the default). */
  selectedName: string
  /** Writes the chosen training deck's TEXT into the seat. */
  onPickText: (deckText: string) => void
  /** Lifecycle of the pool fetch: 'error' renders the visible failure state. */
  status: P1PoolStatus
  /** Re-runs the pool fetch (only meaningful while the pool is empty). */
  onRetry: () => void
}) {
  const { t } = useTranslation()

  if (decks.length === 0) {
    if (status === 'error') {
      return (
        <>
          <Chip tone="warn" size="xs" pill icon="alert" data-testid="p1-deck-picker-error">
            {t('lobby', 'create_p1_deck_empty')}
          </Chip>
          <Button
            variant="link"
            size="sm"
            data-testid="p1-deck-picker-retry"
            onClick={onRetry}
          >
            {t('lobby', 'create_p1_deck_retry')}
          </Button>
        </>
      )
    }
    return (
      <span className="wizard-hint-box" data-testid="p1-deck-picker-empty">
        {t('lobby', 'create_p1_deck_loading')}
      </span>
    )
  }

  const name = selectedName || p1DefaultDeckName(decks, defaultName)

  return (
    <>
      <select
        data-testid="p1-deck-picker"
        value={name}
        onChange={(e) => onPickText(p1DeckText(decks, e.target.value))}
        className="create-seat-select create-seat-select--deck"
      >
        {buildP1SeatOptions(decks, defaultName).map((opt) => (
          <option key={opt.name} value={opt.name}>
            {opt.name}{opt.isDefault ? t('lobby', 'create_p1_deck_default_suffix') : ''}
          </option>
        ))}
      </select>
      <span className="wizard-hint-box">
        {t('lobby', 'create_p1_restricted_note', { count: decks.length })}
      </span>
    </>
  )
}
