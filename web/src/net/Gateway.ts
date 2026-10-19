import { DemoSocket } from '../demo/DemoSocket'
import type { EventEnvelope, LlmListErrorEnvelope, LobbyEnvelope, ProxyMessage, ResultEnvelope } from './types'
import { recordFrame } from './frameBuffer'

export interface GatewayEvents {
  onMessage?: (msg: ProxyMessage) => void
  onOpen?: () => void
  onClose?: (reason: string, code?: number) => void
  /** The page is going away (reload, close, navigation): last chance to save state. */
  onPageHide?: () => void
}

/** Idle time before the client probes the connection with a `ping`. */
export const HEARTBEAT_INTERVAL_MS = 15000
/** A probe without any inbound frame within this time means a dead socket. */
export const HEARTBEAT_TIMEOUT_MS = 10000

/**
 * Default per-request timeout for `send()`. The proxy
 * never answers a verb with a bare error frame carrying the requestId, and a
 * lost/silently-dropped reply used to hang the caller forever (the pickers'
 * loading flags only cleared on a typed frame or a result). Every pending
 * request now resolves `ok:false error:'timeout'` after this long. A
 * constructor option (`requestTimeoutMs`) overrides it so tests can use
 * fake timers instead of wall-clock 30 s.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

/**
 * The proxy's application close code for a deliberate connect rejection (auth
 * token absent/wrong, name already held, target refused). It never
 * auto-reconnects: the user fixes the input and reconnects
 * (`CLOSE_CODE_AUTH_REJECTED = 4401`).
 */
export const CLOSE_CODE_AUTH_REJECTED = 4401

interface PendingRequest<T = unknown> {
  id: string
  action: string
  resolve: (res: ResultEnvelope & { data?: T }) => void
  /** The per-request timeout armed in `send()`; cleared on any real resolution. */
  timer: ReturnType<typeof setTimeout> | null
}

/** Gateway constructor options: the events plus the injectable send timeout. */
export interface GatewayOptions extends GatewayEvents {
  /**
   * Per-request `send()` timeout in ms. Default `DEFAULT_REQUEST_TIMEOUT_MS`
   * (30 s); 0 or a negative value falls back to the default. Injectable so
   * tests can drive the timeout with fake timers instead of wall-clock waits.
   */
  requestTimeoutMs?: number
}

/**
 * Cliente WebSocket del proxy: reconexión con backoff, promesas por acción,
 * y notificación de mensajes al listener (store).
 */
export class Gateway {
  ws: WebSocket | null = null
  events: GatewayEvents = {}
  private url = ''
  private pending = new Map<string, PendingRequest>()
  private pendingByAction = new Map<string, string[]>()
  private seq = 0
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private userClosed = false
  private connectedAt = 0
  private lastInboundAt = 0
  private probeSentAt = 0
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private probeCheckTimer: ReturnType<typeof setTimeout> | null = null
  private readonly onWake = () => this.probe()
  private readonly onLeave = () => {
    this.events.onPageHide?.()
    this.announceLeaving()
  }
  /** The close code of the most recent `onclose` (4401 = proxy rejection). */
  lastCloseCode: number | undefined
  private streamId: string | null = null
  private lastSeq = 0
  /** Per-request send timeout, injectable for tests; default 30 s. */
  private requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS

  constructor(options: GatewayEvents | GatewayOptions = {}) {
    // Flat: events and the injectable timeout live side by side on one object,
    // so a bare `GatewayEvents` (every existing `new Gateway({...})` call) is
    // accepted unchanged.
    this.events = options as GatewayEvents
    const timeout = (options as GatewayOptions).requestTimeoutMs
    this.requestTimeoutMs = timeout && timeout > 0 ? timeout : DEFAULT_REQUEST_TIMEOUT_MS
  }

  get isOpen() {
    return this.ws?.readyState === WebSocket.OPEN
  }

  /** The proxy numbers every session frame (`seq`) of a stream; a re-login sends
   *  this back so the proxy replays exactly the frames missed while away. */
  resumeToken(): { streamId: string; seq: number } | null {
    return this.streamId ? { streamId: this.streamId, seq: this.lastSeq } : null
  }

  /** Continues a stream from before a page reload: the next login presents it,
   *  and replayed frames above `seq` pass the duplicate filter. */
  seedResume(token: { streamId: string; seq: number }) {
    this.streamId = token.streamId
    this.lastSeq = token.seq
  }

  get elapsedSecs() {
    return this.isOpen ? Math.round((Date.now() - this.connectedAt) / 1000) : 0
  }

  connect(url: string): Promise<void> {
    this.url = url
    this.userClosed = false
    this.reconnectAttempts = 0
    this.open()
    return this.waitOpen(5000)
  }

