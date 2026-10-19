import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LlmSeatConfigPanel } from './LlmSeatConfigPanel'
import { defaultLlmConfig } from './llmConfig'
import * as cmds from '../../net/commands'

// The panel calls the two list verbs through the commands module; mock it so the
// picker's loading/error/success transitions run against a controlled answer.
vi.mock('../../net/commands', () => ({
  fetchLlmModels: vi.fn(),
  fetchLlmPersonalities: vi.fn(),
}))

const onModelFetch = () => vi.mocked(cmds.fetchLlmModels)
const onPersonalityFetch = () => vi.mocked(cmds.fetchLlmPersonalities)

describe('LlmSeatConfigPanel — model/personality pickers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  function renderPanel(config: Record<string, unknown> = {}) {
    const onChange = vi.fn()
    render(
      <LlmSeatConfigPanel
        seatIndex={0}
        config={{ ...defaultLlmConfig(), ...config }}
        onChange={onChange}
      />,
    )
    return { onChange }
  }

  it('renders the model field with a fetch button and the free-text input', () => {
    renderPanel()
    expect(screen.getByTestId('llm-model')).toBeDefined()
    expect(screen.getByTestId('llm-model-fetch')).toBeDefined()
    // no fetched list yet: no select
    expect(screen.queryByTestId('llm-model-select')).toBeNull()
  })

  it('fetch success fills the select AND clears the loading flag', async () => {
    let resolve!: (v: cmds.LlmListResult) => void
    onModelFetch().mockReturnValue(new Promise((r) => { resolve = r }))
    renderPanel({ apiEndpoint: 'http://localhost:11434/v1/chat/completions' })

    fireEvent.click(screen.getByTestId('llm-model-fetch'))
    // loading label while in flight
    await waitFor(() => expect(screen.getByTestId('llm-model-fetch').textContent).toMatch(/Obteniendo|Fetching/))
    // the verb was called with the seat endpoint
    expect(cmds.fetchLlmModels).toHaveBeenCalledWith('http://localhost:11434/v1/chat/completions')

    resolve({ ok: true, items: ['gpt-5', 'llama3'], error: '' })
    await waitFor(() => expect(screen.getByTestId('llm-model-select')).toBeDefined())
    const select = screen.getByTestId('llm-model-select') as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.value)).toContain('gpt-5')
    expect(select.options.length).toBe(2 + 2) // placeholder + 2 items + manual
    // loading cleared: the button is back to its idle label
    await waitFor(() => expect(screen.getByTestId('llm-model-fetch').textContent).toMatch(/Obtener lista|Fetch list/))
    expect(screen.getByTestId('llm-model-status').textContent).toMatch(/2/)
  })

  it('fetch failure clears the loading flag (the pitfall) and shows the reason', async () => {
    onModelFetch().mockResolvedValue({ ok: false, items: [], error: 'host blocked', errorCode: 'INVALID_ARGUMENT' })
    renderPanel({ apiEndpoint: 'https://api.example.com/v1/chat/completions' })

    fireEvent.click(screen.getByTestId('llm-model-fetch'))
    await waitFor(() => expect(screen.getByTestId('llm-model-status').textContent).toMatch(/host blocked/))
    // the loading label is gone — a spinner stuck here is exactly the pitfall
    expect(screen.getByTestId('llm-model-fetch').textContent).toMatch(/Obtener lista|Fetch list/)
    expect(screen.queryByTestId('llm-model-select')).toBeNull()
  })

  it('a thrown verb error also clears the loading flag', async () => {
    onModelFetch().mockRejectedValue(new Error('socket gone'))
    renderPanel()
    fireEvent.click(screen.getByTestId('llm-model-fetch'))
    await waitFor(() => expect(screen.getByTestId('llm-model-status').textContent).toMatch(/socket gone/))
    expect(screen.getByTestId('llm-model-fetch').textContent).toMatch(/Obtener lista|Fetch list/)
  })

  it('picking a fetched model writes it into the config', async () => {
    onModelFetch().mockResolvedValue({ ok: true, items: ['gpt-5', 'llama3'], error: '' })
    const { onChange } = renderPanel()
    fireEvent.click(screen.getByTestId('llm-model-fetch'))
    await waitFor(() => expect(screen.getByTestId('llm-model-select')).toBeDefined())

    fireEvent.change(screen.getByTestId('llm-model-select'), { target: { value: 'llama3' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ model: 'llama3' }))
  })

  it('a stored model that is not on the fetched list stays visible in the free-text input', async () => {
    onModelFetch().mockResolvedValue({ ok: true, items: ['gpt-5'], error: '' })
    renderPanel({ model: 'custom-model' })
    fireEvent.click(screen.getByTestId('llm-model-fetch'))
    await waitFor(() => expect(screen.getByTestId('llm-model-select')).toBeDefined())
    const select = screen.getByTestId('llm-model-select') as HTMLSelectElement
    expect(select.value).toBe('__manual__')
    expect((screen.getByTestId('llm-model') as HTMLInputElement).value).toBe('custom-model')
  })

  it('the personality field fetches through its own verb', async () => {
    onPersonalityFetch().mockResolvedValue({ ok: true, items: ['alex', 'blake'], error: '' })
    renderPanel()
    fireEvent.click(screen.getByTestId('llm-tab-personality'))
    fireEvent.click(screen.getByTestId('llm-personality-fetch'))
    expect(cmds.fetchLlmPersonalities).toHaveBeenCalled()
    await waitFor(() => expect(screen.getByTestId('llm-personality-select')).toBeDefined())
  })

  it('the unsupported Anthropic provider is present but DISABLED (not selectable)', () => {
    renderPanel()
    const select = screen.getByTestId('llm-provider') as HTMLSelectElement
    const anthropic = Array.from(select.options).find((o) => o.value === 'anthropic') as HTMLOptionElement
    expect(anthropic).toBeDefined()
    // The same annotation now sits behind a disabled option.
    expect(anthropic.disabled).toBe(true)
    expect(anthropic.textContent).toMatch(/Anthropic/)
    // The supported providers stay selectable.
    const openai = Array.from(select.options).find((o) => o.value === 'openai') as HTMLOptionElement
    expect(openai.disabled).toBe(false)
  })
})

/**
 * The seat is legible about the endpoint it needs BEFORE the game
 * starts, instead of the server dialing its own localhost default and killing
 * the seat at its first turn.
 */
describe('LlmSeatConfigPanel — endpoint requirement (gap 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  function renderPanel(config: Record<string, unknown> = {}) {
    const onChange = vi.fn()
    render(
      <LlmSeatConfigPanel
        seatIndex={1}
        config={{ ...defaultLlmConfig(), ...config }}
        onChange={onChange}
      />,
    )
    return { onChange }
  }

  it('warns at the seat when no provider endpoint is set (the server default)', () => {
    renderPanel()
    const warn = screen.getByTestId('llm-endpoint-problem-1')
    expect(warn).toBeDefined()
    expect(warn.getAttribute('role')).toBe('alert')
    expect((warn.textContent ?? '').trim().length).toBeGreaterThan(0)
  })

  it('no warning once a provider endpoint is chosen', () => {
    renderPanel({ apiEndpoint: 'https://api.openai.com/v1/chat/completions' })
    expect(screen.queryByTestId('llm-endpoint-problem-1')).toBeNull()
  })

  it('flags a custom endpoint that is not an http(s) URL, quoting it', () => {
    renderPanel({ apiEndpoint: 'not-a-url' })
    expect(screen.getByTestId('llm-endpoint-problem-1').textContent).toContain('not-a-url')
  })
})
