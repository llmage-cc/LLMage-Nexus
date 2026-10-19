import { beforeEach, describe, expect, it } from 'vitest'
import {
  LLM_CONFIG_SECTIONS,
  LLM_PROVIDERS,
  PROVIDER_OTHER,
  convertLlmConfigForWire,
  defaultLlmConfig,
  endpointSelectTransition,
  endpointSelectValue,
  llmConfigsForSeats,
  llmSeatEndpointProblem,
} from './llmConfig'
import { clearSeatKeys, hasSeatKey } from './llmSeatKeys'

beforeEach(() => {
  clearSeatKeys()
})

describe('LLM_CONFIG_SECTIONS (field schema)', () => {
  it('has the five desktop tabs in order', () => {
    expect(LLM_CONFIG_SECTIONS.map((s) => s.tab)).toEqual([
      'core',
      'behavior',
      'personality',
      'conversation',
      'summarization',
    ])
  })

  it('covers the full frozen field set, no more no less', () => {
    const keys = LLM_CONFIG_SECTIONS.flatMap((s) => s.fields.map((f) => f.key))
    expect(keys).toEqual([
      'model', 'apiEndpoint', 'apiKey', 'reasoningEffort', 'thinkingEnabled', 'temperatureEnabled',
      'temperature', 'maxTokens', 'timeoutSeconds',
      'streamingEnabled', 'verboseLogging', 'deckAssessmentEnabled', 'concedeEnabled', 'askReason',
      'personalityEnabled', 'personalityName', 'botName',
      'conversationMaxExchanges', 'conversationMaxHistoryChars', 'conversationThinkCharsPerMsg',
      'summarizeTriggerChars', 'summarizeContextRatio', 'modelContextWindow', 'summarizeTargetChars',
      'summarizeTargetRatio', 'summarizeKeepExchanges',
    ])
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('defaultLlmConfig fills every field with its section default', () => {
    const cfg = defaultLlmConfig()
    expect(cfg.model).toBe('')
    expect(cfg.reasoningEffort).toBe('default')
    expect(cfg.thinkingEnabled).toBe(true)
    expect(cfg.temperatureEnabled).toBe(false)
    expect(cfg.temperature).toBe(0.7)
    expect(cfg.timeoutSeconds).toBe(600)
    expect(cfg.summarizeKeepExchanges).toBe(5)
    expect(Object.keys(cfg)).toHaveLength(26)
  })

  it('does not offer transcriptDir: a server-filesystem path is not a seat field', () => {
    const keys = LLM_CONFIG_SECTIONS.flatMap((s) => s.fields.map((f) => f.key))
    expect(keys).not.toContain('transcriptDir')
  })

  it('provider presets match the reference endpoints', () => {
    const byId = Object.fromEntries(LLM_PROVIDERS.map((p) => [p.id, p]))
    expect(byId.openai.endpoint).toBe('https://api.openai.com/v1/chat/completions')
    expect(byId.openrouter.endpoint).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(byId.groq.endpoint).toBe('https://api.groq.com/openai/v1/chat/completions')
    expect(byId['opencode-go'].endpoint).toBe('https://opencode.ai/zen/go/v1/chat/completions')
    expect(byId['ollama-cloud'].endpoint).toBe('https://ollama.com/v1/chat/completions')
    expect(byId['ollama-local'].endpoint).toBe('http://localhost:11434/v1/chat/completions')
    expect(byId.anthropic.disabledReasonKey).toBe('create_llm_anthropic_disabled')
  })
})

describe('endpointSelectValue / endpointSelectTransition', () => {
  it('classifies stored endpoints', () => {
    expect(endpointSelectValue('')).toBe('')
    expect(endpointSelectValue(undefined)).toBe('')
    expect(endpointSelectValue('https://api.groq.com/openai/v1/chat/completions')).toBe('groq')
    expect(endpointSelectValue('https://custom.example/v1/chat/completions')).toBe(PROVIDER_OTHER)
  })

  it('picking a provider fills its endpoint; picking "" restores server default', () => {
    expect(endpointSelectTransition('groq', '', '')).toEqual({
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      otherMode: false,
    })
    expect(endpointSelectTransition('', 'https://x.example/y', '')).toEqual({ endpoint: '', otherMode: false })
  })

  it('Other mode keeps a custom URL and restores the last typed draft', () => {
    expect(endpointSelectTransition(PROVIDER_OTHER, 'https://x.example/y', '')).toEqual({
      endpoint: 'https://x.example/y',
      otherMode: true,
    })
    expect(endpointSelectTransition(PROVIDER_OTHER, '', 'https://draft.example/z')).toEqual({
      endpoint: 'https://draft.example/z',
      otherMode: true,
    })
  })

  it('an unknown or disabled option is a programming error', () => {
    expect(() => endpointSelectTransition('nope', '', '')).toThrow(/unknown or disabled/)
    expect(() => endpointSelectTransition('anthropic', '', '')).toThrow(/unknown or disabled/)
  })
})

describe('convertLlmConfigForWire — submit semantics', () => {
  it('keeps the apiKey out of the wire object; turns it into useClientKey + tag', () => {
    const wire = convertLlmConfigForWire({ model: 'gpt-5', apiKey: 'XXXXXX-not-a-real-key' })
    expect(wire).not.toHaveProperty('apiKey')
    expect(wire.useClientKey).toBe(true)
    expect(typeof wire.clientKeyTag).toBe('string')
    expect(hasSeatKey(wire.clientKeyTag as string)).toBe(true)
    expect(wire.model).toBe('gpt-5')
  })

  it('an empty/whitespace apiKey emits neither useClientKey nor clientKeyTag', () => {
    for (const apiKey of ['', '   ', undefined, null]) {
      const wire = convertLlmConfigForWire({ model: 'm', apiKey })
      expect(wire).not.toHaveProperty('useClientKey')
      expect(wire).not.toHaveProperty('clientKeyTag')
      expect(wire).not.toHaveProperty('apiKey')
    }
  })

  it('a fresh tag per submit (never reused across seats)', () => {
    const a = convertLlmConfigForWire({ apiKey: 'k1' })
    const b = convertLlmConfigForWire({ apiKey: 'k2' })
    expect(a.clientKeyTag).not.toBe(b.clientKeyTag)
  })

  it('numbers are sent as-is INCLUDING 0 (sentinel values)', () => {
    const wire = convertLlmConfigForWire({
      modelContextWindow: 0,
      summarizeTriggerChars: 0,
      conversationMaxExchanges: 0,
      conversationMaxHistoryChars: 0,
      conversationThinkCharsPerMsg: 0,
      temperature: 0,
      timeoutSeconds: 600,
    })
    expect(wire).toMatchObject({
      modelContextWindow: 0,
      summarizeTriggerChars: 0,
      conversationMaxExchanges: 0,
      conversationMaxHistoryChars: 0,
      conversationThinkCharsPerMsg: 0,
      temperature: 0,
      timeoutSeconds: 600,
    })
  })

  it('booleans pass as-is, including false', () => {
    const wire = convertLlmConfigForWire({ thinkingEnabled: false, temperatureEnabled: true, streamingEnabled: false })
    expect(wire).toEqual({ thinkingEnabled: false, temperatureEnabled: true, streamingEnabled: false })
  })

  it('empty strings are OMITTED (server default); whitespace-only too; others trimmed', () => {
    const wire = convertLlmConfigForWire({
      model: '',
      apiEndpoint: '   ',
      personalityName: '  Grumpy Pro  ',
      botName: '',
    })
    expect(wire).not.toHaveProperty('model')
    expect(wire).not.toHaveProperty('apiEndpoint')
    expect(wire).not.toHaveProperty('botName')
    expect(wire.personalityName).toBe('Grumpy Pro')
  })
})

describe('llmConfigsForSeats — alignment', () => {
  it('one entry per LLM seat in seat order; non-LLM seats are skipped', () => {
    const out = llmConfigsForSeats(
      ['HUMAN', 'COMPUTER_LLM', 'SIM', 'COMPUTER_LLM'],
      [undefined, { model: 'a' }, { model: 'ignored' }, { model: 'b' }],
    )
    expect(out).toEqual([{ model: 'a' }, { model: 'b' }])
  })

  it('an LLM seat with no config becomes null (server defaults)', () => {
    expect(llmConfigsForSeats(['HUMAN', 'COMPUTER_LLM'], [undefined, undefined])).toEqual([null])
  })

  it('undefined when there is no LLM seat, so the arg is omitted', () => {
    expect(llmConfigsForSeats(['HUMAN', 'COMPUTER_MAD', 'SIM'], [{}, {}, {}])).toBeUndefined()
    expect(llmConfigsForSeats([], [])).toBeUndefined()
  })
})

/**
 * A seat with no endpoint makes the SERVER dial its own
 * localhost default, which the keyless deployment cannot serve — the seat dies
 * at its first turn. The panel keys its warning off this pure check.
 */
describe('llmSeatEndpointProblem — endpoint legibility (gap 2)', () => {
  it('reports "missing" for the server-default shapes (absent, "", whitespace, non-string)', () => {
    expect(llmSeatEndpointProblem({})).toBe('missing')
    expect(llmSeatEndpointProblem({ apiEndpoint: '' })).toBe('missing')
    expect(llmSeatEndpointProblem({ apiEndpoint: '   ' })).toBe('missing')
    expect(llmSeatEndpointProblem({ apiEndpoint: null })).toBe('missing')
    expect(llmSeatEndpointProblem({ apiEndpoint: 42 })).toBe('missing')
  })

  it('accepts a chosen provider endpoint as-is (the proxy re-validates it)', () => {
    for (const p of LLM_PROVIDERS) {
      expect(llmSeatEndpointProblem({ apiEndpoint: p.endpoint })).toBeNull()
    }
  })

  it('reports "invalid" for a custom value that is not an http(s) URL', () => {
    for (const bad of ['not a url', 'ftp://provider.example/v1', 'api.example.com/v1', 'https://']) {
      expect(llmSeatEndpointProblem({ apiEndpoint: bad })).toBe('invalid')
    }
  })

  it('accepts a custom http(s) URL', () => {
    expect(llmSeatEndpointProblem({ apiEndpoint: 'https://provider.example/v1/chat/completions' })).toBeNull()
    expect(llmSeatEndpointProblem({ apiEndpoint: '  http://127.0.0.1:8080/v1/chat/completions  ' })).toBeNull()
  })
})
