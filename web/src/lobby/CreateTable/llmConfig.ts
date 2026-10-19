import type { TranslationSchema } from '../../i18n/types'
import { isLlmSeatType, type SeatConfig } from './constants'
import { newClientKeyTag, setSeatEndpoint, setSeatKey } from './llmSeatKeys'

type LobbyKey = keyof TranslationSchema['lobby']

/**
 * Per-seat LLM configuration for COMPUTER_LLM seats — ported field-for-field
 * from the LLMage webui's LLM_CONFIG_SECTIONS (utils/constants.ts) and the
 * desktop client's LLMConfigDialog JTabbedPane (Core / Behavior / Personality /
 * Conversation / Summarization). The field KEYS, ORDER and DEFAULTS are
 * frozen — with ONE deliberate omission: `transcriptDir` (see the
 * Behavior section), a server-filesystem path that no player should be typing
 * into a shared server. Labels/placeholders ride the i18n keys.
 *
 * Wire semantics on submit: numbers are sent as-is INCLUDING 0 (0 is a
 * meaningful sentinel: modelContextWindow 0 = auto-detect, conversation limits
 * 0 = unlimited), booleans as-is, empty strings are OMITTED (server default);
 * apiKey never reaches the wire — see convertLlmConfigForWire.
 */

export const LLM_CONFIG_TABS = ['core', 'behavior', 'personality', 'conversation', 'summarization'] as const
export type LlmConfigTab = (typeof LLM_CONFIG_TABS)[number]

export interface LlmConfigField {
  key: string
  labelKey: LobbyKey
  type: 'text' | 'password' | 'number' | 'checkbox' | 'select' | 'endpoint' | 'model' | 'personality'
  /** Value the field materialises when the seat has no explicit one. */
  default: string | number | boolean
  /** select only. */
  options?: string[]
  min?: number
  max?: number
  step?: number
  placeholderKey?: LobbyKey
  /** Rendered as a note under the input (e.g. the apiKey honesty hint). */
  hintKey?: LobbyKey
}

export interface LlmConfigSection {
  tab: LlmConfigTab
  fields: LlmConfigField[]
}

