import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import LoginScreen from './LoginScreen'
import { DEFAULT_PROXY_CONFIG, resetProxyConfigCache, type ProxyConfig } from '../net/proxyConfig'
import { getAuthToken, clearAuthToken, setAuthToken } from '../net/authToken'
import { initialState, getState, setState } from '../state/state'
import { doConnect, probeProxyConfig, reset } from '../state/store'
import { t } from '../i18n'

vi.mock('../state/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../state/store')>()
  return { ...actual, doConnect: vi.fn(async () => {}) }
})

const withConfig = (partial: Partial<ProxyConfig>) =>
  setState({ proxyConfig: { ...DEFAULT_PROXY_CONFIG, ...partial } })

describe('LoginScreen — deployment gating', () => {
  beforeEach(() => {
    setState(initialState)
    clearAuthToken()
    vi.mocked(doConnect).mockClear()
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no network in test'))))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    resetProxyConfigCache()
    clearAuthToken()
    window.history.replaceState({}, '', '/')
  })

  it('hides the auth-token field and the pinned target by default (stock proxy)', () => {
    render(<LoginScreen />)
    expect(screen.queryByTestId('login-auth-token')).toBeNull()
    expect(screen.queryByTestId('login-pinned-target')).toBeNull()
    expect(screen.getByTestId('login-password')).toBeTruthy()
    expect(document.querySelector('.login-network-box')).toBeTruthy()
  })

  it('renders a password-typed auth-token field only when authRequired', () => {
    withConfig({ authRequired: true })
    render(<LoginScreen />)
    const field = screen.getByTestId('login-auth-token') as HTMLInputElement
    expect(field.type).toBe('password')
    expect(field.getAttribute('autocomplete')).toBe('off')
  })

  it('sends the auth token as doConnect args and persists it per-tab in sessionStorage', () => {
    withConfig({ authRequired: true })
    render(<LoginScreen />)
    fireEvent.change(document.querySelector('input[autocomplete="username"]')!, { target: { value: 'player1' } })
    fireEvent.change(screen.getByTestId('login-auth-token'), { target: { value: 'sekret' } })
    fireEvent.submit(document.querySelector('form')!)
    expect(doConnect).toHaveBeenCalledTimes(1)
    const args = vi.mocked(doConnect).mock.calls[0]
    expect(args[8]).toBe('sekret')
    expect(getAuthToken()).toBe('sekret')
    // persisted per tab only: the token survives a reload in sessionStorage…
    const scan = (s: Storage | undefined): string[] => {
      const out: string[] = []
      if (!s) return out
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i)
        if (k) out.push(s.getItem(k) ?? '')
      }
      return out
    }
    expect(scan(window.sessionStorage).some((v) => v.includes('sekret'))).toBe(true)
    // …but never localStorage, a cookie or the URL
    expect(scan(window.localStorage).some((v) => v.includes('sekret'))).toBe(false)
    expect(document.cookie).not.toContain('sekret')
    expect(window.location.href).not.toContain('sekret')
  })

  it('omits the token argument (undefined) when the deployment does not require it', () => {
    render(<LoginScreen />)
    fireEvent.submit(document.querySelector('form')!)
    expect(vi.mocked(doConnect).mock.calls[0][8]).toBeUndefined()
  })

  it('hides Server/Port and shows the pinned target read-only when hideServerTarget', () => {
    withConfig({ hideServerTarget: true, pinnedTarget: 'mage.example.com:17171' })
    render(<LoginScreen />)
    const pinned = screen.getByTestId('login-pinned-target')
    expect(pinned.textContent).toContain('mage.example.com:17171')
    expect(document.querySelector('.login-network-box')).toBeNull()
    expect(document.querySelector('.login-presets-container')).toBeNull()
    expect(document.querySelector('input[autocomplete="username"]')).toBeTruthy()
  })

  it('surfaces the proxy rejection reason as a banner', () => {
    // `proxyReject` already carries the LOCALIZED reason (the 4401 handler maps the
    // canonical proxy payloads); the banner wraps it in errors.proxy_rejected.
    setState({ proxyReject: 'Token de acceso: Requerido por este proxy' })
    render(<LoginScreen />)
    expect(screen.getByTestId('login-proxy-reject').textContent).toContain('Token de acceso: Requerido por este proxy')
    expect(screen.getByTestId('login-proxy-reject').textContent).not.toContain('{reason}')
    expect(getState().proxyReject).toBe('Token de acceso: Requerido por este proxy')
  })

  it('writes the typed auth token to sessionStorage on change', () => {
    withConfig({ authRequired: true })
    render(<LoginScreen />)
    fireEvent.change(screen.getByTestId('login-auth-token'), { target: { value: 'typed-live' } })
    // available to any component (e.g. the setup wizard's Enter) as soon as typed
    expect(getAuthToken()).toBe('typed-live')
    // ...and mirrored into this tab's sessionStorage so a reload re-attaches
    const scan = (s: Storage | undefined): string[] => {
      const out: string[] = []
      if (!s) return out
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i)
        if (k) out.push(s.getItem(k) ?? '')
      }
      return out
    }
    expect(scan(window.sessionStorage).some((v) => v.includes('typed-live'))).toBe(true)
    expect(scan(window.localStorage).some((v) => v.includes('typed-live'))).toBe(false)
  })

  it('pre-fills the token field from the stored value when the form remounts (reload)', () => {
    withConfig({ authRequired: true })
    setAuthToken('restored-from-tab')
    render(<LoginScreen />)
    expect((screen.getByTestId('login-auth-token') as HTMLInputElement).value).toBe('restored-from-tab')
  })
})