  private open() {
    this.cleanup()
    const ws = __DEMO__ ? (new DemoSocket() as unknown as WebSocket) : new WebSocket(this.url)
    this.ws = ws
    ws.onopen = () => {
      this.reconnectAttempts = 0
      this.connectedAt = Date.now()
      this.lastInboundAt = this.connectedAt
      this.startHeartbeat()
      this.events.onOpen?.()
    }
    ws.onmessage = (ev) => {
      this.lastInboundAt = Date.now()
      this.handleMessage(ev.data)
    }
    ws.onerror = () => ws.close()
    ws.onclose = (ev) => {
      if (this.ws !== ws) return
      this.connectionLost(ev.reason || `close(${ev.code})`, ev.code)
    }
  }

  private connectionLost(reason: string, code?: number) {
    this.stopHeartbeat()
    this.lastCloseCode = code
    this.events.onClose?.(reason, code)
    this.rejectAll(reason)
    // 4401 = the proxy rejected the connect (auth token / name / target): the
    // user must fix it, retrying the same socket would be rejected again. This
    // is the client half of the proxy's CLOSE_CODE_AUTH_REJECTED contract.
    if (code === CLOSE_CODE_AUTH_REJECTED) {
      this.userClosed = true
      return
    }
    if (!this.userClosed && this.url) this.scheduleReconnect()
  }

