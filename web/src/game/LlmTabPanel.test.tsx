import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import LlmTabPanel, { revealNestedSummary } from './LlmTabPanel'
import { reset } from '../state/store'
import { setLanguage } from '../i18n'
import { setState } from '../state/state'
import { makeGameView, makePlayer } from '../__fixtures__/gameViews'
import { LLM_MESSAGE_WINDOW } from './llmTab'
import type { GameView, LLMConversationView } from '../net/types'
import type { ReplayState } from '../state/slices/replay'

vi.mock('./llmTranscript', () => ({ downloadLlmTranscript: vi.fn(() => true) }))
import { downloadLlmTranscript } from './llmTranscript'

const CAPS = { llm: true, p1: false, replayScrubber: true, replaySidecar: true, serverVersion: 'x', playerTypes: [] }

function conv(playerName: string, extra: Partial<LLMConversationView> = {}): LLMConversationView {
  return {
    playerName,
    modelName: 'model-x',
    exchangeCount: 1,
    totalContextChars: 12,
    modelContextWindow: 8000,
    streaming: false,
    streamingStartedAt: 0,
    messages: [{ role: 'assistant', content: 'Answer\n[model_reasoning]why[/model_reasoning]' }],
    ...extra,
  }
}

const liveGame = () =>
  makeGameView({
    players: [
      makePlayer({ playerId: 'me', name: 'Me', controlled: true }),
      makePlayer({ playerId: 'opp', name: 'Opp' }),
    ],
    myPlayerId: 'me',
  })

function replay(extra: Partial<ReplayState> = {}): ReplayState {
  return {
    gameId: 'g',
    frame: null,
    stateIndex: 1,
    stateCount: 3,
    frameCount: 1,
    playing: false,
    done: null,
    llmFrames: [],
    gameLog: [],
    hasLlmPlayers: true,
    ...extra,
  }
}

