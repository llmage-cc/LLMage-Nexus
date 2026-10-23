import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { LlmPromptFrame } from '../net/types.generated'
import {
  callProvider, clampTimeoutSeconds, flushUndeliveredLlmAnswers, handleLlmPrompt, isOpencodeHost,
  isRelayRouteMissing, LlmRelayUnavailableError,
  MAX_OPENCODE_SESSIONS, MAX_UNDELIVERED_LLM_ANSWERS, opencodeSessionCount, providerUrl,
  scrubBearerTokens, undeliveredLlmAnswerCount, RELAY_PATH, type LlmBridgeTransport,
} from './bridge'
import { clearSeatKeys, getSeatKey, setSeatEndpoint, setSeatKey, seatEndpointOf } from '../lobby/CreateTable/llmSeatKeys'
import { LLM_PROVIDERS, isRelayEndpoint } from '../lobby/CreateTable/llmConfig'
import { getProxyConfig, resetProxyConfigCache } from '../net/proxyConfig'

const TAG = 'tag-seat-1'
const KEY = 'XXXXXX-not-a-real-key'

const OPENAI = 'https://api.openai.com/v1/chat/completions'
const OPENCODE = 'https://opencode.ai/zen/go/v1/chat/completions'
const OLLAMA_CLOUD = 'https://ollama.com/v1/chat/completions'
const OLLAMA_LOCAL = 'http://localhost:11434/v1/chat/completions'

function promptFrame(over: Partial<LlmPromptFrame> = {}): LlmPromptFrame {
  return {
    type: 'llm_prompt',
    requestId: '11111111-1111-4111-8111-111111111111',
    seatId: 'seat-1',
    gameId: 'game-1',
    playerName: 'LLM Seat',
    requestBody: '{"model":"gpt-5","messages":[]}',
    apiEndpoint: OPENAI,
    stream: false,
    timeoutSeconds: 600,
    clientKeyTag: TAG,
    ...over,
  }
}

function transport() {
  return {
    sendDecision: vi.fn(),
    sendError: vi.fn(),
    log: vi.fn(),
  }
}

/** A fetch stub returning `body`/`status`; `ok` is derived like the real Response. */
function fetchOk(body: string, status = 200) {
  return vi.fn().mockResolvedValue({
    status,
    text: () => Promise.resolve(body),
  })
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  clearSeatKeys()
  setSeatKey(TAG, KEY)
  fetchMock = fetchOk('{}')
  vi.stubGlobal('fetch', fetchMock)
})

describe('providerUrl / isOpencodeHost', () => {
  it('direct endpoints are called as-is', () => {
    expect(providerUrl(OPENAI, false)).toBe(OPENAI)
  })

  it('relay endpoints become the same-origin RELATIVE /llm-relay URL', () => {
    const url = providerUrl(OPENCODE, true)
    expect(url).toBe(`${RELAY_PATH}?url=${encodeURIComponent(OPENCODE)}`)
    expect(url.startsWith('/llm-relay?url=')).toBe(true)
  })

  it('detects the opencode.ai host only', () => {
    expect(isOpencodeHost(OPENCODE)).toBe(true)
    expect(isOpencodeHost(OPENAI)).toBe(false)
    expect(isOpencodeHost('not a url')).toBe(false)
  })
})

