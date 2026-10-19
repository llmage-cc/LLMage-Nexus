import { useId, useReducer, useState } from 'react'
import Tabs from '../../ui/Tabs'
import Icon from '../../ui/Icon'
import Field from '../../ui/Field'
import Checkbox from '../../ui/Checkbox'
import ChipButton from '../../ui/ChipButton'
import { useTranslation } from '../../i18n'
import * as cmds from '../../net/commands'
import {
  LLM_CONFIG_SECTIONS,
  LLM_PROVIDERS,
  PROVIDER_OTHER,
  endpointSelectTransition,
  endpointSelectValue,
  llmConfigValue,
  llmSeatEndpointProblem,
  type LlmConfigField,
  type LlmConfigSection,
  type LlmConfigTab,
} from './llmConfig'
import { initialLlmList, listActionFromResult, llmListReducer, listErrorMessage } from './llmModelPicker'

/**
 * Per-seat LLM configuration: a compact tabbed panel with the
 * same five sections as the desktop LLMConfigDialog JTabbedPane — Core /
 * Behavior / Personality / Conversation / Summarization — rendered under the
 * seat's regular fields. The caller owns the state: `config` is the seat's raw
 * llmConfig record, `onChange` receives the whole record after each edit.
 *
 * Only rendered for COMPUTER_LLM seats while `capabilities.llm` is true; the
 * gating lives in SeatsTab (and, definitively, in the proxy).
 */

/** Provider dropdown over the raw chat-completions URL stored in apiEndpoint. */
function EndpointSelectInput({
  value,
  placeholder,
  onChange,
}: {
  value: unknown
  placeholder?: string | undefined
  onChange: (value: unknown) => void
}) {
  const { t } = useTranslation()
  const [otherMode, setOtherMode] = useState(false)
  // Remember the last custom URL so flipping to a provider and back does not
  // lose a pasted endpoint. Seeded from the stored value on mount.
  const [customDraft, setCustomDraft] = useState(() =>
    endpointSelectValue(value) === PROVIDER_OTHER ? String(value ?? '') : '',
  )
  const selectValue = otherMode ? PROVIDER_OTHER : endpointSelectValue(value)

  const onSelect = (selected: string) => {
    const next = endpointSelectTransition(selected, value, customDraft)
    setOtherMode(next.otherMode)
    if (next.otherMode) setCustomDraft(next.endpoint)
    onChange(next.endpoint)
  }

  return (
    <div className="llm-endpoint-select">
      <select
        className="llm-endpoint-select__provider"
        data-testid="llm-provider"
        value={selectValue}
        onChange={(e) => onSelect(e.target.value)}
        title={selectValue !== '' && selectValue !== PROVIDER_OTHER ? String(value) : undefined}
      >
        <option value="">{t('lobby', 'create_llm_placeholder_server_default')}</option>
        {LLM_PROVIDERS.map((p) => (
          <option key={p.id} value={p.id} disabled={p.disabledReasonKey !== undefined}>
            {p.disabledReasonKey !== undefined ? `${p.label} — ${t('lobby', p.disabledReasonKey)}` : p.label}
          </option>
        ))}
        <option value={PROVIDER_OTHER}>{t('lobby', 'create_llm_provider_other')}</option>
      </select>
      {selectValue === PROVIDER_OTHER && (
        <input
          type="text"
          value={String(value ?? '')}
          placeholder={placeholder || ''}
          onChange={(e) => {
            setCustomDraft(e.target.value)
            onChange(e.target.value)
          }}
        />
      )}
    </div>
  )
}

/** Sentinel select value for "type the value by hand" (never a stored value). */
export const MANUAL_MODEL_OPTION = '__manual__'

/**
 * Model / Personality picker: a free-text field backed by a fetched
 * list. A "fetch" button calls the proxy verb (`fetchModels` with the seat's
 * endpoint, or `fetchPersonalities`) and, on success, the select lists the
 * returned entries; picking one writes it into the config. The free-text input
 * stays available (no list yet, a value off the list, or the explicit manual
 * option) so a seat is never blocked when the list is unavailable.
 *
 * The loading flag is cleared on BOTH outcomes (see llmModelPicker): the proxy
 * answers a failure with a typed frame, so the spinner never sticks.
 */