describe('LlmTabPanel', () => {
  beforeEach(() => {
    reset()
    setLanguage('en')
  })
  afterEach(() => cleanup())

  it('renders nothing without the llm capability', () => {
    setState({ capabilities: { ...CAPS, llm: false }, game: liveGame(), replay: null })
    const { container } = render(<LlmTabPanel />)
    expect(container.firstChild).toBeNull()
  })

  it('renders a live LLM player and splits the assistant reasoning', () => {
    setState({ capabilities: CAPS, game: makeGameView({ ...liveGame(), llmDebug: [conv('Opp')] }), replay: null })
    render(<LlmTabPanel />)
    expect(screen.getByTestId('llm-tab')).toBeDefined()
    expect(screen.getByTestId('llm-player').textContent).toContain('Opp')
    expect(screen.getByTestId('llm-message').textContent).toContain('Answer')
    expect(screen.getByText('Reasoning')).toBeDefined()
  })

  it('shows the private-chat empty copy for an LLM game with a filtered (empty) list', () => {
    const withFlag = { ...liveGame(), hasLlmPlayers: true } as GameView
    setState({ capabilities: CAPS, game: withFlag, replay: null })
    render(<LlmTabPanel />)
    expect(screen.getByTestId('llm-empty').textContent).toContain('No LLM exchanges are visible to you')
  })

  it('shows the replay empty copy for an LLM replay with no exchanges yet', () => {
    setState({ capabilities: CAPS, game: null, replay: replay({ llmFrames: [] }) })
    render(<LlmTabPanel />)
    expect(screen.getByTestId('llm-empty').textContent).toContain('No LLM exchanges recorded')
  })

  it('renders the replay cumulative view', () => {
    setState({
      capabilities: CAPS,
      game: makeGameView({ ...liveGame(), myPlayerId: null, players: [makePlayer({ playerId: 'o', name: 'O' })] }),
      replay: replay({ llmFrames: [{ stateIndex: 1, entries: [conv('A')] }] }),
    })
    render(<LlmTabPanel />)
    expect(screen.getByTestId('llm-player').textContent).toContain('A')
  })

  it('marks streaming content when a stream is in progress', () => {
    setState({
      capabilities: CAPS,
      game: makeGameView({ ...liveGame(), llmDebug: [conv('Opp', { streaming: true, streamingContent: 'partial' })] }),
      replay: null,
    })
    render(<LlmTabPanel />)
    expect(screen.getByTestId('llm-streaming-content').textContent).toBe('partial')
  })

  it('renders only a windowed tail of a very long conversation', () => {
    const many = Array.from({ length: 300 }, (_, i) => ({ role: 'assistant' as const, content: `m${i}` }))
    setState({
      capabilities: CAPS,
      game: makeGameView({ ...liveGame(), llmDebug: [conv('Opp', { messages: many })] }),
      replay: null,
    })
    render(<LlmTabPanel />)
    const rendered = screen.getAllByTestId('llm-message')
    expect(rendered.length).toBe(LLM_MESSAGE_WINDOW)
    expect(rendered.length).toBeLessThan(300)
    // the newest message is the one kept visible
    expect(rendered[rendered.length - 1].textContent).toContain('m299')
    expect(screen.getByTestId('llm-show-older').textContent).toContain(String(300 - LLM_MESSAGE_WINDOW))
  })

  it('reveals the next page of older messages on demand', () => {
    const many = Array.from({ length: 300 }, (_, i) => ({ role: 'assistant' as const, content: `m${i}` }))
    setState({
      capabilities: CAPS,
      game: makeGameView({ ...liveGame(), llmDebug: [conv('Opp', { messages: many })] }),
      replay: null,
    })
    render(<LlmTabPanel />)
    fireEvent.click(screen.getByTestId('llm-show-older'))
    expect(screen.getAllByTestId('llm-message').length).toBe(LLM_MESSAGE_WINDOW * 2)
    expect(screen.getAllByTestId('llm-message').length).toBeLessThan(300)
  })

  it('keeps the streaming box live while the history is windowed', () => {
    const many = Array.from({ length: 300 }, (_, i) => ({ role: 'assistant' as const, content: `m${i}` }))
    setState({
      capabilities: CAPS,
      game: makeGameView({
        ...liveGame(),
        llmDebug: [conv('Opp', { messages: many, streaming: true, streamingContent: 'partial' })],
      }),
      replay: null,
    })
    render(<LlmTabPanel />)
    expect(screen.getByTestId('llm-streaming-content').textContent).toBe('partial')
    expect(screen.getAllByTestId('llm-message').length).toBe(LLM_MESSAGE_WINDOW)
  })

  it('notes how many older messages the live wire hid', () => {
    setState({
      capabilities: CAPS,
      game: makeGameView({
        ...liveGame(),
        llmDebug: [conv('Opp', { messagesHidden: 80, messages: [{ role: 'assistant', content: 'latest' }] })],
      }),
      replay: null,
    })
    render(<LlmTabPanel />)
    expect(screen.getByTestId('llm-messages-hidden').textContent).toContain('80')
    expect(screen.queryByTestId('llm-show-older')).toBeNull()
  })

  it('offers a transcript download per seat, carrying the live game id', () => {
    vi.mocked(downloadLlmTranscript).mockClear()
    setState({
      capabilities: CAPS,
      game: makeGameView({ ...liveGame(), llmDebug: [conv('Opp')] }),
      replay: null,
      gameId: 'live-game-1',
    })
    render(<LlmTabPanel />)
    const button = screen.getByTestId('llm-download-transcript')
    expect(button.textContent).toBe('Download transcript')
    fireEvent.click(button)
    expect(downloadLlmTranscript).toHaveBeenCalledTimes(1)
    expect(downloadLlmTranscript).toHaveBeenCalledWith(
      expect.objectContaining({ playerName: 'Opp' }),
      { gameId: 'live-game-1' },
    )
  })

  it('exports a replay seat under the REPLAY game id, not the live one', () => {
    vi.mocked(downloadLlmTranscript).mockClear()
    setState({
      capabilities: CAPS,
      game: makeGameView({ ...liveGame(), myPlayerId: null, players: [makePlayer({ playerId: 'o', name: 'O' })] }),
      replay: replay({ gameId: 'replay-9', llmFrames: [{ stateIndex: 1, entries: [conv('A')] }] }),
      gameId: 'stale-live-id',
    })
    render(<LlmTabPanel />)
    fireEvent.click(screen.getByTestId('llm-download-transcript'))
    expect(downloadLlmTranscript).toHaveBeenCalledWith(expect.objectContaining({ playerName: 'A' }), {
      gameId: 'replay-9',
    })
  })
})

