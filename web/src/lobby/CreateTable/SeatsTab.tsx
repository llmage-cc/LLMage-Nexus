import { useTranslation } from '../../i18n'
import ChipButton from '../../ui/ChipButton'
import Chip from '../../ui/Chip'
import Icon from '../../ui/Icon'
import { deckRef } from '../decks'
import { HUMAN_SEAT, LLM_SEAT, isHumanSeatType, isLlmSeatType, isP1SeatType, isSimSeatType, seatTypeLabel, seatDeckIsEmpty, simSeatsEnabled } from './constants'
import type { CreateTableForm } from './useCreateTableForm'
import Field from '../../ui/Field'
import Button from '../../ui/Button'
import StarterDecksOffer from '../../decks/StarterDecksOffer'
import { LlmSeatConfigPanel } from './LlmSeatConfigPanel'
import P1TrainingDeckPicker from './P1TrainingDeckPicker'
import DeckSelectOptions from './DeckSelectOptions'
import { p1DeckNameForText } from './p1Decks'

export default function SeatsTab({ form, onEditDeck }: { form: CreateTableForm; onEditDeck?: (deckId: string) => void }) {
  const { t } = useTranslation()
  const humansWaiting = form.seatConfigs.filter((s) => isHumanSeatType(s.type)).length
  const bots = form.seatConfigs.length - humansWaiting
  return (
    <div className="create-tab-content">
      <div className="wizard-step-heading">
        <h3><Icon name="bot" size={15} /> {t('lobby','create_tab_multi')}</h3>
        <p>{t('lobby','create_step_desc_seats')}</p>
      </div>
      {/* One-click all-bot LLM duel (only when capabilities.llm).
          Sets humanSeat=false + both seats to COMPUTER_LLM — the discoverable
          shape of the all-bot table the backend already accepts. */}
      {form.llmEnabled && (
        <div className="create-presets-strip">
          <span className="create-presets-label"><Icon name="zap" size={12} /> {t('lobby','create_presets_title')}:</span>
          <div className="create-presets-buttons">
            <ChipButton
              size="sm"
              icon="bot"
              data-testid="llm-vs-llm-preset"
              onClick={() => form.applyLlmVsLlm()}
            >
              {seatTypeLabel(LLM_SEAT, t)} vs {seatTypeLabel(LLM_SEAT, t)}
            </ChipButton>
            <span className="wizard-hint-box">{t('lobby','create_preset_llm_vs_llm_hint')}</span>
          </div>
        </div>
      )}
      <div className="create-seats-section">
        <div className="create-seat-box human-seat-box">
          <div className="seat-box-header">
            <span className="seat-title"><Icon name="user" size={13} /> {t('common','player')}</span>
            <ChipButton pill active={form.humanSeat} onClick={() => form.setHumanSeat(!form.humanSeat)}>
              {form.humanSeat ? (<><Icon name="check" size={12} /> {t('common','player')}</>) : (<><Icon name="eye" size={12} /> {t('lobby','spectators')}</>)}
            </ChipButton>
          </div>
          {form.humanSeat && (
            <>
              {form.isDraftLimited ? (
                <div className="wizard-hint-box wizard-hint-box--info wizard-hint-box--spaced">
                  <Icon name="layers" size={13} /> {t('lobby', 'create_tourney_draft_timing_desc')}
                </div>
              ) : (
                <>
                  <div className="create-deck-picker">
                    <DeckSelectOptions
                      decks={form.availableDecks}
                      label={(d) => `${d.name} (${d.cards.reduce((sum, c) => sum + c.amount, 0)} ${t('decks','total_cards')})`}
                      value={form.myDeck ? deckRef(form.myDeck) : ''}
                      onChange={form.selectMyDeck}
                      disabled={form.availableDecks.length === 0}
                      testid="active-deck-select"
                      fieldLabel={t('lobby','active_deck')}
                      currentFormat={form.deckType}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="package"
                      data-testid="create-edit-deck"
                      disabled={!form.myDeck || !onEditDeck}
                      title={t('lobby','create_edit_deck')}
                      onClick={() => { if (form.myDeck) onEditDeck?.(deckRef(form.myDeck)) }}
                    >
                      {t('lobby','create_edit_deck')}
                    </Button>
                  </div>
                  {!form.myDeck && (
                    <Chip tone="warn" size="xs" pill icon="alert">{t('lobby','create_err_no_deck')}</Chip>
                  )}
                  {form.decksLoaded && form.availableDecks.length === 0 && (
                    <StarterDecksOffer onAdded={form.adoptStarterDecks} />
                  )}
                </>
              )}
              <Field label={t('lobby','create_field_my_skill')}>
                <select data-testid="my-skill" value={form.mySkill} onChange={(e) => form.setMySkill(Number(e.target.value))}>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </Field>
            </>
          )}
          {!form.humanSeat && <span className="wizard-hint-box">{t('lobby','create_enter_as_spectator')}</span>}
        </div>

        <div className="create-seat-box ai-seat-box">
          <div className="seat-box-header">
            <span className="seat-title"><Icon name="bot" size={13} /> {t('lobby','create_seats_title')} — {form.seatConfigs.length} ({t('lobby','create_seats_waiting_count',{count:humansWaiting})} · {t('lobby','create_seats_bot_count',{count:bots})}, {t('lobby','create_seats_total_count',{total:form.numPlayers})})</span>
            {form.numPlayers !== (form.selectedGameTypeInfo?.maxPlayers ?? form.numPlayers) && form.selectedGameTypeInfo && (
              <Chip tone="warn" size="xs" pill>Config: {form.numPlayers} / {form.selectedGameTypeInfo.maxPlayers} max</Chip>
            )}
          </div>
          {form.numPlayers > 2 && (
            <div className="wizard-hint-box wizard-hint-box--spaced">
              {form.isTournament ? t('lobby','create_seats_hint_tourney') : form.isMultiplayerGame ? t('lobby','create_seats_hint_multi') : t('lobby','create_seats_hint_duel')}
            </div>
          )}
          {form.seatConfigs.length === 0 ? (
            <div className="wizard-hint-box">{t('lobby','create_seats_no_extra')}</div>
          ) : (
            <div className="create-seats-section">
              {form.seatConfigs.map((cfg, idx) => (
                <div key={idx} className="create-seat-box create-seat-box--seat">
                  <div className="seat-box-header">
                    <span className="seat-title">{t('lobby','create_seat_number',{num:idx+2})} {form.humanSeat ? `→ ${idx + 2}` : `→ ${idx + 1}`}</span>
                    <select data-testid={`seat-type-${idx}`} value={cfg.type} onChange={(e) => form.setSeatType(idx, e.target.value)} className="create-seat-select create-seat-select--type">
                      <option value={HUMAN_SEAT}>{seatTypeLabel(HUMAN_SEAT, t)}</option>
                      {form.playerTypes.map((pt) => (
                        <option key={pt} value={pt}>{seatTypeLabel(pt, t)}</option>
                      ))}
                    </select>
                  </div>
                  {!isHumanSeatType(cfg.type) && (
                  <Field label={t('lobby','create_field_seat_skill')}>
                    <select data-testid={`seat-skill-${idx}`} value={cfg.skill ?? 2} onChange={(e) => form.setSeatSkill(idx, Number(e.target.value))} className="create-seat-select create-seat-select--skill">
                      {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                  </Field>
                  )}
                  {isHumanSeatType(cfg.type) && <span className="wizard-hint-box"><Icon name="user" size={11} /> {t('lobby','create_seat_human_waiting')}</span>}
                  {!isHumanSeatType(cfg.type) && !form.isDraftLimited && !isP1SeatType(cfg.type) && (() => {
                    const deck = form.availableDecks.find((d) => deckRef(d) === cfg.deckName)
                      ?? form.availableDecks.find((d) => d.name === cfg.deckName)
                    const total = deck ? deck.cards.reduce((sum, c) => sum + c.amount, 0) : 0
                    // An empty seat.deckName is not an error by itself — the
                    // submit path falls back to the global sim deck. Only warn when
                    // there is genuinely no deck to fall back to.
                    const empty = seatDeckIsEmpty(cfg.deckName, form.availableDecks, form.simDeck)
                    return (
                      <>
                        <DeckSelectOptions
                          decks={form.availableDecks}
                          label={(d) => `${d.name} (${d.cards.reduce((sum, c) => sum + c.amount, 0)})`}
                          value={cfg.deckName}
                          onChange={(ref) => form.setSeatDeck(idx, ref)}
                          disabled={form.availableDecks.length === 0}
                          testid={`seat-deck-${idx}`}
                          fieldLabel={t('lobby','create_seat_deck_label',{num:idx+2})}
                          currentFormat={form.deckType}
                        />
                        {empty ? (
                          <Chip tone="warn" size="xs" pill icon="alert">{t('lobby','create_warn_seat_deck_empty')}</Chip>
                        ) : (
                          <span className="wizard-hint-box">{total > 0 ? `${total} ${t('decks','total_cards')}` : t('lobby','create_seat_deck_fallback',{name: form.simDeck?.name ?? ''})}</span>
                        )}
                      </>
                    )
                  })()}
                  {/* COMPUTER_P1 seat: the deck control is a SELECT over the
                      55 training decks (defaulted to the proxy default). Selecting writes the
                      deck TEXT into the seat via setSeatDeck; the server stays authoritative. */}
                  {!isHumanSeatType(cfg.type) && !form.isDraftLimited && isP1SeatType(cfg.type) && (
                    <Field label={t('lobby','create_p1_deck_label',{count:form.p1Decks.length})}>
                      <P1TrainingDeckPicker
                        decks={form.p1Decks}
                        defaultName={form.p1Default}
                        selectedName={p1DeckNameForText(form.p1Decks, cfg.deckName)}
                        onPickText={(text) => form.setSeatDeck(idx, text)}
                        status={form.p1PoolStatus}
                        onRetry={form.reloadP1Decks}
                      />
                    </Field>
                  )}
                  {/* Upstream v0.4.7 (4fe0f8ab8a): server-native AI seats (Mad /
                      Montecarlo / Draftbot) play with the seat deck picked above —
                      the "internal deck" hint only makes sense for the SIM seat,
                      which ignores it. SIM itself is dev-only (proxy `--sim on`). */}
                  {isSimSeatType(cfg.type) && <span className="wizard-hint-box">{t('lobby','create_seat_bot_internal',{type:seatTypeLabel(cfg.type, t)})}</span>}
                  {/* Per-seat LLM config. Only rendered when the
                      server reported capabilities.llm AND the seat is COMPUTER_LLM. */}
                  {form.llmEnabled && isLlmSeatType(cfg.type) && (
                    <LlmSeatConfigPanel
                      seatIndex={idx}
                      config={cfg.llmConfig ?? {}}
                      onChange={(next) => form.setSeatLlmConfig(idx, next)}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="create-seats-shortcuts">
            <Field group label={t('lobby','create_seats_apply_all_shortcut')}>
              <div className="chip-row">
                <ChipButton
                  pill
                  active={form.playerTypesSel.includes(HUMAN_SEAT)}
  onClick={() => {
                  form.toggleAi(HUMAN_SEAT)
                  form.applySeatTypeToAll(HUMAN_SEAT)
                }}
                ><Icon name="user" size={12} /> {t('lobby','create_seat_human_short')}</ChipButton>
                {form.playerTypes.map((pt) => (
                  <ChipButton
                    pill
                    active={form.playerTypesSel.includes(pt)}
 key={pt}  onClick={() => {
                    form.toggleAi(pt)
                    form.applySeatTypeToAll(pt)
                  }}
                  >{seatTypeLabel(pt, t)}</ChipButton>
                ))}
              </div>
            </Field>
            {/* Global SIM deck shortcut (fork): the fallback deck for SIM seats.
                SIM is dev-only upstream (v0.4.7, proxy `--sim on`), so the
                shortcut only renders where the SIM channel is enabled. */}
            {simSeatsEnabled() && (
              <DeckSelectOptions
                decks={form.availableDecks}
                label={(d) => `${d.name} (${d.cards.reduce((sum, c) => sum + c.amount, 0)} ${t('decks','total_cards')})`}
                value={form.simDeck ? deckRef(form.simDeck) : ''}
                onChange={form.selectGlobalSimDeck}
                disabled={form.availableDecks.length === 0}
                testid="sim-deck-select"
                fieldLabel={`${t('lobby','create_seats_title')} — SIM`}
                currentFormat={form.deckType}
                className="create-seats-sim-deck"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