export const LLM_CONFIG_SECTIONS: LlmConfigSection[] = [
  {
    tab: 'core',
    fields: [
      { key: 'model', labelKey: 'create_llm_field_model', type: 'model', default: '', placeholderKey: 'create_llm_placeholder_server_default' },
      { key: 'apiEndpoint', labelKey: 'create_llm_field_api_endpoint', type: 'endpoint', default: '', placeholderKey: 'create_llm_placeholder_endpoint' },
      { key: 'apiKey', labelKey: 'create_llm_field_api_key', type: 'password', default: '', placeholderKey: 'create_llm_placeholder_server_default', hintKey: 'create_llm_hint_api_key' },
      { key: 'reasoningEffort', labelKey: 'create_llm_field_reasoning_effort', type: 'select', options: ['default', 'low', 'medium', 'high', 'max'], default: 'default' },
      { key: 'thinkingEnabled', labelKey: 'create_llm_field_thinking_enabled', type: 'checkbox', default: true },
      { key: 'temperatureEnabled', labelKey: 'create_llm_field_temperature_enabled', type: 'checkbox', default: false },
      { key: 'temperature', labelKey: 'create_llm_field_temperature', type: 'number', default: 0.7, min: 0, max: 2, step: 0.1 },
      { key: 'maxTokens', labelKey: 'create_llm_field_max_tokens', type: 'number', default: 0, min: 0, max: 131072, step: 256 },
      { key: 'timeoutSeconds', labelKey: 'create_llm_field_timeout', type: 'number', default: 600, min: 10, max: 3600, step: 10 },
    ],
  },
  {
    tab: 'behavior',
    fields: [
      { key: 'streamingEnabled', labelKey: 'create_llm_field_streaming', type: 'checkbox', default: true },
      { key: 'verboseLogging', labelKey: 'create_llm_field_verbose', type: 'checkbox', default: false },
      { key: 'deckAssessmentEnabled', labelKey: 'create_llm_field_deck_assessment', type: 'checkbox', default: true },
      { key: 'concedeEnabled', labelKey: 'create_llm_field_concede', type: 'checkbox', default: true },
      { key: 'askReason', labelKey: 'create_llm_field_ask_reason', type: 'checkbox', default: false },
      // transcriptDir is deliberately NOT a seat field: it names a directory on
      // the XMage server's filesystem for the server to write .txt transcripts
      // into, which is an operator knob, not a player choice (a player could
      // otherwise create files anywhere the server user can write, and could
      // never read them back). Set it server-side instead:
      // -Dxmage.llm[2].transcript_dir / llmTranscriptDir in config.xml. The proxy
      // still accepts the key on the wire (LlmConfigs), so the desktop client and
      // admin tooling keep working.
    ],
  },
  {
    tab: 'personality',
    fields: [
      { key: 'personalityEnabled', labelKey: 'create_llm_field_personality_enabled', type: 'checkbox', default: true },
      { key: 'personalityName', labelKey: 'create_llm_field_personality_name', type: 'personality', default: '', placeholderKey: 'create_llm_placeholder_personality' },
      { key: 'botName', labelKey: 'create_llm_field_bot_name', type: 'text', default: '', placeholderKey: 'create_llm_placeholder_bot_name' },
    ],
  },
  {
    tab: 'conversation',
    fields: [
      // 0 = unlimited for all three conversation limits.
      { key: 'conversationMaxExchanges', labelKey: 'create_llm_field_conv_max_exchanges', type: 'number', default: 0, min: 0, max: 99999, step: 1 },
      { key: 'conversationMaxHistoryChars', labelKey: 'create_llm_field_conv_max_history', type: 'number', default: 0, min: 0, max: 99999999, step: 1000 },
      { key: 'conversationThinkCharsPerMsg', labelKey: 'create_llm_field_conv_think_chars', type: 'number', default: 0, min: 0, max: 99999999, step: 1000 },
    ],
  },
  {
    tab: 'summarization',
    fields: [
      { key: 'summarizeTriggerChars', labelKey: 'create_llm_field_sum_trigger_chars', type: 'number', default: 0, min: 0, max: 1000000, step: 1000 },
      { key: 'summarizeContextRatio', labelKey: 'create_llm_field_sum_context_ratio', type: 'number', default: 0.65, min: 0, max: 1, step: 0.05 },
      { key: 'modelContextWindow', labelKey: 'create_llm_field_sum_context_window', type: 'number', default: 0, min: 0, max: 10000000, step: 4096 },
      { key: 'summarizeTargetChars', labelKey: 'create_llm_field_sum_target_chars', type: 'number', default: 0, min: 0, max: 1000000, step: 500 },
      { key: 'summarizeTargetRatio', labelKey: 'create_llm_field_sum_target_ratio', type: 'number', default: 0.25, min: 0, max: 1, step: 0.05 },
      { key: 'summarizeKeepExchanges', labelKey: 'create_llm_field_sum_keep_exchanges', type: 'number', default: 5, min: 0, max: 20, step: 1 },
    ],
  },
]

/** Fresh per-seat config materialised with the section defaults (reference behaviour). */
export function defaultLlmConfig(): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const section of LLM_CONFIG_SECTIONS) {
    for (const field of section.fields) out[field.key] = field.default
  }
  return out
}

/** The value a field renders for a (possibly partial) config. */
export function llmConfigValue(config: Record<string, unknown>, field: LlmConfigField): unknown {
  const v = config[field.key]
  return v === undefined ? field.default : v
}

// ── Provider presets (dropdown over the raw chat-completions URL) ──────────
// Product names stay literal; only the generic option labels are i18n keys.

export interface LlmProviderOption {
  id: string
  label: string
  endpoint: string
  /**
   * The provider sends no CORS headers, so a browser-direct POST always fails:
   * client-key calls for this endpoint route through the same-origin
   * `/llm-relay` on the proxy. Single source of truth for the bridge's routing
   * decision (see `isRelayEndpoint` / `web/src/llm/bridge.ts`).
   */
  needsRelay: boolean
  /** Present = not selectable; the reason is rendered after the label. */
  disabledReasonKey?: LobbyKey
}