describe('LoginScreen — locked deployment (VITE_LOCK_DEPLOYMENT)', () => {
  beforeEach(() => {
    setState(initialState)
    clearAuthToken()
    vi.mocked(doConnect).mockClear()
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no network in test'))))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    resetProxyConfigCache()
    clearAuthToken()
    window.history.replaceState({}, '', '/')
  })

  it('does not render the server-target preset selector', () => {
    vi.stubEnv('VITE_LOCK_DEPLOYMENT', '1')
    render(<LoginScreen />)
    expect(document.querySelector('.login-presets-container')).toBeNull()
    expect(document.querySelector('.login-presets-row')).toBeNull()
    // the identity form is still there
    expect(document.querySelector('input[autocomplete="username"]')).toBeTruthy()
  })

  it('still renders the preset selector when unlocked (default)', () => {
    render(<LoginScreen />)
    expect(document.querySelector('.login-presets-container')).toBeTruthy()
  })

  it('ignores a ?server= override and connects to the baked target', () => {
    vi.stubEnv('VITE_LOCK_DEPLOYMENT', '1')
    window.history.replaceState({}, '', '/?server=beta.xmage.today')
    render(<LoginScreen />)
    fireEvent.change(document.querySelector('input[autocomplete="username"]')!, { target: { value: 'player1' } })
    fireEvent.submit(document.querySelector('form')!)
    const args = vi.mocked(doConnect).mock.calls[0]
    // baked target (localhost by default), NOT the ?server= override
    expect(args[2]).toBe('localhost')
    expect(args[2]).not.toBe('beta.xmage.today')
  })

  it('honors the ?server= override when unlocked', () => {
    window.history.replaceState({}, '', '/?server=beta.xmage.today')
    render(<LoginScreen />)
    fireEvent.change(document.querySelector('input[autocomplete="username"]')!, { target: { value: 'player1' } })
    fireEvent.submit(document.querySelector('form')!)
    const args = vi.mocked(doConnect).mock.calls[0]
    expect(args[2]).toBe('beta.xmage.today')
  })

  it('never renders editable Proxy/Server/Port fields when the build is locked', () => {
    vi.stubEnv('VITE_LOCK_DEPLOYMENT', '1')
    render(<LoginScreen />)
    // the deployment lock removes the editable target fields even when the proxy
    // did not set hideServerTarget (a locked build must never expose Server/Port).
    expect(document.querySelector('details.login-network-box')).toBeNull()
    expect(document.querySelector('.login-network-fields')).toBeNull()
    expect(screen.getByTestId('login-pinned-target')).toBeTruthy()
  })
})