function LlmListPickerInput({
  kind,
  value,
  placeholder,
  endpoint,
  onChange,
}: {
  kind: 'model' | 'personality'
  value: unknown
  placeholder?: string | undefined
  /** Model list only: the seat's chat-completions endpoint (may be empty = server default). */
  endpoint?: string | undefined
  onChange: (value: unknown) => void
}) {
  const { t } = useTranslation()
  const [state, dispatch] = useReducer(llmListReducer, initialLlmList)
  const [manual, setManual] = useState(false)

  const text = String(value ?? '')

  const doFetch = () => {
    dispatch({ kind: 'start' })
    setManual(false)
    const request =
      kind === 'model' ? cmds.fetchLlmModels(endpoint ?? '') : cmds.fetchLlmPersonalities()
    request
      .then((res) => {
        const action = listActionFromResult(res)
        dispatch(action)
        // A value that is not in the fetched list stays visible in the free-text box.
        if (action.kind === 'success' && text && !action.items.includes(text)) setManual(true)
      })
      .catch((error: unknown) => dispatch({ kind: 'error', message: listErrorMessage(error) }))
  }

  const hasList = state.items.length > 0
  const selectValue = !hasList || !text || state.items.includes(text) ? text : MANUAL_MODEL_OPTION
  const showInput = manual || !hasList || selectValue === MANUAL_MODEL_OPTION

  return (
    <div className="llm-list-picker">
      {hasList && (
        <select
          data-testid={`llm-${kind}-select`}
          value={selectValue}
          onChange={(e) => {
            const next = e.target.value
            if (next === MANUAL_MODEL_OPTION) {
              setManual(true)
              return
            }
            setManual(false)
            onChange(next)
          }}
        >
          <option value="">{placeholder || t('lobby', 'create_llm_placeholder_server_default')}</option>
          {state.items.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
          <option value={MANUAL_MODEL_OPTION}>{t('lobby', 'create_llm_fetch_manual')}</option>
        </select>
      )}
      {showInput && (
        <input
          type="text"
          data-testid={kind === 'model' ? 'llm-model' : 'llm-personalityName'}
          value={text}
          placeholder={placeholder || ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      <div className="llm-list-picker__actions">
        <ChipButton
          type="button"
          icon="refresh"
          size="sm"
          disabled={state.loading}
          data-testid={`llm-${kind}-fetch`}
          onClick={doFetch}
        >
          {state.loading ? t('lobby', 'create_llm_fetch_loading') : t('lobby', 'create_llm_fetch_button')}
        </ChipButton>
        <span className="llm-list-picker__status" data-testid={`llm-${kind}-status`}>
          {state.error
            ? t('lobby', 'create_llm_fetch_failed', { error: state.error })
            : hasList
              ? t('lobby', 'create_llm_fetch_count', { count: state.items.length })
              : ''}
        </span>
      </div>
    </div>
  )
}

export function LlmSeatConfigField({
  field,
  value,
  endpoint,
  onChange,
}: {
  field: LlmConfigField
  value: unknown
  /** Model list only: the seat's endpoint, read by the fetch verb. */
  endpoint?: string | undefined
  onChange: (value: unknown) => void
}) {
  const { t } = useTranslation()
  if (field.type === 'checkbox') {
    return (
      <Checkbox
        checked={Boolean(value)}
        onChange={onChange}
        label={t('lobby', field.labelKey)}
        inputTestId={`llm-${field.key}`}
        className="llm-config-check"
      />
    )
  }
  const hint = field.hintKey ? t('lobby', field.hintKey) : undefined
  return (
    <Field label={t('lobby', field.labelKey)} hint={hint} className="llm-config-field">
      {field.type === 'endpoint' ? (
        <EndpointSelectInput value={value} placeholder={field.placeholderKey ? t('lobby', field.placeholderKey) : undefined} onChange={onChange} />
      ) : field.type === 'model' || field.type === 'personality' ? (
        <LlmListPickerInput
          kind={field.type}
          value={value}
          placeholder={field.placeholderKey ? t('lobby', field.placeholderKey) : undefined}
          endpoint={endpoint}
          onChange={onChange}
        />
      ) : field.type === 'select' ? (
        <select data-testid={`llm-${field.key}`} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          {field.options?.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      ) : (
        <input
          type={field.type === 'number' ? 'number' : field.type}
          data-testid={`llm-${field.key}`}
          value={field.type === 'number' ? Number(value ?? 0) : String(value ?? '')}
          placeholder={field.placeholderKey ? t('lobby', field.placeholderKey) : ''}
          min={field.min}
          max={field.max}
          step={field.step}
          onChange={(e) => {
            if (field.type === 'number') onChange(parseFloat(e.target.value) || 0)
            else onChange(e.target.value)
          }}
        />
      )}
    </Field>
  )
}

const TAB_LABEL_KEYS: Record<LlmConfigTab, 'create_llm_tab_core' | 'create_llm_tab_behavior' | 'create_llm_tab_personality' | 'create_llm_tab_conversation' | 'create_llm_tab_summarization'> = {
  core: 'create_llm_tab_core',
  behavior: 'create_llm_tab_behavior',
  personality: 'create_llm_tab_personality',
  conversation: 'create_llm_tab_conversation',
  summarization: 'create_llm_tab_summarization',
}

function sectionByTab(tab: LlmConfigTab): LlmConfigSection {
  const section = LLM_CONFIG_SECTIONS.find((s) => s.tab === tab)
  if (!section) throw new Error(`LLM config panel: section '${tab}' is missing`)
  return section
}

export function LlmSeatConfigPanel({
  seatIndex,
  config,
  onChange,
}: {
  seatIndex: number
  config: Record<string, unknown>
  onChange: (config: Record<string, unknown>) => void
}) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<LlmConfigTab>('core')
  const idPrefix = useId()
  const section = sectionByTab(tab)
  const endpoint = typeof config.apiEndpoint === 'string' ? config.apiEndpoint : ''
  const endpointProblem = llmSeatEndpointProblem(config)

  return (
    <div className="llm-config-panel" data-testid={`llm-config-panel-${seatIndex}`}>
      <div className="llm-config-panel__header">
        <Icon name="bot" size={13} /> {t('lobby', 'create_llm_panel_title')}
      </div>
      {endpointProblem && (
        <div
          role="alert"
          className="wizard-hint-box wizard-hint-box--warn"
          data-testid={`llm-endpoint-problem-${seatIndex}`}
        >
          <Icon name="alert" size={13} />{' '}
          {endpointProblem === 'missing'
            ? t('lobby', 'create_llm_endpoint_missing')
            : t('lobby', 'create_llm_endpoint_invalid', { endpoint })}
        </div>
      )}
      <Tabs<LlmConfigTab>
        variant="segmented"
        size="sm"
        className="llm-config-tabs"
        idPrefix={idPrefix}
        label={t('lobby', 'create_llm_panel_title')}
        value={tab}
        onChange={setTab}
        items={(Object.keys(TAB_LABEL_KEYS) as LlmConfigTab[]).map((tabId) => ({
          id: tabId,
          label: t('lobby', TAB_LABEL_KEYS[tabId]),
          testId: `llm-tab-${tabId}`,
        }))}
      />
      <div
        role="tabpanel"
        className="llm-config-panel__body"
        id={`${idPrefix}-panel-${tab}`}
        aria-labelledby={`${idPrefix}-tab-${tab}`}
      >
        {section.fields.map((field) => (
          <LlmSeatConfigField
            key={field.key}
            field={field}
            value={llmConfigValue(config, field)}
            endpoint={endpoint}
            onChange={(v) => onChange({ ...config, [field.key]: v })}
          />
        ))}
      </div>
    </div>
  )
}
