import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import SetupWizard from './SetupWizard'
import { isSetupDone } from './setupFlag'
import { loadConn } from '../state/persistence'
import { doConnect } from '../state/store'
import { initialState, setState } from '../state/state'
import { clearAuthToken, setAuthToken } from '../net/authToken'
import { DEFAULT_PROXY_CONFIG, resetProxyConfigCache } from '../net/proxyConfig'
import { t } from '../i18n'

/** Count only /config probes: the wizard's child UI may fetch avatars/news too. */
const configFetchCount = () =>
  vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/config')).length

vi.mock('../state/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../state/store')>()
  return { ...actual, doConnect: vi.fn(async () => {}) }
})

const mockStorage: Record<string, string> = {}

beforeEach(() => {
  for (const k of Object.keys(mockStorage)) delete mockStorage[k]
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => mockStorage[key] ?? null,
    setItem: (key: string, value: string) => {
      mockStorage[key] = value
    },
    removeItem: (key: string) => {
      delete mockStorage[key]
    },
    clear: () => {
      for (const k of Object.keys(mockStorage)) delete mockStorage[k]
    },
  })
  try { localStorage.removeItem('mage-web-conn') } catch {}
  // finish() may await the /config probe when the store is still ALL-DEFAULTS
  // and nothing is cached. Stub it to a 404 (the old/stock proxy world →
  // ALL-DEFAULTS) so the wizard tests never touch the network — a dev machine
  // may run a REAL proxy on localhost:8788 whose answer would flip the gate.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })))
  resetProxyConfigCache()
  setState(initialState)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  resetProxyConfigCache()
  setState(initialState)
})

function next(times = 1) {
  for (let i = 0; i < times; i++) fireEvent.click(screen.getByTestId('setup-next'))
}