/* jsdom has no layout engine: the drawer's scroll contract is pinned on the source
   CSS (same approach as CreateTable/createTableScroll.test.ts) plus the DOM shape. */
const squeeze = (s: string) => [...s].filter((c) => c.charCodeAt(0) >= 33).join('')

function ruleBody(selector: string, css: string): string {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const at = clean.indexOf(`${selector} {`)
  expect(at, `a ${selector} rule must exist in the source css`).toBeGreaterThanOrEqual(0)
  const open = clean.indexOf('{', at)
  const close = clean.indexOf('}', open)
  return squeeze(clean.slice(open + 1, close))
}

const panelCss = readFileSync(join(__dirname, 'LlmTabPanel.css'), 'utf8')
const remedyCss = squeeze(readFileSync(join(__dirname, '..', 'styles.css'), 'utf8'))

function longMessage() {
  setState({
    capabilities: CAPS,
    game: makeGameView({ ...liveGame(), llmDebug: [conv('Opp')] }),
    replay: null,
  })
  render(<LlmTabPanel />)
  const message = screen.getByTestId('llm-message') as HTMLDetailsElement
  const nested = message.querySelector('details.llm-reasoning > summary') as HTMLElement
  const spy = vi.fn()
  nested.scrollIntoView = spy
  return { message, nested, spy }
}

describe('LlmTabPanel — the pane that can clip a nested Reasoning row', () => {
  beforeEach(() => {
    reset()
    setLanguage('en')
  })
  afterEach(() => cleanup())

  it('keeps the nested Reasoning summary inside the pane carrying the shared remedy', () => {
    longMessage()
    const tab = screen.getByTestId('llm-tab')
    const pane = tab.firstElementChild as HTMLElement
    expect(pane.classList.contains('llm-tab-list')).toBe(true)
    expect(pane.classList.contains('scroll-pane'), 'the shared remedy class').toBe(true)
    expect(pane.contains(screen.getByText('Reasoning'))).toBe(true)
    expect(pane.getAttribute('style'), 'no inline fixed height on the pane').toBeNull()
    expect(tab.getAttribute('style'), 'no inline fixed height on the panel').toBeNull()
  })

  it('the shared remedy is a real scroll container bounded by the visible viewport', () => {
    const at = remedyCss.indexOf('.scroll-pane{')
    expect(at).toBeGreaterThanOrEqual(0)
    const rule = remedyCss.slice(at, remedyCss.indexOf('}', at))
    expect(rule).toContain('overflow-y:auto')
    expect(rule).toContain('overscroll-behavior:contain')
    expect(rule).toContain('scrollbar-gutter:stable')
    expect(rule).toContain('max-height:min(var(--scroll-pane-max-h,100%),calc(100dvh-var(--scroll-pane-chrome-h,var(--sp-6))))')
  })

  it('sizes the panel by the drawer flex chain, never by a percentage height', () => {
    const tab = ruleBody('.llm-tab', panelCss)
    expect(tab).toContain('flex:110')
    expect(tab, 'height: 100% silently degrades to auto and spills past the drawer').not.toContain('height:100%')
    expect(ruleBody('.llm-tab-list', panelCss), 'height lives in the flex parent, not here').not.toContain('height:')
  })

  it('reveals the nested Reasoning row when its message expands', () => {
    const { message, spy } = longMessage()
    message.open = true
    revealNestedSummary(message)
    expect(spy).toHaveBeenCalledWith({ block: 'nearest' })
  })

  it('leaves a collapsed message alone, and survives a missing scrollIntoView', () => {
    const { message, nested, spy } = longMessage()
    message.open = false
    revealNestedSummary(message)
    expect(spy).not.toHaveBeenCalled()

    message.open = true
    nested.scrollIntoView = undefined as unknown as typeof nested.scrollIntoView
    expect(() => revealNestedSummary(message)).not.toThrow()
  })

  it('is wired to the message toggle', () => {
    const { message, spy } = longMessage()
    message.open = true
    fireEvent(message, new Event('toggle', { bubbles: true }))
    expect(spy).toHaveBeenCalledWith({ block: 'nearest' })
  })
})