  /**
   * Half-open sockets (a tunnel or NAT that stalls without closing, a laptop
   * waking up) stay OPEN in the browser for minutes while every action goes
   * nowhere: the game looks frozen until a reload. An idle connection is
   * probed with a `ping`; no inbound frame in time drops the socket and the
   * normal reconnect + rejoin path takes over.
   */
  private startHeartbeat() {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => this.heartbeatTick(), HEARTBEAT_INTERVAL_MS / 3)
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onWake)
      window.addEventListener('focus', this.onWake)
      window.addEventListener('pagehide', this.onLeave)
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onWake)
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    if (this.probeCheckTimer) clearTimeout(this.probeCheckTimer)
    this.heartbeatTimer = null
    this.probeCheckTimer = null
    this.probeSentAt = 0
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onWake)
      window.removeEventListener('focus', this.onWake)
      window.removeEventListener('pagehide', this.onLeave)
    }
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onWake)
  }

  private heartbeatTick() {
    if (!this.isOpen) return
    const now = Date.now()
    if (this.probeSentAt && this.lastInboundAt < this.probeSentAt) {
      if (now - this.probeSentAt >= HEARTBEAT_TIMEOUT_MS) this.dropDeadSocket()
      return
    }
    if (now - this.lastInboundAt >= HEARTBEAT_INTERVAL_MS) this.probe()
  }

  private probe() {
    if (!this.isOpen) return
    if (this.probeSentAt && this.lastInboundAt < this.probeSentAt) return
    this.probeSentAt = Date.now()
    try {
      this.ws?.send(JSON.stringify({ requestId: `hb-${this.probeSentAt}`, action: 'ping', args: {} }))
    } catch {
      this.dropDeadSocket()
      return
    }
    if (this.probeCheckTimer) clearTimeout(this.probeCheckTimer)
    this.probeCheckTimer = setTimeout(() => this.heartbeatTick(), HEARTBEAT_TIMEOUT_MS)
  }

  /**
   * The page is being closed, reloaded or navigated away: the proxy then keeps
   * the session only for a short grace period instead of the one for a dropped
   * connection, so the opponent of a player who closed the tab does not wait
   * minutes (a reload is back within seconds).
   */
  private announceLeaving() {
    if (!this.isOpen) return
    try {
      this.ws?.send(JSON.stringify({ action: 'leaving', args: {} }))
    } catch {
      // closing anyway
    }
  }

  private dropDeadSocket() {
    const ws = this.ws
    if (!ws) return
    this.ws = null
    ws.onmessage = null
    try {
      ws.close()
    } catch {
      // already closing
    }
    this.connectionLost('heartbeat timeout')
  }

  private cleanup() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.stopHeartbeat()
  }

  private scheduleReconnect() {
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 10000)
    this.reconnectAttempts++
    this.reconnectTimer = setTimeout(() => this.open(), delay)
  }

  private waitOpen(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const started = Date.now()
      const tick = () => {
        if (this.isOpen) return resolve()
        if (Date.now() - started > timeoutMs) return reject(new Error('timeout connecting to proxy'))
        setTimeout(tick, 50)
      }
      tick()
    })
  }

  private handleMessage(data: unknown) {
    const raw = String(data)
    let msg: ProxyMessage
    try {
      msg = JSON.parse(raw) as ProxyMessage
    } catch {
      console.warn('[gateway] mensaje no JSON', data)
      return
    }
    if (msg.type === 'result') {
      this.adoptStream(msg)
      this.resolvePending(msg)
    } else if (msg.type === 'models_error' || msg.type === 'personalities_error') {
      // A typed list-verb failure carries the requestId, so the pending
      // fetchLlmModels/fetchLlmPersonalities promise resolves here instead of
      // hanging (the proxy never answers these verbs with the generic `error`).
      this.resolvePending(typedErrorToResult(msg))
    }
    const seq = (msg as { seq?: unknown }).seq
    if (typeof seq === 'number') {
      // already processed before the socket dropped: the resume replays from
      // the last seq sent, but a frame may have been in flight both ways
      if (seq <= this.lastSeq) return
      this.lastSeq = seq
    }
    recordFrame(msg, raw.length)
    this.events.onMessage?.(msg)
  }

  /** A login onto another proxy stream (a new proxy session) restarts its numbering. */
  private adoptStream(msg: ResultEnvelope) {
    if (msg.action !== 'connect' || !msg.ok) return
    const streamId = (msg.data as { streamId?: unknown } | undefined)?.streamId
    if (typeof streamId !== 'string') return
    if (streamId !== this.streamId) {
      this.streamId = streamId
      this.lastSeq = 0
    }
  }

  private resolvePending(msg: ResultEnvelope) {
    let requestId = msg.requestId === undefined || msg.requestId === null ? undefined : String(msg.requestId)
    if (requestId === undefined) {
      const ids = this.pendingByAction.get(msg.action)
      requestId = ids?.shift()
      if (ids && !ids.length) this.pendingByAction.delete(msg.action)
    } else {
      const ids = this.pendingByAction.get(msg.action)
      if (ids) {
        const index = ids.indexOf(requestId)
        if (index >= 0) ids.splice(index, 1)
        if (!ids.length) this.pendingByAction.delete(msg.action)
      }
    }
    if (!requestId) return
    const req = this.pending.get(requestId)
    if (!req) return
    this.pending.delete(requestId)
    // The real reply wins — the armed timeout timer must not fire later.
    if (req.timer) clearTimeout(req.timer)
    req.resolve(msg)
  }

  private rejectAll(reason: string) {
    for (const [, req] of this.pending) {
      // No request outlives the socket — clear its timeout timer too, or
      // the timer map leaks a firing entry per dropped request.
      if (req.timer) clearTimeout(req.timer)
      req.resolve({ type: 'result', action: req.action, requestId: req.id, ok: false, error: reason, data: undefined })
    }
    this.pending.clear()
    this.pendingByAction.clear()
  }

  /** Send an action and resolve with the proxy's result (matched by requestId). */
  send<T = unknown>(action: string, args: Record<string, unknown> = {}): Promise<ResultEnvelope & { data?: T }> {
    if (!this.isOpen) return Promise.resolve({ type: 'result', action, ok: false, error: 'not connected', errorCode: 'NOT_CONNECTED', data: undefined })
    const id = String(this.seq++)
    return new Promise<ResultEnvelope & { data?: T }>((resolve) => {
      // Every pending request arms a timeout — a reply the proxy never
      // sends (dropped/eaten frame) used to hang the caller forever. The
      // timeout resolves exactly like a rejected result, so every caller's
      // ok:false path already handles it; resolvePending/rejectAll clear the
      // timer when the real answer (or a close) arrives first.
      const timer = setTimeout(() => {
        this.pending.delete(id)
        const ids = this.pendingByAction.get(action)
        if (ids) {
          const index = ids.indexOf(id)
          if (index >= 0) ids.splice(index, 1)
          if (!ids.length) this.pendingByAction.delete(action)
        }
        resolve({ type: 'result', action, requestId: id, ok: false, error: 'timeout', errorCode: 'TIMEOUT', data: undefined })
      }, this.requestTimeoutMs)
      this.pending.set(id, { id, action, resolve: resolve as PendingRequest['resolve'], timer })
      const ids = this.pendingByAction.get(action) ?? []
      ids.push(id)
      this.pendingByAction.set(action, ids)
      this.ws?.send(JSON.stringify({ requestId: id, action, args }))
    })
  }

  close() {
    this.userClosed = true
    this.cleanup()
    this.ws?.close()
    this.ws = null
    this.rejectAll('disconnected')
  }
}

/** Tipos de evento que el store debe interpretar. */
export function isEvent(msg: ProxyMessage): msg is EventEnvelope {
  return msg.type === 'event'
}

export function isLobby(msg: ProxyMessage): msg is LobbyEnvelope {
  return msg.type === 'lobby'
}

/**
 * A typed LLM list-verb failure frame mapped to the `result` envelope a pending
 * `send()` promise resolves on. `ok:false` + the proxy's message + errorCode, so
 * the picker clears its loading flag on it exactly like on a rejected `result`.
 */
export function typedErrorToResult(msg: LlmListErrorEnvelope): ResultEnvelope {
  return {
    type: 'result',
    action: msg.action ?? '',
    ...(msg.requestId === undefined ? null : { requestId: msg.requestId }),
    ok: false,
    error: msg.message,
    ...(msg.errorCode === undefined ? null : { errorCode: msg.errorCode }),
  }
}
