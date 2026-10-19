import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseCapabilities } from './slices/session'
import { doConnect, reset } from './gateway'
import { getState } from './state'
import * as cmds from '../net/commands'

vi.mock('../net/commands', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../net/commands')>()
  return {
    ...actual,
    setGateway: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    getRoomChatId: vi.fn(),
    updatePreferences: vi.fn(),
  }
})

const VALID = {
  llm: true,
  p1: false,
  replayScrubber: true,
  replaySidecar: false,
  serverVersion: '1.4.62-V1',
  playerTypes: ['HUMAN', 'SIM', 'COMPUTER_LLM'],
}

describe('parseCapabilities — connect result', () => {
  it('reads a well-formed capabilities block', () => {
    expect(parseCapabilities({ tableId: 't1', capabilities: VALID })).toEqual(VALID)
  })

  it('missing block, non-object data or malformed fields degrade to null', () => {
    expect(parseCapabilities({ tableId: 't1' })).toBeNull()
    expect(parseCapabilities(null)).toBeNull()
    expect(parseCapabilities(undefined)).toBeNull()
    expect(parseCapabilities('nope')).toBeNull()
    expect(parseCapabilities({ capabilities: null })).toBeNull()
    expect(parseCapabilities({ capabilities: 'llm' })).toBeNull()
    expect(parseCapabilities({ capabilities: { ...VALID, llm: 'yes' } })).toBeNull()
    expect(parseCapabilities({ capabilities: { ...VALID, serverVersion: 1461 } })).toBeNull()
    expect(parseCapabilities({ capabilities: { ...VALID, replayScrubber: undefined } })).toBeNull()
  })

  it('playerTypes: absent or garbage entries are dropped, not fatal', () => {
    expect(parseCapabilities({ capabilities: { ...VALID, playerTypes: undefined } })).toEqual({
      ...VALID,
      playerTypes: [],
    })
    expect(
      parseCapabilities({ capabilities: { ...VALID, playerTypes: ['HUMAN', 7, null, 'COMPUTER_LLM'] } }),
    ).toEqual({ ...VALID, playerTypes: ['HUMAN', 'COMPUTER_LLM'] })
  })
})

class FakeWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances: FakeWebSocket[] = []

  readonly url: string
  readyState = FakeWebSocket.CONNECTING
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onclose: ((ev: { reason?: string; code?: number }) => void) | null = null
  onerror: (() => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED
  }

  triggerOpen() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }
}

describe('doConnect stores capabilities in the session slice', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', FakeWebSocket)
    reset()
    vi.mocked(cmds.disconnect).mockReset().mockResolvedValue({ ok: true } as never)
    vi.mocked(cmds.getRoomChatId).mockReset().mockResolvedValue('room-1')
    vi.mocked(cmds.updatePreferences).mockReset().mockResolvedValue({ ok: true } as never)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  async function login() {
    const done = doConnect('localhost', 8787, 'localhost', 17171, 'u', 'p')
    FakeWebSocket.instances[FakeWebSocket.instances.length - 1].triggerOpen()
    await vi.advanceTimersByTimeAsync(100)
    await done
  }

  it('a connect result with capabilities lands them in the slice', async () => {
    vi.mocked(cmds.connect).mockReset().mockResolvedValue({ ok: true, data: { capabilities: VALID } } as never)
    await login()
    expect(getState().phase).toBe('lobby')
    expect(getState().capabilities).toEqual(VALID)
  })

  it('a stock connect result (no capabilities field) degrades to null', async () => {
    vi.mocked(cmds.connect).mockReset().mockResolvedValue({ ok: true, data: { tableId: 't1' } } as never)
    await login()
    expect(getState().phase).toBe('lobby')
    expect(getState().capabilities).toBeNull()
  })

  it('a failed login clears any stale capabilities', async () => {
    vi.mocked(cmds.connect).mockReset().mockResolvedValue({ ok: true, data: { capabilities: VALID } } as never)
    await login()
    expect(getState().capabilities).toEqual(VALID)

    vi.mocked(cmds.connect).mockResolvedValue({ ok: false, error: 'boom' } as never)
    await login()
    expect(getState().phase).toBe('idle')
    expect(getState().capabilities).toBeNull()
  })

  it('a malformed capabilities block never breaks the connect path', async () => {
    vi.mocked(cmds.connect).mockReset().mockResolvedValue({ ok: true, data: { capabilities: { llm: 'yes' } } } as never)
    await login()
    expect(getState().phase).toBe('lobby')
    expect(getState().error).toBeNull()
    expect(getState().capabilities).toBeNull()
  })
})