describe('SetupWizard', () => {
  it('walks the six steps with back/next and a live counter', () => {
    render(<SetupWizard onClose={() => {}} />)
    expect(screen.getByTestId('setup-wizard')).toBeTruthy()
    expect(screen.getByTestId('setup-counter').textContent).toContain('1')
    expect(screen.getByTestId('settings-ui-lang')).toBeTruthy()

    next()
    expect(screen.getByTestId('setup-username')).toBeTruthy()
    expect(screen.getByTestId('setup-counter').textContent).toContain('2')

    next()
    expect(screen.getByTestId('setup-preset-official')).toBeTruthy()
    fireEvent.click(screen.getByTestId('setup-back'))
    expect(screen.getByTestId('setup-username')).toBeTruthy()
    next(2)
    expect(screen.getByTestId('settings-layout-arena')).toBeTruthy()
    expect(screen.getByTestId('setup-counter').textContent).toContain('4')

    next()
    expect(screen.getByTestId('settings-sound-card')).toBeTruthy()

    next()
    expect(screen.getByTestId('setup-enter')).toBeTruthy()
    expect(screen.getByTestId('setup-counter').textContent).toContain('6')
  })

  it('the step-5 summary shows a single colon after the server label', () => {
    render(<SetupWizard onClose={() => {}} />)
    next() // identity
    fireEvent.change(screen.getByTestId('setup-username'), { target: { value: 'd1c' } })
    next() // server
    next() // board
    next() // soundplay
    next() // done

    const summary = document.querySelector('.setup-summary') as HTMLElement
    const serverRow = Array.from(summary.querySelectorAll('li')).find((li) =>
      li.textContent?.includes(t('login', 'server_target')),
    ) as HTMLElement
    expect(serverRow).toBeTruthy()
    // The label already ends with its own separator: no doubled colon.
    expect(serverRow.textContent).not.toContain('::')
  })

  it('skip marks setup done and leaves the login connection intact', () => {
    const onClose = vi.fn()
    const seen: Event[] = []
    const listener = (e: Event) => seen.push(e)
    window.addEventListener('nexus:setup-conn', listener)
    try {
      render(<SetupWizard onClose={onClose} />)
      fireEvent.click(screen.getByTestId('setup-skip'))
    } finally {
      window.removeEventListener('nexus:setup-conn', listener)
    }
    expect(isSetupDone()).toBe(true)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(loadConn()).toBeNull()
    expect(seen).toHaveLength(0)
  })

  it('finish saves identity+server, notifies login and closes', async () => {
    const onClose = vi.fn()
    const seen: Event[] = []
    const listener = (e: Event) => seen.push(e)
    window.addEventListener('nexus:setup-conn', listener)
    try {
      render(<SetupWizard onClose={onClose} />)
      next()
      fireEvent.change(screen.getByTestId('setup-username'), { target: { value: 'nuevo' } })
      next()
      fireEvent.click(screen.getByTestId('setup-preset-official'))
      next(3)
      fireEvent.click(screen.getByTestId('setup-enter'))
      // finish() is async: it may await the /config probe when the store
      // is still all-defaults and nothing is cached — settle its tail before
      // asserting on the wizard's completed state.
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    } finally {
      window.removeEventListener('nexus:setup-conn', listener)
    }
    expect(isSetupDone()).toBe(true)
    const saved = loadConn()
    expect(saved?.username).toBe('nuevo')
    expect(saved?.serverHost).toBe('beta.xmage.today')
    expect(seen).toHaveLength(1)
  })

  it('custom server preset reveals network fields', () => {
    render(<SetupWizard onClose={() => {}} />)
    next(2)
    expect(screen.queryByTestId('setup-server-host')).toBeNull()
    fireEvent.click(screen.getByTestId('setup-preset-custom'))
    expect(screen.getByTestId('setup-proxy-host')).toBeTruthy()
    expect(screen.getByTestId('setup-server-host')).toBeTruthy()
    expect(screen.getByTestId('setup-port')).toBeTruthy()
  })

  it('✕ close button closes without saving or marking setup done', () => {
    const onClose = vi.fn()
    render(<SetupWizard onClose={onClose} />)
    next()
    fireEvent.change(screen.getByTestId('setup-username'), { target: { value: 'sin-guardar' } })
    fireEvent.click(screen.getByTestId('setup-wizard-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(isSetupDone()).toBe(false)
    expect(loadConn()).toBeNull()
  })

  it('close button sits in the top-right corner, after the step counter', () => {
    render(<SetupWizard onClose={() => {}} />)
    const close = screen.getByTestId('setup-wizard-close')
    const counter = screen.getByTestId('setup-counter')
    const row = close.parentElement
    expect(row).toBe(counter.parentElement?.parentElement)
    expect(row?.lastElementChild).toBe(close)
    expect(counter.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('Escape closes without saving (topmost-modal aware)', () => {
    const onClose = vi.fn()
    render(<SetupWizard onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(isSetupDone()).toBe(false)
  })

  it('disables the password with the official preset (beta)', () => {
    render(<SetupWizard onClose={() => {}} />)
    next(2)
    fireEvent.click(screen.getByTestId('setup-preset-official'))
    fireEvent.click(screen.getByTestId('setup-back'))
    const pw = screen.getByTestId('setup-password') as HTMLInputElement
    expect(pw.disabled).toBe(true)
    expect(pw.value).toBe('')
    expect(screen.getByText(/no usa contraseña|no password/i)).toBeTruthy()
  })

  it('bloquea avanzar con el nombre vacío y lo exige al entrar (AUDIT)', () => {
    render(<SetupWizard onClose={() => {}} />)
    next()
    fireEvent.change(screen.getByTestId('setup-username'), { target: { value: '   ' } })
    fireEvent.click(screen.getByTestId('setup-next'))
    expect(screen.getByTestId('setup-username-error')).toBeTruthy()
    expect(screen.getByTestId('setup-counter').textContent).toContain('2')
    fireEvent.change(screen.getByTestId('setup-username'), { target: { value: 'audit' } })
    expect(screen.queryByTestId('setup-username-error')).toBeNull()
    fireEvent.click(screen.getByTestId('setup-next'))
    expect(screen.getByTestId('setup-counter').textContent).toContain('3')
  })
})

describe('SetupWizard — locked deployment (VITE_LOCK_DEPLOYMENT)', () => {
  it('drops the server step: no preset picker, one fewer step, target still saved', async () => {
    vi.stubEnv('VITE_LOCK_DEPLOYMENT', '1')
    const onClose = vi.fn()
    const seen: Event[] = []
    const listener = (e: Event) => seen.push(e)
    window.addEventListener('nexus:setup-conn', listener)
    try {
      render(<SetupWizard onClose={onClose} />)
      // language → identity → board (no 'server' in between)
      next()
      fireEvent.change(screen.getByTestId('setup-username'), { target: { value: 'locked' } })
      next()
      expect(screen.queryByTestId('setup-preset-official')).toBeNull()
      expect(screen.queryByTestId('setup-preset-local')).toBeNull()
      expect(screen.queryByTestId('setup-preset-custom')).toBeNull()
      // lands on the board step, counter total is 5 (was 6)
      expect(screen.getByTestId('settings-layout-arena')).toBeTruthy()
      expect(screen.getByTestId('setup-counter').textContent).toContain('3')
      expect(screen.getByTestId('setup-counter').textContent).toContain('5')
      next(2)
      expect(screen.getByTestId('setup-enter')).toBeTruthy()
      expect(screen.getByTestId('setup-counter').textContent).toContain('5')
      fireEvent.click(screen.getByTestId('setup-enter'))
      // finish() is async — settle its tail before asserting the close.
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    } finally {
      window.removeEventListener('nexus:setup-conn', listener)
    }
    expect(isSetupDone()).toBe(true)
    expect(onClose).toHaveBeenCalledTimes(1)
    // the wizard silently persisted the deployment's baked target
    const saved = loadConn()
    expect(saved?.username).toBe('locked')
    expect(saved?.serverHost).toBeTruthy()
    expect(seen).toHaveLength(1)
  })

  it('ignores a stale foreign saved connection and bakes the default target', async () => {
    vi.stubEnv('VITE_LOCK_DEPLOYMENT', '1')
    localStorage.setItem('mage-web-conn', JSON.stringify({
      wsHost: 'someone-elses-proxy', proxyPort: 8787,
      serverHost: 'beta.xmage.today', port: 17171,
      username: 'x', password: '', flagName: 'es', avatarId: 10,
    }))
    render(<SetupWizard onClose={() => {}} />)
    next()
    fireEvent.change(screen.getByTestId('setup-username'), { target: { value: 'locked' } })
    next(3)
    fireEvent.click(screen.getByTestId('setup-enter'))
    // finish() is async — settle its tail before reading the save.
    await waitFor(() => expect(loadConn()?.serverHost).not.toBe('beta.xmage.today'))
    const saved = loadConn()
    expect(saved?.serverHost).not.toBe('beta.xmage.today')
  })

  it('Enter connects using the just-built connection', async () => {
    vi.stubEnv('VITE_LOCK_DEPLOYMENT', '1')
    vi.mocked(doConnect).mockClear()
    const onClose = vi.fn()
    render(<SetupWizard onClose={onClose} />)
    next()
    fireEvent.change(screen.getByTestId('setup-username'), { target: { value: 'locked' } })
    next(3)
    fireEvent.click(screen.getByTestId('setup-enter'))
    // finish() is async — settle its tail before asserting the connect.
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(doConnect).toHaveBeenCalledTimes(1)
    // same connection the wizard persisted, and the built target leads
    const args = vi.mocked(doConnect).mock.calls[0]
    expect(args[4]).toBe('locked')
    expect(args[2]).toBe(loadConn()?.serverHost)
  })
})

describe('SetupWizard — token hand-off on Enter', () => {
  const walkToDone = () => {
    next() // language -> identity
    fireEvent.change(screen.getByTestId('setup-username'), { target: { value: 'op' } })
    next(4) // identity -> server -> board -> soundplay -> done
    expect(screen.getByTestId('setup-enter')).toBeTruthy()
  }

  beforeEach(() => {
    setState(initialState)
    clearAuthToken()
    vi.mocked(doConnect).mockClear()
  })

  afterEach(() => {
    setState(initialState)
    clearAuthToken()
  })

  it('does NOT connect on a token-gated deployment with no token in memory (cold-page 4401 guard)', () => {
    setState({ proxyConfig: { ...DEFAULT_PROXY_CONFIG, authRequired: true } })
    clearAuthToken()
    const onClose = vi.fn()
    render(<SetupWizard onClose={onClose} />)
    walkToDone()
    fireEvent.click(screen.getByTestId('setup-enter'))

    // The dead-end: firing doConnect here would send no token and the proxy
    // closes 4401 ("Auth token required"). It must not be called at all.
    expect(doConnect).not.toHaveBeenCalled()
    // The setup still completes: persisted + closed, login owns the connect.
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(isSetupDone()).toBe(true)
    expect(loadConn()?.username).toBe('op')
  })

  it('connects with the remembered token when the deployment is token-gated', () => {
    setState({ proxyConfig: { ...DEFAULT_PROXY_CONFIG, authRequired: true } })
    setAuthToken('tk-mem')
    render(<SetupWizard onClose={() => {}} />)
    walkToDone()
    fireEvent.click(screen.getByTestId('setup-enter'))

    expect(doConnect).toHaveBeenCalledTimes(1)
    // args[8] is the authToken (see doConnect signature / LoginScreen.submit)
    expect(vi.mocked(doConnect).mock.calls[0][8]).toBe('tk-mem')
  })

  it('Enter presents the token this tab restored from sessionStorage (reload)', () => {
    setState({ proxyConfig: { ...DEFAULT_PROXY_CONFIG, authRequired: true } })
    // a previous page load left the token in this tab: the module init re-reads
    // it, exactly like a reload — the wizard must hand it off, never re-prompt.
    setAuthToken('tk-restored')
    render(<SetupWizard onClose={() => {}} />)
    walkToDone()
    fireEvent.click(screen.getByTestId('setup-enter'))

    expect(doConnect).toHaveBeenCalledTimes(1)
    expect(vi.mocked(doConnect).mock.calls[0][8]).toBe('tk-restored')
  })

  it('after a logout / 4401 cleared the stored token, Enter falls back to the cold-page guard', () => {
    setState({ proxyConfig: { ...DEFAULT_PROXY_CONFIG, authRequired: true } })
    setAuthToken('tk-restored')
    clearAuthToken() // logout / rejection wipes the memory copy AND sessionStorage
    const onClose = vi.fn()
    render(<SetupWizard onClose={onClose} />)
    walkToDone()
    fireEvent.click(screen.getByTestId('setup-enter'))

    expect(doConnect).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('stays login-neutral guard: a non-token deployment still connects on Enter', () => {
    setState({ proxyConfig: { ...DEFAULT_PROXY_CONFIG, authRequired: false } })
    clearAuthToken()
    render(<SetupWizard onClose={() => {}} />)
    walkToDone()
    fireEvent.click(screen.getByTestId('setup-enter'))

    expect(doConnect).toHaveBeenCalledTimes(1)
    expect(vi.mocked(doConnect).mock.calls[0][8]).toBeUndefined()
  })

  // ─── Enter can race the App-mount /config probe ─────────────────────────

  it('Enter beats the probe: the store still all-defaults + nothing cached → finish awaits a FRESH probe and a gated answer is caught (no tokenless connect)', async () => {
    // The App-mount probe has not settled: the store holds the ALL-DEFAULTS
    // boot shape and the module cache is empty — the exact race. The probe
    // answers GATED, so the fresh look must see authRequired and refuse the
    // tokenless connect instead of firing it into a 4401.
    setState({ proxyConfig: DEFAULT_PROXY_CONFIG })
    resetProxyConfigCache()
    clearAuthToken()
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ authRequired: true, hideServerTarget: false, pinnedTarget: null, deploymentName: 'Gated', llmRelay: false }),
    })))
    const onClose = vi.fn()
    render(<SetupWizard onClose={onClose} />)
    walkToDone()
    fireEvent.click(screen.getByTestId('setup-enter'))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    // the fresh probe landed on the store before the decision was made
    expect(configFetchCount()).toBe(1)
    expect(doConnect).not.toHaveBeenCalled()
    expect(isSetupDone()).toBe(true)
    expect(loadConn()?.username).toBe('op')
  })

  it('Enter with the store still all-defaults on a stock proxy (404) still connects on Enter (unaffected by the await)', async () => {
    setState({ proxyConfig: DEFAULT_PROXY_CONFIG })
    resetProxyConfigCache()
    clearAuthToken()
    // beforeEach already stubs a 404 fetch: ALL-DEFAULTS is the honest answer.
    const onClose = vi.fn()
    render(<SetupWizard onClose={onClose} />)
    walkToDone()
    fireEvent.click(screen.getByTestId('setup-enter'))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(doConnect).toHaveBeenCalledTimes(1)
    expect(vi.mocked(doConnect).mock.calls[0][8]).toBeUndefined()
  })

  it('Enter does NOT re-probe when a config is already cached (the App probe settled first: no duplicate fetch)', async () => {
    // A settled stock probe (404 → ALL-DEFAULTS cached in the module): finish
    // must trust it and not fire a second /config request.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })))
    await import('../state/gateway').then(({ probeProxyConfig }) => probeProxyConfig('localhost', 8787))
    setState({ proxyConfig: DEFAULT_PROXY_CONFIG })
    clearAuthToken()
    const fetchCalls = () => configFetchCount()
    const before = fetchCalls()
    const onClose = vi.fn()
    render(<SetupWizard onClose={onClose} />)
    walkToDone()
    fireEvent.click(screen.getByTestId('setup-enter'))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(fetchCalls()).toBe(before) // the cached config was reused
    expect(doConnect).toHaveBeenCalledTimes(1)
  })
})