describe('callProvider — direct path', () => {
  it('POSTs the server body to the endpoint with the stored key', async () => {
    fetchMock = fetchOk('{"choices":[]}')
    vi.stubGlobal('fetch', fetchMock)

    const res = await callProvider(OPENAI, TAG, '{"model":"gpt-5"}', 30)

    expect(res).toEqual({ rawResponse: '{"choices":[]}', httpStatus: 200, viaRelay: false })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(OPENAI)
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{"model":"gpt-5"}')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.headers.Accept).toBe('application/json')
    expect(init.headers.Authorization).toBe('Bearer ' + KEY)
    expect(init.headers['x-opencode-session']).toBeUndefined()
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('a custom https endpoint outside the provider table is browser-direct', async () => {
    await callProvider('https://custom.example/v1/chat/completions', TAG, '{}', 30)
    expect(fetchMock.mock.calls[0][0]).toBe('https://custom.example/v1/chat/completions')
  })

  it('a local ollama endpoint (http, in the table with needsRelay:false) is browser-direct', async () => {
    await callProvider(OLLAMA_LOCAL, TAG, '{}', 30)
    expect(fetchMock.mock.calls[0][0]).toBe(OLLAMA_LOCAL)
  })
})

describe('callProvider — relay path', () => {
  it('routes a relay provider through the relative /llm-relay URL and adds x-opencode-session', async () => {
    await callProvider(OPENCODE, TAG, '{"model":"zen"}', 30)

    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toBe(`${RELAY_PATH}?url=${encodeURIComponent(OPENCODE)}`)
    // relative: no origin, so the request stays same-origin with the page
    expect(url.startsWith('http')).toBe(false)
    expect(decodeURIComponent(url.split('url=')[1])).toBe(OPENCODE)
    expect(fetchMock.mock.calls[0][1].headers['x-opencode-session']).toMatch(/^nexus-/)
  })

  it('a relay provider that is not opencode gets no session header', async () => {
    await callProvider(OLLAMA_CLOUD, TAG, '{}', 30)
    expect(fetchMock.mock.calls[0][0]).toBe(`${RELAY_PATH}?url=${encodeURIComponent(OLLAMA_CLOUD)}`)
    expect(fetchMock.mock.calls[0][1].headers['x-opencode-session']).toBeUndefined()
  })

  it('the opencode session id is stable per key tag', async () => {
    await callProvider(OPENCODE, TAG, '{}', 30)
    await callProvider(OPENCODE, TAG, '{}', 30)
    const first = fetchMock.mock.calls[0][1].headers['x-opencode-session']
    const second = fetchMock.mock.calls[1][1].headers['x-opencode-session']
    expect(first).toBe(second)
  })
})

describe('handleLlmPrompt — success', () => {
  it('a 2xx provider answer sends llm_decision with the raw body and status', async () => {
    fetchMock = fetchOk('{"choices":[{"message":{"content":"pass"}}]}', 200)
    vi.stubGlobal('fetch', fetchMock)
    const t = transport()

    handleLlmPrompt(promptFrame(), t)

    await vi.waitFor(() => expect(t.sendDecision).toHaveBeenCalledTimes(1))
    expect(t.sendError).not.toHaveBeenCalled()
    expect(t.sendDecision).toHaveBeenCalledWith({
      requestId: '11111111-1111-4111-8111-111111111111',
      rawResponse: '{"choices":[{"message":{"content":"pass"}}]}',
      httpStatus: 200,
    })
  })

  it('the API key NEVER reaches either transport message', async () => {
    const t = transport()
    handleLlmPrompt(promptFrame(), t)
    await vi.waitFor(() => expect(t.sendDecision).toHaveBeenCalled())

    for (const call of [...t.sendDecision.mock.calls, ...t.sendError.mock.calls]) {
      expect(JSON.stringify(call)).not.toContain(KEY)
    }
  })
})

describe('handleLlmPrompt — missing key', () => {
  it('sends an immediate non-retryable llm_error and never calls the provider', async () => {
    clearSeatKeys()
    const t = transport()

    handleLlmPrompt(promptFrame(), t)

    expect(t.sendError).toHaveBeenCalledTimes(1)
    const err = t.sendError.mock.calls[0][0]
    expect(err.requestId).toBe('11111111-1111-4111-8111-111111111111')
    expect(err.retryable).toBe(false)
    // The seat key-missing text is i18n (test suite runs in Spanish by default):
    // assert the meaning, not one locale's wording.
    expect(err.message).toMatch(/clave|key/i)
    expect(err.httpStatus).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(t.sendDecision).not.toHaveBeenCalled()
    expect(t.log).toHaveBeenCalledWith('error', expect.stringMatching(/clave|key/i), 'system')
  })
})

describe('handleLlmPrompt — non-2xx', () => {
  const cases: Array<[number, boolean]> = [
    [400, false],
    [401, false],
    [404, false],
    [422, false],
    [429, true],
    [500, true],
    [503, true],
  ]

  for (const [status, retryable] of cases) {
    it(`HTTP ${status} → llm_error retryable:${retryable} with the provider body`, async () => {
      fetchMock = fetchOk('rate limited, slow down', status)
      vi.stubGlobal('fetch', fetchMock)
      const t = transport()

      handleLlmPrompt(promptFrame(), t)

      await vi.waitFor(() => expect(t.sendError).toHaveBeenCalledTimes(1))
      const err = t.sendError.mock.calls[0][0]
      expect(err.retryable).toBe(retryable)
      expect(err.httpStatus).toBe(status)
      expect(err.message).toBe(`HTTP ${status} from provider (browser-direct): rate limited, slow down`)
      expect(t.sendDecision).not.toHaveBeenCalled()
    })
  }

  it('a relay-routed failure says "via relay"; the body is capped at 400 chars', async () => {
    const huge = 'x'.repeat(1000)
    fetchMock = fetchOk(huge, 500)
    vi.stubGlobal('fetch', fetchMock)
    const t = transport()

    handleLlmPrompt(promptFrame({ apiEndpoint: OPENCODE }), t)

    await vi.waitFor(() => expect(t.sendError).toHaveBeenCalledTimes(1))
    const err = t.sendError.mock.calls[0][0]
    expect(err.message.startsWith('HTTP 500 from provider (via relay): ')).toBe(true)
    expect(err.message.slice('HTTP 500 from provider (via relay): '.length)).toHaveLength(400)
  })
})

describe('handleLlmPrompt — transport failure', () => {
  it('a thrown fetch (CORS / network) sends a retryable llm_error', async () => {
    fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)
    const t = transport()

    handleLlmPrompt(promptFrame(), t)

    await vi.waitFor(() => expect(t.sendError).toHaveBeenCalledTimes(1))
    const err = t.sendError.mock.calls[0][0]
    expect(err.retryable).toBe(true)
    expect(err.httpStatus).toBeUndefined()
    expect(err.message).toContain('Browser LLM call failed: Failed to fetch')
  })

  it('an aborted call (timeout) sends a retryable llm_error', async () => {
    const abortErr = new Error('The operation was aborted')
    abortErr.name = 'AbortError'
    fetchMock = vi.fn().mockRejectedValue(abortErr)
    vi.stubGlobal('fetch', fetchMock)
    const t = transport()

    handleLlmPrompt(promptFrame({ timeoutSeconds: 1 }), t)

    await vi.waitFor(() => expect(t.sendError).toHaveBeenCalledTimes(1))
    expect(t.sendError.mock.calls[0][0].retryable).toBe(true)
  })

  it('handleLlmPrompt never throws to its caller (fire-and-forget)', () => {
    fetchMock = vi.fn().mockRejectedValue(new Error('boom'))
    vi.stubGlobal('fetch', fetchMock)
    const t = transport()
    expect(() => handleLlmPrompt(promptFrame(), t)).not.toThrow()
  })
})

describe('relay decision (single source: the provider table)', () => {
  it('classifies every provider table entry by its needsRelay flag', () => {
    for (const p of LLM_PROVIDERS) {
      expect(isRelayEndpoint(p.endpoint)).toBe(p.needsRelay)
    }
  })

  it('the contract pins opencode-go and ollama-cloud to the relay; the rest is direct', () => {
    expect(isRelayEndpoint(OPENCODE)).toBe(true)
    expect(isRelayEndpoint(OLLAMA_CLOUD)).toBe(true)
    expect(isRelayEndpoint(OPENAI)).toBe(false)
    expect(isRelayEndpoint(OLLAMA_LOCAL)).toBe(false)
    expect(isRelayEndpoint('https://api.groq.com/openai/v1/chat/completions')).toBe(false)
  })

  it('an unknown/custom endpoint is browser-direct', () => {
    expect(isRelayEndpoint('https://custom.example/v1/chat/completions')).toBe(false)
    expect(isRelayEndpoint('')).toBe(false)
  })
})

describe('relay route availability (G1 — deployment without /llm-relay)', () => {
  /** Probe a deployment whose /config reports the given llmRelay flag. */
  const probeRelay = (llmRelay: boolean) =>
    getProxyConfig(
      async () => ({ ok: true, status: 200, json: async () => ({ llmRelay }) }),
      'http://proxy:8788',
    )

  afterEach(() => resetProxyConfigCache())

  it('callProvider refuses a relay endpoint before any fetch and raises the typed error', async () => {
    await probeRelay(false)
    expect(isRelayRouteMissing()).toBe(true)

    await expect(callProvider(OLLAMA_CLOUD, TAG, '{}', 30)).rejects.toBeInstanceOf(LlmRelayUnavailableError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers a relay-only provider with a non-retryable llm_error naming the cause', async () => {
    await probeRelay(false)
    const t = transport()

    handleLlmPrompt(promptFrame({ apiEndpoint: OLLAMA_CLOUD }), t)

    await vi.waitFor(() => expect(t.sendError).toHaveBeenCalledTimes(1))
    const err = t.sendError.mock.calls[0][0]
    expect(err.retryable).toBe(false)
    expect(err.httpStatus).toBeUndefined()
    expect(err.message).toContain(RELAY_PATH)
    expect(err.message).toContain('--llmRelayEnabled')
    expect(err.message).toContain(OLLAMA_CLOUD)
    expect(t.log).toHaveBeenCalledWith('error', err.message, 'system')
    expect(t.sendDecision).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a direct provider still works when the deployment has no relay', async () => {
    await probeRelay(false)
    const t = transport()

    handleLlmPrompt(promptFrame(), t)

    await vi.waitFor(() => expect(t.sendDecision).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(OPENAI)
    expect(t.sendError).not.toHaveBeenCalled()
  })

  it('a relay provider still routes through /llm-relay when the deployment enables it', async () => {
    await probeRelay(true)
    expect(isRelayRouteMissing()).toBe(false)
    const t = transport()

    handleLlmPrompt(promptFrame({ apiEndpoint: OPENCODE }), t)

    await vi.waitFor(() => expect(t.sendDecision).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][0]).toBe(`${RELAY_PATH}?url=${encodeURIComponent(OPENCODE)}`)
  })

  it('an unprobed deployment is attempted instead of blocked', async () => {
    expect(isRelayRouteMissing()).toBe(false)
    const t = transport()

    handleLlmPrompt(promptFrame({ apiEndpoint: OPENCODE }), t)

    await vi.waitFor(() => expect(t.sendDecision).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('key store', () => {
  it('getSeatKey throws when no key is stored (callers must check hasSeatKey first)', () => {
    clearSeatKeys()
    expect(() => getSeatKey(TAG)).toThrow(/No API key stored/)
  })
})

describe('endpoint binding — the key store', () => {
  it('setSeatEndpoint binds the chosen endpoint to a tag that has a key', () => {
    setSeatEndpoint(TAG, ' ' + OPENAI + ' ')
    expect(seatEndpointOf(TAG)).toBe(OPENAI)
  })

  it('an endpoint can never create a keyless entry (unknown tags are ignored)', () => {
    clearSeatKeys()
    setSeatEndpoint('no-key-tag', OPENAI)
    expect(seatEndpointOf('no-key-tag')).toBeNull()
    expect(() => getSeatKey('no-key-tag')).toThrow(/No API key stored/)
  })

  it('a re-set key keeps the binding; a cleared key drops the whole entry', () => {
    setSeatEndpoint(TAG, OPENAI)
    setSeatKey(TAG, '«another»')
    expect(seatEndpointOf(TAG)).toBe(OPENAI)
    setSeatKey(TAG, '   ')
    expect(seatEndpointOf(TAG)).toBeNull()
  })

  it('clearSeatKeys drops the bindings too', () => {
    setSeatEndpoint(TAG, OPENAI)
    clearSeatKeys()
    expect(seatEndpointOf(TAG)).toBeNull()
  })
})

describe('handleLlmPrompt — endpoint binding', () => {
  it('a matching bound endpoint fetches normally', async () => {
    setSeatEndpoint(TAG, OPENAI)
    const t = transport()

    handleLlmPrompt(promptFrame(), t)

    await vi.waitFor(() => expect(t.sendDecision).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(t.sendError).not.toHaveBeenCalled()
  })

  it('a mismatching frame endpoint answers llm_error retryable:false and NEVER fetches', async () => {
    setSeatEndpoint(TAG, OPENAI)
    const t = transport()

    handleLlmPrompt(promptFrame({ apiEndpoint: 'https://evil.example/v1/chat/completions' }), t)

    expect(t.sendError).toHaveBeenCalledTimes(1)
    const err = t.sendError.mock.calls[0][0]
    expect(err.requestId).toBe('11111111-1111-4111-8111-111111111111')
    expect(err.retryable).toBe(false)
    expect(err.message).toContain('endpoint mismatch')
    expect(err.message).toContain(OPENAI)
    expect(err.message).toContain('https://evil.example/v1/chat/completions')
    expect(err.httpStatus).toBeUndefined()
    // The key never leaves the browser: no provider request at all.
    expect(fetchMock).not.toHaveBeenCalled()
    expect(t.sendDecision).not.toHaveBeenCalled()
    expect(t.log).toHaveBeenCalledWith('error', expect.stringContaining('endpoint mismatch'), 'system')
  })

  it('whitespace around the frame endpoint does not defeat the exact-match binding', async () => {
    setSeatEndpoint(TAG, OPENAI)
    const t = transport()

    handleLlmPrompt(promptFrame({ apiEndpoint: '  ' + OPENAI + '  ' }), t)

    await vi.waitFor(() => expect(t.sendDecision).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('an empty stored endpoint falls through to https-only enforcement', async () => {
    setSeatEndpoint(TAG, '')
    const t = transport()

    handleLlmPrompt(promptFrame(), t)

    await vi.waitFor(() => expect(t.sendDecision).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('an empty stored endpoint REJECTS a plain-http frame endpoint (no key to http)', async () => {
    setSeatEndpoint(TAG, '')
    const t = transport()

    handleLlmPrompt(promptFrame({ apiEndpoint: OLLAMA_LOCAL }), t)

    expect(t.sendError).toHaveBeenCalledTimes(1)
    const err = t.sendError.mock.calls[0][0]
    expect(err.retryable).toBe(false)
    expect(err.message).toContain('non-https')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a bound local-ollama (http) endpoint IS allowed when it matches the binding', async () => {
    setSeatEndpoint(TAG, OLLAMA_LOCAL)
    const t = transport()

    handleLlmPrompt(promptFrame({ apiEndpoint: OLLAMA_LOCAL }), t)

    await vi.waitFor(() => expect(t.sendDecision).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('the key itself never appears in the mismatch error message', async () => {
    setSeatEndpoint(TAG, OPENAI)
    const t = transport()

    handleLlmPrompt(promptFrame({ apiEndpoint: 'https://evil.example/x' }), t)

    expect(JSON.stringify(t.sendError.mock.calls[0][0])).not.toContain(KEY)
  })
})

describe('handleLlmPrompt — stream flag', () => {
  it('a stream:true frame logs the not-supported note and answers complete', async () => {
    const t = transport()

    handleLlmPrompt(promptFrame({ stream: true, apiEndpoint: 'https://custom.example/v1/chat/completions' }), t)

    await vi.waitFor(() => expect(t.sendDecision).toHaveBeenCalledTimes(1))
    expect(t.log).toHaveBeenCalledWith(
      'info',
      expect.stringContaining('streaming not supported'),
      'system',
    )
  })

  it('stream:false stays silent (no noise in the normal path)', async () => {
    const t = transport()

    handleLlmPrompt(promptFrame(), t)

    await vi.waitFor(() => expect(t.sendDecision).toHaveBeenCalledTimes(1))
    const infoCalls = t.log.mock.calls.filter((c) => c[0] === 'info')
    expect(infoCalls).toHaveLength(0)
  })
})

describe('timeout clamp', () => {
  // The clamp formula: Math.min(Math.max(Number(t) || 0, 1), 600).
  // 0/NaN/negative land on the 1s floor (never an instant setTimeout(0) abort);
  // 1e9 pins at the 600s ceiling (the seat-config default).
  it('clamps to [1, 600]; 0/NaN/negative become the 1s floor, 1e9 the 600s ceiling', () => {
    expect(clampTimeoutSeconds(30)).toBe(30)
    expect(clampTimeoutSeconds(1)).toBe(1)
    expect(clampTimeoutSeconds(600)).toBe(600)
    expect(clampTimeoutSeconds(1e9)).toBe(600)
    expect(clampTimeoutSeconds(0)).toBe(1)
    expect(clampTimeoutSeconds(-5)).toBe(1)
    expect(clampTimeoutSeconds(Number.NaN)).toBe(1)
    expect(clampTimeoutSeconds(Number('abc'))).toBe(1)
  })
})

describe('bearer scrub — provider error bodies', () => {
  it('scrubBearerTokens replaces bearer-like runs with [redacted]', () => {
    // The whole "Bearer <token>" run is redacted (the scheme word carries no diagnostics).
    expect(scrubBearerTokens('Bearer XXXXXX-not-a-real-key')).toBe('[redacted]')
    expect(scrubBearerTokens('header was Bearer  eyJhbGciOi.12345, status 401')).toBe('header was [redacted], status 401')
    expect(scrubBearerTokens('token: Bearer abcdefgh1234 end')).toBe('token: [redacted] end')
  })

  it('keeps ordinary diagnostics intact', () => {
    expect(scrubBearerTokens('rate limited, slow down')).toBe('rate limited, slow down')
    expect(scrubBearerTokens('model gpt-5 not found')).toBe('model gpt-5 not found')
    // A short bearer-looking token under the 8-char threshold stays (not a key).
    expect(scrubBearerTokens('Bearer short')).toBe('Bearer short')
  })

  it('a provider error body echoing the Authorization header never reaches llm_error with the key', async () => {
    const keyish = 'XXXXXX-not-a-real-key'
    setSeatKey(TAG, keyish)
    fetchMock = fetchOk(`upstream refused: Authorization: Bearer ${keyish} is invalid`, 401)
    vi.stubGlobal('fetch', fetchMock)
    const t = transport()

    handleLlmPrompt(promptFrame(), t)

    await vi.waitFor(() => expect(t.sendError).toHaveBeenCalledTimes(1))
    const err = t.sendError.mock.calls[0][0]
    expect(err.message).not.toContain(keyish)
    expect(err.message).toContain('[redacted]')
    expect(err.message).toContain('upstream refused')
    expect(err.httpStatus).toBe(401)
  })

  it('the scrub is applied BEFORE the 400-char slice (a long padded secret is fully removed)', async () => {
    const keyish = 'XXXXXX-not-a-real-key-' + 'a'.repeat(300)
    setSeatKey(TAG, keyish)
    const body = `x Bearer ${keyish} then ${'y'.repeat(1000)}`
    fetchMock = fetchOk(body, 500)
    vi.stubGlobal('fetch', fetchMock)
    const t = transport()

    handleLlmPrompt(promptFrame(), t)

    await vi.waitFor(() => expect(t.sendError).toHaveBeenCalledTimes(1))
    const err = t.sendError.mock.calls[0][0]
    expect(err.message).not.toContain('Bearer ' + keyish)
    expect(err.message).toContain('[redacted]')
  })
})

/**
 * One OpenCode session id per key-tag and nothing pruned the tags of
 * tables that are gone, so a long page session accumulated them forever.
 */
describe('opencodeSessions — bounded', () => {
  it('caps the remembered session ids', async () => {
    for (let i = 0; i < MAX_OPENCODE_SESSIONS + 4; i++) {
      const tag = 'oc-tag-' + i
      setSeatKey(tag, 'XXXXXX-not-a-real-key-' + i)
      await callProvider(OPENCODE, tag, '{}', 30)
    }
    expect(opencodeSessionCount()).toBe(MAX_OPENCODE_SESSIONS)
  })
})

/**
 * An answer the socket could not carry is held and re-sent when the
 * gateway is live again — the server correlates it by requestId, so the
 * exchange no longer has to burn its whole timeout for an answer the browser
 * already had. The hold rule keys off the `send()` result the caller's transport
 * hands back (production: `cmds.llmDecision` / `cmds.llmError`).
 */
describe('llm answer queue — behind the send() result', () => {
  const NOT_CONNECTED = { type: 'result', ok: false, error: 'not connected', errorCode: 'NOT_CONNECTED' }
  const DELIVERED = { type: 'result', ok: true }

  /** A transport whose `send*` answers with the gateway envelope (async, like the real one). */
  function answerTransport(isOpen: () => boolean) {
    const frames: Array<{ verb: 'decision' | 'error'; args: unknown }> = []
    const record = (verb: 'decision' | 'error', args: unknown) => {
      if (!isOpen()) return Promise.resolve(NOT_CONNECTED)
      frames.push({ verb, args })
      return Promise.resolve(DELIVERED)
    }
    const transport: LlmBridgeTransport = {
      sendDecision: (args) => record('decision', args),
      sendError: (args) => record('error', args),
      log: vi.fn(),
    }
    return { frames, transport }
  }

  /** Let the transport's promises settle before asserting on the queue. */
  const settled = () => new Promise((r) => setTimeout(r, 0))

  it('holds an answer the socket refused and re-sends it, wire-identical, once it is back', async () => {
    let open = false
    const { frames, transport } = answerTransport(() => open)

    handleLlmPrompt(promptFrame(), transport)
    await vi.waitFor(() => expect(undeliveredLlmAnswerCount()).toBe(1))
    expect(frames).toHaveLength(0)

    open = true
    await flushUndeliveredLlmAnswers()

    expect(frames).toEqual([{
      verb: 'decision',
      args: { requestId: '11111111-1111-4111-8111-111111111111', rawResponse: '{}', httpStatus: 200 },
    }])
    expect(undeliveredLlmAnswerCount()).toBe(0)
  })

  it('never holds a delivered answer nor a sent-but-unanswered one (no duplicate frame)', async () => {
    const { frames, transport } = answerTransport(() => true)
    handleLlmPrompt(promptFrame(), transport)
    await vi.waitFor(() => expect(frames).toHaveLength(1))
    await settled()
    expect(undeliveredLlmAnswerCount()).toBe(0)

    // 'timeout' means the frame DID leave the browser (the proxy may have
    // processed it): re-sending would duplicate the answer for one requestId.
    handleLlmPrompt(promptFrame({ requestId: 'req-timeout' }), {
      sendDecision: () => Promise.resolve({ type: 'result', ok: false, error: 'timeout', errorCode: 'TIMEOUT' }),
      sendError: () => Promise.resolve({ type: 'result', ok: false, error: 'timeout', errorCode: 'TIMEOUT' }),
    })
    await settled()
    expect(undeliveredLlmAnswerCount()).toBe(0)
  })

  it('holds an immediate refusal (no key) too, keeps it while the socket stays down, caps the queue, then drains', async () => {
    let open = false
    const { frames, transport } = answerTransport(() => open)
    clearSeatKeys()
    handleLlmPrompt(promptFrame(), transport)
    await vi.waitFor(() => expect(undeliveredLlmAnswerCount()).toBe(1))

    for (let i = 0; i < MAX_UNDELIVERED_LLM_ANSWERS + 3; i++) {
      handleLlmPrompt(promptFrame({ requestId: 'req-' + i }), transport)
    }
    await vi.waitFor(() => expect(undeliveredLlmAnswerCount()).toBe(MAX_UNDELIVERED_LLM_ANSWERS))

    await flushUndeliveredLlmAnswers()
    expect(frames).toHaveLength(0)
    expect(undeliveredLlmAnswerCount()).toBe(MAX_UNDELIVERED_LLM_ANSWERS)

    open = true
    await flushUndeliveredLlmAnswers()
    expect(undeliveredLlmAnswerCount()).toBe(0)
    expect(frames).toHaveLength(MAX_UNDELIVERED_LLM_ANSWERS)
  })
})