describe('LoginScreen — post-Disconnect reconnect form', () => {
  const probed = { authRequired: true, hideServerTarget: true, pinnedTarget: '127.0.0.1:17181', deploymentName: 'LLMage', llmRelay: false }

  beforeEach(async () => {
    setState(initialState)
    clearAuthToken()
    resetProxyConfigCache()
    vi.mocked(doConnect).mockClear()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(probed) })))
    await probeProxyConfig('localhost', 8787)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    resetProxyConfigCache()
    clearAuthToken()
    window.history.replaceState({}, '', '/')
  })

  it('after a Disconnect (reset) the login form still shows the auth field and hides Server/Port', () => {
    reset()
    render(<LoginScreen />)
    expect(screen.getByTestId('login-auth-token')).toBeTruthy()
    expect(screen.getByTestId('login-pinned-target')).toBeTruthy()
    expect(document.querySelector('details.login-network-box')).toBeNull()
  })
})

describe('LoginScreen — failed connect keeps username + token', () => {
  beforeEach(() => {
    setState(initialState)
    clearAuthToken()
    resetProxyConfigCache()
    vi.mocked(doConnect).mockClear()
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no network in test'))))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    resetProxyConfigCache()
    clearAuthToken()
    window.history.replaceState({}, '', '/')
  })

  it('restores the typed username + remembered token when the login screen remounts after a plain failure', () => {
    setAuthToken('typed-token')
    setState({
      proxyConfig: { ...DEFAULT_PROXY_CONFIG, authRequired: true },
      conn: { wsHost: 'localhost', proxyPort: 8787, serverHost: 'localhost', port: 17171, username: 'ana', password: '' },
    })

    render(<LoginScreen />)
    // a plain failed attempt flips phase connecting→idle, unmounting the form at
    // the splash and remounting it fresh: the identity + token must come back.
    expect((document.querySelector('input[autocomplete="username"]') as HTMLInputElement).value).toBe('ana')
    expect((screen.getByTestId('login-auth-token') as HTMLInputElement).value).toBe('typed-token')
  })

  it('does not resurrect the token after an explicit logout (reset clears it)', () => {
    setAuthToken('sekret')
    reset()
    setState({ proxyConfig: { ...DEFAULT_PROXY_CONFIG, authRequired: true } })
    render(<LoginScreen />)
    expect((screen.getByTestId('login-auth-token') as HTMLInputElement).value).toBe('')
  })
})

describe('LoginScreen — unmapped rejection at login', () => {
  beforeEach(() => {
    setState(initialState)
    clearAuthToken()
    resetProxyConfigCache()
    vi.mocked(doConnect).mockClear()
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no network in test'))))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    resetProxyConfigCache()
    clearAuthToken()
    window.history.replaceState({}, '', '/')
  })

  it('an unmapped "FAILED" rejection is not drawn as "Could not create table"', () => {
    // the gateway keeps the proxy's raw reason (gateway.ts: error: res.error ?? 'login fallido');
    // a version rejection can arrive as {"error":"FAILED","errorCode":"FAILED"}
    setState({ error: 'FAILED' })
    render(<LoginScreen />)
    const msg = document.querySelector('.error-box .error-msg')!
    expect(msg.textContent).toBe(t('errors.login_failed'))
    expect(msg.textContent).not.toContain(t('errors.create_table_failed'))
  })

  it('el texto dedicado de version mismatch sigue saliendo byte-idéntico', () => {
    const mismatch = t('errors', 'server_version_mismatch', { server: '1.4.63-V1', proxy: '1.4.62-V1' })
    setState({ error: mismatch })
    render(<LoginScreen />)
    expect(document.querySelector('.error-box .error-msg')!.textContent).toBe(mismatch)
  })
})