export const LLM_PROVIDERS: LlmProviderOption[] = [
  { id: 'openai', label: 'OpenAI', endpoint: 'https://api.openai.com/v1/chat/completions', needsRelay: false },
  { id: 'openrouter', label: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1/chat/completions', needsRelay: false },
  { id: 'groq', label: 'Groq', endpoint: 'https://api.groq.com/openai/v1/chat/completions', needsRelay: false },
  { id: 'opencode-go', label: 'OpenCode Go', endpoint: 'https://opencode.ai/zen/go/v1/chat/completions', needsRelay: true },
  { id: 'ollama-cloud', label: 'Ollama Cloud', endpoint: 'https://ollama.com/v1/chat/completions', needsRelay: true },
  { id: 'ollama-local', label: 'Local Ollama', endpoint: 'http://localhost:11434/v1/chat/completions', needsRelay: false },
  {
    id: 'anthropic',
    label: 'Anthropic',
    endpoint: 'https://api.anthropic.com/v1/messages',
    needsRelay: false,
    disabledReasonKey: 'create_llm_anthropic_disabled',
  },
]

/**
 * Whether a client-key provider call for this endpoint must route via the
 * same-origin `/llm-relay` instead of going browser-direct. Derived from the
 * provider table's `needsRelay` so the dropdown and the routing can never
 * disagree; a custom endpoint outside the table (no entry) is called
 * browser-direct — it may serve CORS on its own.
 */
export function isRelayEndpoint(apiEndpoint: string): boolean {
  return LLM_PROVIDERS.find((p) => p.endpoint === apiEndpoint)?.needsRelay === true
}

/** Select value for the free-text fallback option (never a stored endpoint). */
export const PROVIDER_OTHER = '__other__'

/**
 * Map a stored endpoint to the dropdown's select value: '' (server default), a
 * provider id, or PROVIDER_OTHER for any custom URL. Pure, so a remount with a
 * stored custom URL shows the right option without extra bookkeeping.
 */
export function endpointSelectValue(endpoint: unknown): string {
  const ep = typeof endpoint === 'string' ? endpoint.trim() : ''
  if (!ep) return ''
  const match = LLM_PROVIDERS.find((p) => p.endpoint === ep)
  return match ? match.id : PROVIDER_OTHER
}

/**
 * What is wrong with an LLM seat's provider endpoint, or null when it is usable.
 * A seat that names no endpoint makes the SERVER
 * call its own `LLMConfig` default — `http://localhost:11434/v1/chat/completions`
 * — and only a deployment running an LLM listener next to the game server can
 * serve that. The public deployment is deliberately keyless, so the seat dies at
 * its first turn (`Connection refused` → 5 retries → FATAL) and the game goes
 * down with a cryptic reason. The browser cannot see the server's default
 * endpoint, so the seat form states the requirement instead of assuming either
 * way; a chosen provider entry is trusted as-is (the proxy re-validates it
 * against its own allowlist).
 */
export type LlmSeatEndpointProblem = 'missing' | 'invalid' | null

/** Pure: the endpoint problem of a raw per-seat llmConfig. */
export function llmSeatEndpointProblem(config: Record<string, unknown>): LlmSeatEndpointProblem {
  const endpoint = typeof config.apiEndpoint === 'string' ? config.apiEndpoint.trim() : ''
  if (!endpoint) return 'missing'
  if (endpointSelectValue(endpoint) !== PROVIDER_OTHER) return null
  try {
    const url = new URL(endpoint)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '' ? null : 'invalid'
  } catch {
    return 'invalid'
  }
}

/**
 * Pure transition for the Provider dropdown: what the stored endpoint and the
 * "Other…" mode become when the user picks `selected`.
 *
 * - a provider id  -> that provider's endpoint, free-text box hidden
 * - ''             -> server default (empty endpoint), free-text box hidden
 * - PROVIDER_OTHER -> free-text mode; keeps the current URL when it is already
 *                     custom, else restores `customDraft` (the last URL typed)
 *
 * Fail Fast: an unknown or disabled option id is a caller bug (the DOM cannot
 * produce one — disabled options aren't selectable) and throws.
 */
export function endpointSelectTransition(
  selected: string,
  currentValue: unknown,
  customDraft: string,
): { endpoint: string; otherMode: boolean } {
  if (selected === PROVIDER_OTHER) {
    const alreadyCustom = endpointSelectValue(currentValue) === PROVIDER_OTHER
    const kept = alreadyCustom && typeof currentValue === 'string' ? currentValue : customDraft
    return { endpoint: kept, otherMode: true }
  }
  if (selected === '') return { endpoint: '', otherMode: false }
  const provider = LLM_PROVIDERS.find((p) => p.id === selected)
  if (!provider || provider.disabledReasonKey !== undefined) {
    throw new Error(`endpointSelectTransition: unknown or disabled provider option '${selected}'`)
  }
  return { endpoint: provider.endpoint, otherMode: false }
}

// ── Wire conversion ─────────────────────────────────────────────────────────

/**
 * Build the llmConfig entry that goes on the wire:
 *
 * - apiKey non-empty -> a fresh clientKeyTag, the key stored in the module
 *   memory store (never persisted, never sent), `useClientKey: true` +
 *   `clientKeyTag` emitted, the apiKey field itself dropped.
 * - apiKey empty -> neither useClientKey nor clientKeyTag are emitted.
 * - numbers as-is INCLUDING 0, booleans as-is, non-empty strings trimmed and
 *   sent, empty strings omitted (server default).
 */
export function convertLlmConfigForWire(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  // The seat's chosen endpoint, captured in the same pass so the tag minted
  // for the apiKey can be BOUND to it: the bridge later
  // refuses to attach the key to any endpoint other than this one. '' means
  // no endpoint chosen (server default).
  const apiEndpoint = typeof raw.apiEndpoint === 'string' ? raw.apiEndpoint.trim() : ''
  for (const [key, v] of Object.entries(raw)) {
    if (key === 'apiKey') {
      const key_ = v === null || v === undefined ? '' : String(v).trim()
      if (key_) {
        const tag = newClientKeyTag()
        setSeatKey(tag, key_)
        setSeatEndpoint(tag, apiEndpoint)
        out.useClientKey = true
        out.clientKeyTag = tag
      }
      continue
    }
    // useClientKey/clientKeyTag are produced ONLY by the conversion above.
    if (key === 'useClientKey' || key === 'clientKeyTag') continue
    if (typeof v === 'boolean') {
      out[key] = v
    } else if (typeof v === 'number') {
      out[key] = v
    } else if (v !== null && v !== undefined && String(v).trim()) {
      out[key] = String(v).trim()
    }
  }
  return out
}

/**
 * One entry per COMPUTER_LLM seat in seat order (k-th LLM seat consumes k-th
 * entry; null = server defaults). `rawConfigs` is the raw per-seat llmConfig,
 * aligned with `effectiveSeatTypes` (absent entries allowed). Undefined when
 * there is no LLM seat, so the create call omits the arg entirely.
 */
export function llmConfigsForSeats(
  effectiveSeatTypes: string[],
  rawConfigs: Array<Record<string, unknown> | null | undefined>,
): (Record<string, unknown> | null)[] | undefined {
  const out: (Record<string, unknown> | null)[] = []
  for (let i = 0; i < effectiveSeatTypes.length; i++) {
    if (!isLlmSeatType(effectiveSeatTypes[i])) continue
    const raw = rawConfigs[i]
    out.push(raw ? convertLlmConfigForWire(raw) : null)
  }
  return out.length > 0 ? out : undefined
}

/**
 * The seatConfigs as persisted to localStorage: the apiKey NEVER survives
 * (keys on disk are keys in every XSS's reach) — mirrored from the reference,
 * where the key lives in module memory only.
 */
export function stripApiKeyFromSeatConfigs(seatConfigs: SeatConfig[]): SeatConfig[] {
  return seatConfigs.map((s) => {
    if (!s.llmConfig || !Object.prototype.hasOwnProperty.call(s.llmConfig, 'apiKey')) return s
    const llmConfig = { ...s.llmConfig }
    delete llmConfig.apiKey
    return { ...s, llmConfig }
  })
}
