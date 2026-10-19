import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Gateway } from './Gateway'
import { setGateway } from './commands'

/**
 * RX-side instrumentation for the hand-play "send-and-silence" finding
 *.
 *
 * The live observation hooked only `WebSocket.prototype.send` (TX); the reply
 * path was never observed. These tests drive the REAL flow —
 * `commands.sendPlayerUUID` → Gateway.send → fake transport → result frame →
 * pending promise resolve — so the reply handling is observable in harness and
 * the wire contract is pinned:
 *   sendPlayerUUID → result(ok:false, reason) → caller sees `!result.ok`.
 *
 * Frame shapes mirror the proxy's GameCommands.answer/ProxyProtocol.resultJson
 * (a result envelope ALWAYS answers a player-action verb, ok true or false).
 */

/** WebSocket simulado: estáticos de readyState, helpers onopen/onmessage/onclose. */
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

  triggerMessage(data: string) {
    this.onmessage?.({ data })
  }

  triggerClose(reason = '', code = 1006) {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({ reason, code })
  }
}

function currentWs(g: Gateway): FakeWebSocket {
  return g.ws as unknown as FakeWebSocket
}

async function connectOpen(g: Gateway): Promise<void> {
  const p = g.connect('ws://proxy.test:8787')
  currentWs(g).triggerOpen()
  await vi.advanceTimersByTimeAsync(100)
  await p
}

/** The exact frame the live capture saw (requestId 101 was the app's own seq). */
function playFrame(ws: FakeWebSocket): { requestId: string; action: string; args: { value: string; gameId: string } } {
  const sent = ws.sent.map((m) => JSON.parse(m) as { requestId: string; action: string; args: Record<string, unknown> })
  const frame = sent.find((m) => m.action === 'sendPlayerUUID')
  expect(frame, 'the play click must put exactly ONE sendPlayerUUID frame on the wire').toBeTruthy()
  return frame as { requestId: string; action: string; args: { value: string; gameId: string } }
}

/** The LAST sendPlayerUUID frame on the wire (a re-send after a timeout must
 * not be confused with the original — `playFrame` finds the first). */
function lastPlayFrame(ws: FakeWebSocket): { requestId: string; action: string; args: { value: string; gameId: string } } {
  const sent = ws.sent.map((m) => JSON.parse(m) as { requestId: string; action: string; args: Record<string, unknown> })
  const frame = sent.filter((m) => m.action === 'sendPlayerUUID').at(-1)
  expect(frame, 'the play click must put a sendPlayerUUID frame on the wire').toBeTruthy()
  return frame as { requestId: string; action: string; args: { value: string; gameId: string } }
}

/** Answer every heartbeat `ping` on the wire so a silent REQUEST does not
 * silently become a silent SOCKET: the heartbeat (15 s probe + 10 s deadline)
 * would drop the transport before the default 30 s request timeout fires. */
function answerPings(ws: FakeWebSocket): void {
  for (const m of ws.sent) {
    const frame = JSON.parse(m) as { requestId: string; action: string }
    if (frame.action === 'ping') ws.triggerMessage(JSON.stringify({ type: 'result', action: 'ping', requestId: frame.requestId, ok: true, data: 'pong' }))
  }
}

