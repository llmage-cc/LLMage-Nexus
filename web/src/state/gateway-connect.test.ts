import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ALREADY_CONNECTED_RETRIES, doConnect, getGateway, probeProxyConfig, reset } from './gateway'
import { loadResumeToken, saveResumeToken, type ConnectionInfo } from './persistence'
import { getState, setState } from './state'
import * as cmds from '../net/commands'
import { gameEventOrder, noteGameEvent } from './gameUtils'
import { t } from '../i18n'
import { DEFAULT_PROXY_CONFIG, resetProxyConfigCache } from '../net/proxyConfig'
import { clearAuthToken, getAuthToken, setAuthToken } from '../net/authToken'

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

describe('doConnect — intentos concurrentes', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', FakeWebSocket)
    reset()
    vi.mocked(cmds.connect).mockReset().mockResolvedValue({ ok: true } as never)
    vi.mocked(cmds.disconnect).mockReset().mockResolvedValue({ ok: true } as never)
    vi.mocked(cmds.getRoomChatId).mockReset().mockResolvedValue('room-1')
    vi.mocked(cmds.updatePreferences).mockReset().mockResolvedValue({ ok: true } as never)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    clearAuthToken()
  })

  it('dedupe el doble montaje de StrictMode: un solo WS y un solo login, sin error tardío', async () => {
    const first = doConnect('localhost', 8787, 'localhost', 17171, 'u', 'p')
    const second = doConnect('localhost', 8787, 'localhost', 17171, 'u', 'p')
    expect(second).toBe(first)
    expect(FakeWebSocket.instances).toHaveLength(1)

    FakeWebSocket.instances[0].triggerOpen()
    await vi.advanceTimersByTimeAsync(100)
    await first
    expect(getState().phase).toBe('lobby')
    expect(getState().error).toBeNull()
    expect(cmds.connect).toHaveBeenCalledTimes(1)

    // el timeout del intento descartado ya no puede volver al login
    await vi.advanceTimersByTimeAsync(6000)
    expect(getState().phase).toBe('lobby')
    expect(getState().error).toBeNull()
  })

  it('usa la URL completa cuando el host del proxy trae esquema', async () => {
    const p = doConnect('wss://nexus.example.com', 443, 'beta.xmage.today', 17171, 'u', 'p')
    expect(FakeWebSocket.instances[0].url).toBe('wss://nexus.example.com')
    FakeWebSocket.instances[0].triggerOpen()
    await vi.advanceTimersByTimeAsync(100)
    await p
    expect(getState().phase).toBe('lobby')
  })

  it('un intento anterior que expira no pisa el estado del intento vigente', async () => {
    const slow = doConnect('slow-host', 8787, 'localhost', 17171, 'u', 'p')
    const fast = doConnect('fast-host', 8788, 'localhost', 17171, 'u', 'p')
    expect(FakeWebSocket.instances).toHaveLength(2)

    FakeWebSocket.instances[1].triggerOpen()
    await vi.advanceTimersByTimeAsync(100)
    await fast
    expect(getState().phase).toBe('lobby')

    await vi.advanceTimersByTimeAsync(6000)
    await slow
    expect(getState().phase).toBe('lobby')
    expect(getState().error).toBeNull()
  })

  it('tras un fallo se puede reintentar (in-flight se limpia)', async () => {
    const failed = doConnect('localhost', 8787, 'localhost', 17171, 'u', 'p')
    await vi.advanceTimersByTimeAsync(6000)
    await failed
    expect(getState().phase).toBe('idle')
    expect(getState().error).toMatch(/no se pudo conectar al proxy/)

    const retry = doConnect('localhost', 8787, 'localhost', 17171, 'u', 'p')
    expect(FakeWebSocket.instances).toHaveLength(2)
    FakeWebSocket.instances[1].triggerOpen()
    await vi.advanceTimersByTimeAsync(100)
    await retry
    expect(getState().phase).toBe('lobby')
    expect(getState().error).toBeNull()
  })

  it('stops retrying "already connected" after a few attempts and explains the session is in use', async () => {
    const already = 'User u already connected or your IP address changed - try another user'
    vi.mocked(cmds.connect).mockResolvedValue({ ok: false, error: already } as never)
    const done = doConnect('localhost', 8787, 'localhost', 17171, 'u', 'p')
    for (let i = 0; i < 40; i++) {
      for (const w of FakeWebSocket.instances) if (w.readyState === FakeWebSocket.CONNECTING) w.triggerOpen()
      await vi.advanceTimersByTimeAsync(1000)
    }
    await done
    expect(cmds.connect).toHaveBeenCalledTimes(ALREADY_CONNECTED_RETRIES + 1)
    expect(getState().phase).toBe('idle')
    expect(getState().loginRetry).toBeNull()
    expect(getState().error).toBe(t('errors', 'session_in_use'))
  })

  it('explains a server on another release once, without retrying', async () => {
    const detail = 'mage.remote.MageVersionException: Wrong client version.<br/>Your version: 1.4.62-V1<br/>Server version: 1.4.63-V1'
    vi.mocked(cmds.connect).mockResolvedValue({ ok: false, error: detail, errorCode: 'VERSION_MISMATCH' } as never)
    const done = doConnect('localhost', 8787, 'localhost', 17171, 'u', 'p')
    FakeWebSocket.instances[0].triggerOpen()
    await vi.advanceTimersByTimeAsync(100)
    await done
    expect(cmds.connect).toHaveBeenCalledTimes(1)
    expect(getState().phase).toBe('idle')
    expect(getState().error).toBe(t('errors', 'server_version_mismatch', { server: '1.4.63-V1', proxy: '1.4.62-V1' }))
  })

  it('announces the wait before retrying a login the server refused as already connected', async () => {
    vi.mocked(cmds.connect)
      .mockResolvedValueOnce({ ok: false, error: 'User u already connected or your IP address changed' } as never)
      .mockResolvedValue({ ok: true } as never)
    const done = doConnect('localhost', 8787, 'localhost', 17171, 'u', 'p')
    FakeWebSocket.instances[0].triggerOpen()
    await vi.advanceTimersByTimeAsync(100)
    expect(getState().loginRetry).toMatchObject({ attempt: 1, max: ALREADY_CONNECTED_RETRIES })
    expect(getState().loginRetry!.until).toBeGreaterThan(Date.now())
    for (let i = 0; i < 20 && getState().phase !== 'lobby'; i++) {
      for (const w of FakeWebSocket.instances) if (w.readyState === FakeWebSocket.CONNECTING) w.triggerOpen()
      await vi.advanceTimersByTimeAsync(1000)
    }
    await done
    expect(getState().phase).toBe('lobby')
    expect(getState().loginRetry).toBeNull()
  })

  it('a login that opened a new XMage session resets the game event order', async () => {
    vi.mocked(cmds.connect).mockResolvedValue({ ok: true, data: { attached: false } } as never)
    noteGameEvent('g-1', 800)
    const done = doConnect('localhost', 8787, 'localhost', 17171, 'u', 'p')
    FakeWebSocket.instances[0].triggerOpen()
    await vi.advanceTimersByTimeAsync(100)
    await done
    expect(gameEventOrder('g-1', 5)).toBe('unknown')
  })

  it('re-attaching to the live proxy session keeps the game event order', async () => {
    vi.mocked(cmds.connect).mockResolvedValue({ ok: true, data: { attached: true } } as never)
    noteGameEvent('g-1', 800)
    const done = doConnect('localhost', 8787, 'localhost', 17171, 'u', 'p')
    FakeWebSocket.instances[0].triggerOpen()
    await vi.advanceTimersByTimeAsync(100)
    await done
    expect(gameEventOrder('g-1', 5)).toBe('older')
  })

  it('an automatic WS reconnect that lands on a new XMage session resets the game event order', async () => {
    vi.mocked(cmds.connect).mockResolvedValue({ ok: true, data: { attached: true } } as never)
    const done = doConnect('localhost', 8787, 'localhost', 17171, 'u', 'p')
    FakeWebSocket.instances[0].triggerOpen()
    await vi.advanceTimersByTimeAsync(100)
    await done
    noteGameEvent('g-1', 800)

    vi.mocked(cmds.connect).mockResolvedValue({ ok: true, data: { attached: false } } as never)
    FakeWebSocket.instances[0].onclose?.({ code: 1006 })
    await vi.advanceTimersByTimeAsync(1100)
    expect(FakeWebSocket.instances).toHaveLength(2)
    FakeWebSocket.instances[1].triggerOpen()
    await vi.advanceTimersByTimeAsync(100)
    expect(cmds.connect).toHaveBeenCalledTimes(2)
    expect(gameEventOrder('g-1', 5)).toBe('unknown')
  })

  describe('resume token across a page reload', () => {
    const conn: ConnectionInfo = { wsHost: 'localhost', proxyPort: 8787, serverHost: 'localhost', port: 17171, username: 'u', password: 'p' }

    beforeEach(() => window.sessionStorage.clear())

    const login = async (username = 'u') => {
      const done = doConnect('localhost', 8787, 'localhost', 17171, username, 'p')
      FakeWebSocket.instances[FakeWebSocket.instances.length - 1].triggerOpen()
      await vi.advanceTimersByTimeAsync(100)
      await done
    }

    it('the page going away saves the stream position', async () => {
      await login()
      getGateway()!.seedResume({ streamId: 's1', seq: 42 })
      window.dispatchEvent(new Event('pagehide'))
      expect(loadResumeToken(conn)).toEqual({ streamId: 's1', seq: 42 })
    })

    it('the login after a reload presents the saved token once', async () => {
      saveResumeToken({ streamId: 's1', seq: 42 }, conn)
      vi.mocked(cmds.connect).mockResolvedValue({ ok: true, data: { attached: true, resumed: true, streamId: 's1' } } as never)
      await login()
      expect(vi.mocked(cmds.connect).mock.calls[0][6]).toEqual({ streamId: 's1', seq: 42 })
      expect(getGateway()!.resumeToken()).toEqual({ streamId: 's1', seq: 42 })
      expect(loadResumeToken(conn)).toBeNull()
    })

    it('another account does not present the saved token', async () => {
      saveResumeToken({ streamId: 's1', seq: 42 }, conn)
      await login('someone-else')
      expect(vi.mocked(cmds.connect).mock.calls[0][6]).toBeNull()
    })

    it('logging out forgets the token', () => {
      saveResumeToken({ streamId: 's1', seq: 42 }, conn)
      reset()
      expect(loadResumeToken(conn)).toBeNull()
    })
  })

  describe('4401 auth rejection', () => {
    it('surfaces the typed reason, goes idle and does NOT auto-reconnect', async () => {
      const done = doConnect('localhost', 8787, 'localhost', 17171, 'u', 'p')
      FakeWebSocket.instances[0].triggerOpen()
      await vi.advanceTimersByTimeAsync(100)
      await done
      expect(getState().phase).toBe('lobby')

      FakeWebSocket.instances[0].onclose?.({ code: 4401, reason: 'Bad or missing auth token' })
      await vi.advanceTimersByTimeAsync(30000)

      expect(getState().phase).toBe('idle')
      // The raw proxy payload is mapped to localized segments (ES/DE banner leak):
      // the auth rejection renders through the existing
      // login.auth_token keys instead of the English server string.
      expect(getState().proxyReject).toBe('Token de acceso: Requerido por este proxy')
      expect(getState().error).toBeNull()
      expect(getState().link).toBe('ok')
      // no reconnect socket was opened, and no re-login was attempted
      expect(FakeWebSocket.instances).toHaveLength(1)
      expect(cmds.connect).toHaveBeenCalledTimes(1)
    })

    it('leaves other close codes on the existing reconnect path', async () => {
      const done = doConnect('localhost', 8787, 'localhost', 17171, 'u', 'p')
      FakeWebSocket.instances[0].triggerOpen()
      await vi.advanceTimersByTimeAsync(100)
      await done

      FakeWebSocket.instances[0].onclose?.({ code: 1006 } as CloseEvent)
      await vi.advanceTimersByTimeAsync(1100)
      expect(FakeWebSocket.instances).toHaveLength(2)
      expect(getState().proxyReject).toBeNull()
    })

    it('a 4401 rejection forgets the remembered auth token (only a logout or a rejection clears it)', async () => {
      setAuthToken('sekret')
      const done = doConnect('localhost', 8787, 'localhost', 17171, 'u', 'p', undefined, undefined, 'sekret')
      FakeWebSocket.instances[0].triggerOpen()
      await vi.advanceTimersByTimeAsync(100)
      await done
      expect(getAuthToken()).toBe('sekret')

      FakeWebSocket.instances[0].onclose?.({ code: 4401, reason: 'Auth token required' })
      expect(getAuthToken()).toBe('')
    })

    it('maps every known canonical rejection to localized segments and leaves unknown reasons verbatim (i18n leak)', async () => {
      const done = doConnect('localhost', 8787, 'localhost', 17171, 'u', 'p')
      FakeWebSocket.instances[0].triggerOpen()
      await vi.advanceTimersByTimeAsync(100)
      await done

      // The proxy's auth-gate close reason (DeploymentConfig.AUTH_REJECTED_CLOSE_REASON):
      FakeWebSocket.instances[0].onclose?.({ code: 4401, reason: 'Auth token required' })
      expect(getState().proxyReject).toBe('Token de acceso: Requerido por este proxy')

      // Its typed connect_error message variant (shown by the fake-mode path):
      FakeWebSocket.instances[0].onclose?.({ code: 4401, reason: 'Bad or missing auth token' })
      expect(getState().proxyReject).toBe('Token de acceso: Requerido por este proxy')

      // The anon-name gate: the account/name is held on the server by another browser.
      FakeWebSocket.instances[0].onclose?.({ code: 4401, reason: 'Name in use by another browser' })
      expect(getState().proxyReject).toContain('sigue conectada en el servidor')
      expect(getState().proxyReject).not.toMatch(/Name in use|already in use on that server/)

      // Unknown server detail (could be any stock-server text): passes through verbatim.
      FakeWebSocket.instances[0].onclose?.({ code: 4401, reason: 'Target refused the login' })
      expect(getState().proxyReject).toBe('Target refused the login')
    })
  })

  describe('reset() across the Disconnect path', () => {
    afterEach(() => {
      resetProxyConfigCache()
      setState({ proxyConfig: DEFAULT_PROXY_CONFIG })
    })

    it('keeps the probed deployment config so the locked login form survives a Disconnect', async () => {
      const probed = { authRequired: true, hideServerTarget: true, pinnedTarget: '127.0.0.1:17181', deploymentName: 'LLMage', llmRelay: false }
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(probed) })))
      await probeProxyConfig('localhost', 8787)
      expect(getState().proxyConfig).toEqual(probed)

      reset()

      // the store reset must not drop the deployment flags: the login form
      // still needs authRequired + hideServerTarget after a Disconnect.
      expect(getState().proxyConfig).toEqual(probed)
      expect(getState().proxyConfig).not.toBe(DEFAULT_PROXY_CONFIG)
    })
  })
})