describe('hand-play reply path (RX side, real Gateway + fake transport)', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket)
  })

  afterEach(() => {
    setGateway(null)
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('the TX frame shape matches the live capture (sendPlayerUUID/value/gameId, one frame per click)', async () => {
    const g = new Gateway()
    setGateway(g)
    await connectOpen(g)
    const sent = g.send('sendPlayerUUID', { value: 'land-1', gameId: 'game-9' })
    const frame = playFrame(currentWs(g))
    expect(frame.requestId).toBe('0')
    expect(frame.args).toEqual({ value: 'land-1', gameId: 'game-9' })
    // server refuses: play is not legal (stale playables) — result(ok:false, reason)
    currentWs(g).triggerMessage(JSON.stringify({ type: 'result', action: 'sendPlayerUUID', requestId: frame.requestId, ok: false, errorCode: 'FAILED', error: 'Not possible to play that card right now' }))
    const res = await sent
    expect(res.ok).toBe(false)
    expect(res.error).toBe('Not possible to play that card right now')
    expect(currentWs(g).sent.filter((m) => m.includes('sendPlayerUUID'))).toHaveLength(1)
  })

  it('a refused play (ok:false) still resolves — the caller CAN surface a store error', async () => {
    const g = new Gateway()
    setGateway(g)
    await connectOpen(g)
    const pending = g.send('sendPlayerUUID', { value: 'land-1', gameId: 'game-9' })
    const frame = playFrame(currentWs(g))
    currentWs(g).triggerMessage(JSON.stringify({ type: 'result', action: 'sendPlayerUUID', requestId: frame.requestId, ok: false, errorCode: 'FAILED', error: 'It is not your turn' }))
    await expect(pending).resolves.toMatchObject({ ok: false, error: 'It is not your turn' })
  })

  it('an accepted play (ok:true) resolves and nothing else is needed for the ack', async () => {
    const g = new Gateway()
    setGateway(g)
    await connectOpen(g)
    const pending = g.send('sendPlayerUUID', { value: 'land-1', gameId: 'game-9' })
    const frame = playFrame(currentWs(g))
    currentWs(g).triggerMessage(JSON.stringify({ type: 'result', action: 'sendPlayerUUID', requestId: frame.requestId, ok: true, data: null }))
    await expect(pending).resolves.toMatchObject({ ok: true })
    // the state change itself rides an EVENT frame (GAME_UPDATE), not the result envelope
    currentWs(g).triggerMessage(JSON.stringify({ seq: 1, type: 'event', method: 'GAME_UPDATE', messageId: 1, objectId: 'game-9', data: {} }))
  })

  it('silence shape: NO reply resolves the send with ok:false timeout after the request timeout', async () => {
    // The timeout is injectable (constructor option) so the default is 30 s
    // wall-clock in production but a fake-timer step here.
    const g = new Gateway({ requestTimeoutMs: 5_000 })
    setGateway(g)
    await connectOpen(g)
    const pending = g.send('sendPlayerUUID', { value: 'land-1', gameId: 'game-9' })
    const frame = playFrame(currentWs(g))
    // the proxy never answers (dropped/eaten frame): no result arrives — the
    // OLD pinned behavior was "pending forever"; the timeout contract resolves a
    // typed TIMEOUT result so the caller's loading flag can clear.
    await vi.advanceTimersByTimeAsync(4_999)
    let settled: unknown = 'unset'
    const tracked = pending.then((r) => { settled = r; return r })
    await vi.advanceTimersByTimeAsync(1)
    await tracked
    expect(settled).not.toBe('unset')
    await expect(tracked).resolves.toMatchObject({ ok: false, error: 'timeout', errorCode: 'TIMEOUT', action: 'sendPlayerUUID', requestId: frame.requestId })
  })

  it('the default request timeout is 30 s (pinned contract, fake timers)', async () => {
    const g = new Gateway()
    setGateway(g)
    await connectOpen(g)
    const pending = g.send('sendPlayerUUID', { value: 'land-1', gameId: 'game-9' })
    playFrame(currentWs(g))
    // keep the transport alive in chunks: the heartbeat (probe at 15 s, drop at
    // ~25 s) would otherwise kill the silent SOCKET before the default 30 s
    // request timeout can fire on the silent REQUEST.
    for (let t = 0; t < 30_000; t += 5_000) {
      await vi.advanceTimersByTimeAsync(5_000)
      answerPings(currentWs(g))
    }
    let settled = false
    const tracked = pending.then((r) => { settled = true; return r })
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await tracked
    expect(settled).toBe(true)
    await expect(tracked).resolves.toMatchObject({ ok: false, error: 'timeout', errorCode: 'TIMEOUT' })
  })

  it('a late reply after the timeout resolution is a NO-OP, not a crash and not a second resolution', async () => {
    const g = new Gateway({ requestTimeoutMs: 5_000 })
    setGateway(g)
    await connectOpen(g)
    let resolutions = 0
    const pending = g.send('sendPlayerUUID', { value: 'land-1', gameId: 'game-9' }).then((r) => { resolutions++; return r })
    const frame = playFrame(currentWs(g))
    await vi.advanceTimersByTimeAsync(5_000)
    await pending
    expect(resolutions).toBe(1)
    // the answer finally arrives, minutes late: the pending map no longer holds
    // the id, so resolvePending finds nothing and must silently drop it
    currentWs(g).triggerMessage(JSON.stringify({ type: 'result', action: 'sendPlayerUUID', requestId: frame.requestId, ok: false, error: 'late reply' }))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(resolutions).toBe(1)
    // and the bookkeeping is clean: the same action can be sent again
    const again = g.send('sendPlayerUUID', { value: 'land-2', gameId: 'game-9' })
    const againFrame = lastPlayFrame(currentWs(g))
    expect(againFrame.requestId).not.toBe(frame.requestId)
    currentWs(g).triggerMessage(JSON.stringify({ type: 'result', action: 'sendPlayerUUID', requestId: againFrame.requestId, ok: true, data: null }))
    await expect(again).resolves.toMatchObject({ ok: true })
    expect(resolutions).toBe(1)
  })

  it('a connect-rejection close (4401) fails the pending play instead of hanging it', async () => {
    const g = new Gateway()
    setGateway(g)
    await connectOpen(g)
    const pending = g.send('sendPlayerUUID', { value: 'land-1', gameId: 'game-9' })
    currentWs(g).triggerClose('auth rejected', 4401)
    await expect(pending).resolves.toMatchObject({ ok: false, error: 'auth rejected' })
  })
})