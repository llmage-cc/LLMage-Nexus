import { useEffect, useState } from 'react'
import Tabs from '../ui/Tabs'
import IconButton from '../ui/IconButton'
import CloseButton from '../ui/CloseButton'
import { clearError, doConnect, useStore, loadConn, clearActiveGame, clearActiveDraft, isSameAccount } from '../state/store'
import { getState } from '../state/state'
import CountryFlag from './CountryFlag'
import AvatarImage from './AvatarImage'
import AvatarPickerModal from './AvatarPickerModal'
import { guessDefaultFlag } from './defaultFlag'
import LanguageSelector from '../i18n/LanguageSelector'
import SettingsModal from '../settings/SettingsModal'
import AboutModal from '../system/AboutModal'
import { useNewsBadge } from '../system/useNewsBadge'
import Icon from '../ui/Icon'
import { clickableProps } from '../ui/clickable'
import { useTranslation } from '../i18n'
import { SETUP_CONN_EVENT, openSetupWizard } from '../setup/setupFlag'
import { isDeploymentLocked } from '../setup/deploymentLock'
import { parseAutoConnect } from './autoConnect'
import { setAuthToken as rememberAuthToken, getAuthToken } from '../net/authToken'
import type { ConnectionInfo } from '../state/persistence'
import './LoginScreen.css'

function urlProxyPort(): number | null {
  return parseAutoConnect(window.location.search).proxyPort ?? null
}

import { sortedFlags, countryName, type ServerPreset } from './flags'
import Button from '../ui/Button'
import Field from '../ui/Field'

// Deployment defaults baked at build time. When a public/hosted build bakes a
// remote proxy host, a stale "local" connection saved in localStorage must not
// override it (otherwise the browser tries ws://localhost:8787 and fails).
const BAKED_PROXY_HOST = (import.meta.env.VITE_DEFAULT_PROXY_HOST as string | undefined) ?? ''
const BAKED_PROXY_PORT = Number(import.meta.env.VITE_DEFAULT_PROXY_PORT) || 8787
const BAKED_SERVER_HOST = (import.meta.env.VITE_DEFAULT_SERVER_HOST as string | undefined) ?? 'localhost'
// XDHS flavor: hosted deployments expose the second proxy on its own tunnel
// (or the same host with another port); launcher/local builds use localhost.
const BAKED_XDHS_PROXY_HOST = (import.meta.env.VITE_DEFAULT_XDHS_PROXY_HOST as string | undefined) ?? ''
const BAKED_XDHS_PROXY_PORT = Number(import.meta.env.VITE_DEFAULT_XDHS_PROXY_PORT) || 8797
const XDHS_SERVER_HOST = 'mage.xdhs.net'
const isLoopbackHost = (h: string) => h === 'localhost' || h === '127.0.0.1' || h === '::1'
const REMOTE_PROXY = !!BAKED_PROXY_HOST && !isLoopbackHost(BAKED_PROXY_HOST)
const presetOf = (host: string): ServerPreset =>
  host === 'beta.xmage.today' ? 'official' : host === XDHS_SERVER_HOST ? 'xdhs' : isLoopbackHost(host) ? 'local' : 'custom'

// The port of the deployment's baked target (see BAKED_SERVER_HOST). A locked
// deployment always connects to the baked host+port.
const BAKED_SERVER_PORT = (import.meta.env.VITE_DEFAULT_SERVER_PORT as string | undefined) ?? '17171'

export default function LoginScreen() {
  const { t, tError, lang } = useTranslation()
  // A deployment locked to its own server (VITE_LOCK_DEPLOYMENT ON) drops the
  // server-target choice entirely and always connects to the baked target: a
  // `?server=` deep-link override and any stale saved/foreign connection are
  // ignored. `hideServerTarget` (proxy /config) stays orthogonal — the lock
  // removes the *choice*, hideServerTarget hides the editable *fields*.
  const locked = isDeploymentLocked()
  const phase = useStore((s) => s.phase)
  const error = useStore((s) => s.error)
  const [proxyHost, setProxyHost] = useState(import.meta.env.VITE_DEFAULT_PROXY_HOST ?? 'localhost')
  const [proxyPort, setProxyPort] = useState(Number(import.meta.env.VITE_DEFAULT_PROXY_PORT) || 8787)
  const [serverHost, setServerHost] = useState(BAKED_SERVER_HOST)
  const [port, setPort] = useState(import.meta.env.VITE_DEFAULT_SERVER_PORT ?? '17171')
  const [username, setUsername] = useState(() => getState().conn?.username ?? (import.meta.env.DEV ? 'player1' : ''))
  const [password, setPassword] = useState(import.meta.env.DEV ? 'password' : '')
  const [flagName, setFlagName] = useState(() => loadConn()?.flagName ?? guessDefaultFlag())
  const [avatarId, setAvatarId] = useState(10)
  // The form unmounts while `phase === 'connecting'` (the App splash) and
  // remounts on failure, so seed the token from this tab's stored value to keep a
  // plain failed attempt from wiping it (only a logout / 4401 clears it). A page
  // reload re-seeds it from sessionStorage, so the token field comes back filled.
  const [authToken, setAuthToken] = useState(() => getAuthToken())
  const [showAvatarPicker, setShowAvatarPicker] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const { unseen: unseenNews, refresh: refreshNews } = useNewsBadge()
  const [preset, setPreset] = useState<ServerPreset>(() => (locked ? 'local' : presetOf(BAKED_SERVER_HOST)))
  const pendingDeepLink = useStore((s) => s.pendingDeepLink)
  // Deployment gating: the proxy's /config probe decides whether the token
  // field shows and whether the XMage target is pinned/hidden.
  const proxyConfig = useStore((s) => s.proxyConfig)
  const proxyReject = useStore((s) => s.proxyReject)

  useEffect(() => {
    const url = parseAutoConnect(window.location.search)
    // A locked deployment ignores a `?server=` / `?serverPort=` override: the
    // connect always uses its baked target. (Read here, not from render state,
    // so this mount-only effect has no dependency on the flag.)
    const locked = isDeploymentLocked()
    if (locked) {
      delete url.serverHost
      delete url.serverPort
    }
    const saved = loadConn()
    const staleLocalConn = !!saved && REMOTE_PROXY && isLoopbackHost(saved.wsHost)
    if (saved && !staleLocalConn) {
      const sameUser = !url.username || url.username === saved.username
      setProxyHost(url.proxyHost ?? saved.wsHost)
      setProxyPort(url.proxyPort ?? saved.proxyPort)
      setServerHost(locked ? BAKED_SERVER_HOST : url.serverHost ?? saved.serverHost)
      setPort(locked ? BAKED_SERVER_PORT : String(url.serverPort ?? saved.port))
      setUsername(url.username ?? saved.username)
      setPassword(sameUser ? saved.password : '')
      if (saved.flagName) setFlagName(saved.flagName)
      if (saved.avatarId) setAvatarId(saved.avatarId)

      const target = locked ? BAKED_SERVER_HOST : url.serverHost ?? saved.serverHost
      if (target === 'beta.xmage.today') {
        setPreset('official')
      } else if (target === XDHS_SERVER_HOST) {
        setPreset('xdhs')
      } else if (target === 'localhost' || target === '127.0.0.1') {
        setPreset('local')
      } else {
        setPreset('custom')
      }
    } else {
      if (url.proxyHost) setProxyHost(url.proxyHost)
      if (url.proxyPort != null) setProxyPort(url.proxyPort)
      if (!locked && url.serverHost) setServerHost(url.serverHost)
      if (!locked && url.serverPort != null) setPort(String(url.serverPort))
      if (url.username) setUsername(url.username)
      if (!locked && url.serverHost === 'beta.xmage.today') setPreset('official')
      else if (!locked && url.serverHost === XDHS_SERVER_HOST) setPreset('xdhs')
      else if (!locked && (url.proxyHost || url.serverHost)) setPreset('custom')
    }
    const applySetupConn = (e: Event) => {
      const conn = (e as CustomEvent<ConnectionInfo>).detail
      if (!conn) return
      setProxyHost(conn.wsHost)
      // un ?proxyPort= explícito en la URL SIEMPRE gana (lo fijan los e2e para
      // el FixtureServer; el wizard/defaults no debe pisarlo)
      setProxyPort(urlProxyPort() ?? conn.proxyPort)
      setServerHost(locked ? BAKED_SERVER_HOST : conn.serverHost)
      setPort(locked ? BAKED_SERVER_PORT : String(conn.port))
      setUsername(conn.username)
      setPassword(conn.password)
      if (conn.flagName) setFlagName(conn.flagName)
      if (conn.avatarId) setAvatarId(conn.avatarId)
      if (conn.serverHost === 'beta.xmage.today') {
        setPreset('official')
      } else if (conn.serverHost === XDHS_SERVER_HOST) {
        setPreset('xdhs')
      } else if (conn.serverHost === 'localhost' || conn.serverHost === '127.0.0.1') {
        setPreset('local')
      } else {
        setPreset('custom')
      }
    }
    window.addEventListener(SETUP_CONN_EVENT, applySetupConn)
    return () => window.removeEventListener(SETUP_CONN_EVENT, applySetupConn)
  }, [])

  const handleSelectPreset = (nextPreset: ServerPreset) => {
    setPreset(nextPreset)
    if (nextPreset === 'local') {
      setProxyHost('localhost')
      setProxyPort(8787)
      setServerHost('localhost')
      setPort('17171')
    } else if (nextPreset === 'official') {
      setProxyHost(REMOTE_PROXY ? BAKED_PROXY_HOST : 'localhost')
      setProxyPort(REMOTE_PROXY ? BAKED_PROXY_PORT : 8787)
      setServerHost('beta.xmage.today')
      setPort('17171')
    } else if (nextPreset === 'xdhs') {
      setProxyHost(REMOTE_PROXY ? BAKED_XDHS_PROXY_HOST || BAKED_PROXY_HOST : 'localhost')
      setProxyPort(REMOTE_PROXY ? BAKED_XDHS_PROXY_PORT : 8797)
      setServerHost(XDHS_SERVER_HOST)
      setPort('17171')
    }
  }

  const busy = phase === 'connecting'
  // The public server (beta) does not check passwords (authenticationActivated=false):
  // the field is disabled and nothing is sent.
  const passwordDisabledOnBeta = serverHost.trim() === 'beta.xmage.today'
  const passwordValue = passwordDisabledOnBeta ? '' : password

  useEffect(() => {
    if (passwordDisabledOnBeta && password) setPassword('')
  }, [passwordDisabledOnBeta, password])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    // the same account logging in again (its session was lost) resumes its game
    if (!isSameAccount(loadConn(), serverHost.trim() || proxyHost.trim(), parseInt(port, 10) || 17171, username.trim())) {
      clearActiveGame()
      clearActiveDraft()
    }
    // The token is per-tab: kept in memory and sessionStorage for the
    // reconnect/relogin paths (a reload re-attaches with it); never localStorage,
    // a cookie or an URL.
    rememberAuthToken(authToken)
    void doConnect(
      proxyHost.trim(),
      proxyPort,
      serverHost.trim() || proxyHost.trim(),
      parseInt(port, 10) || 17171,
      username.trim(),
      passwordValue,
      flagName,
      avatarId,
      authToken || undefined,
    )
  }

  return (
    <div className="login-wrap">
      <div className="login-top-bar">
        <LanguageSelector showCardLangToggle={true} />
        <IconButton label={t('common', 'settings')} icon="settings" size="lg"
          className="login-settings-btn"
          onClick={() => setShowSettings(true)}
          data-testid="open-settings" />
        <IconButton label={t('system', 'about_title')} size="lg"
          className="login-settings-btn"
          onClick={() => setShowAbout(true)}
          data-testid="open-about">
          <Icon name="info" size={16} />
          {unseenNews && (
            <span className="login-news-dot" data-testid="login-news-dot" aria-hidden="true">●</span>
          )}
        </IconButton>
      </div>

      <div className="login-bg-glow login-bg-glow-1" />
      <div className="login-bg-glow login-bg-glow-2" />

      <form className="login-card panel" onSubmit={submit}>
        {/* Deployment branding: use the configured name as the logo alt when set. */}
        <div className="login-header">
          <img src="/logo.jpeg" alt={proxyConfig.deploymentName} className="login-logo-img" />
          <p className="subtitle">{t('login.subtitle')}</p>
        </div>

        {pendingDeepLink && (
          <div className="login-invite-banner" data-testid="login-invite-banner">
            <span className="invite-icon"><Icon name="send" size={14} /></span>
            <span>{t('lobby', 'invite_login_hint')}</span>
          </div>
        )}

        {proxyReject && (
          <div className="error-box" role="alert" data-testid="login-proxy-reject">
            <span className="error-icon"><Icon name="alert" size={14} /></span>
            <span className="error-msg">
              {t('errors', 'proxy_rejected', { reason: proxyReject })}
            </span>
          </div>
        )}

        {/* Server Preset Selector — hidden when the deployment pins its target
            (hideServerTarget) or is locked to its own server (LOCK). */}
        {!locked && !proxyConfig.hideServerTarget && (
          <div className="login-presets-container">
            <span className="login-presets-title">{t('login.server_target')}</span>
            <Tabs
              variant="segmented"
              className="login-presets-row"
              value={preset}
              onChange={handleSelectPreset}
              items={[
                { id: 'local', icon: 'home', label: t('login.server_local'), title: t('login.server_local') },
                { id: 'official', icon: 'globe', label: t('login.server_official'), title: t('login.server_official') },
                { id: 'xdhs', icon: 'users', label: t('login.server_xdhs'), title: t('login.server_xdhs') },
                { id: 'custom', icon: 'settings', label: t('login.server_custom'), title: t('login.server_custom') },
              ]}
            />
          </div>
        )}

        {/* User Identity Section */}
        <div className="login-user-section">
          <div
            className="user-avatar-preview"
            onClick={() => setShowAvatarPicker(true)}
            title={t('lobby', 'avatar_pick_title')}
            {...clickableProps(() => setShowAvatarPicker(true))}
          >
            <AvatarImage avatarId={avatarId} username={username} size="large" />
            <div className="user-avatar-flag-pill">
              <CountryFlag flagName={flagName} />
            </div>
            <span className="user-avatar-badge-edit"><Icon name="pencil" size={12} /></span>
          </div>
          <div className="user-inputs-col">
            <div className="user-name-and-flag-grid">
              <Field className="login-field-username" label={t('login.username')}>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  maxLength={14}
                  placeholder={t('login.username')}
                  autoComplete="username"
                  required
                />
              </Field>
              <Field className="login-field-flag" label={t('login.flag')}>
                <select value={flagName} onChange={(e) => setFlagName(e.target.value)}>
                  {sortedFlags(lang).map((f) => (
                    <option key={f.code} value={f.code}>
                      {f.emoji} {countryName(f.code, lang)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label={t('login.password')} hint={passwordDisabledOnBeta && t('login', 'password_disabled_beta')} hintTone="warn">
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                placeholder={t('login.password')}
                autoComplete="current-password"
                disabled={passwordDisabledOnBeta}
                data-testid="login-password"
              />
            </Field>
            {proxyConfig.authRequired && (
              <Field label={t('login.auth_token')}>
                <input
                  value={authToken}
                  // Mirror every keystroke into module memory so the token is
                  // available to *any* component (e.g. the setup wizard's Enter)
                  // as soon as it is typed — not only after this form's submit().
                  // Per-tab: `rememberAuthToken` also mirrors it into
                  // sessionStorage (never localStorage / cookie / URL).
                  onChange={(e) => { setAuthToken(e.target.value); rememberAuthToken(e.target.value) }}
                  type="password"
                  placeholder={t('login', 'auth_token_placeholder')}
                  autoComplete="off"
                  data-testid="login-auth-token"
                />
              </Field>
            )}
          </div>
        </div>

        {/* Network Connection Configuration Box — hidden when the deployment pins its target
            (hideServerTarget) OR the build is locked to its own server (VITE_LOCK_DEPLOYMENT) —
            a locked deployment must never expose editable Server/Port even if the proxy omits
            hideServerTarget; the pinned target is shown read-only instead. */}
        {locked || proxyConfig.hideServerTarget ? (
          <div className="login-pinned-target" data-testid="login-pinned-target">
            <span className="pinned-target-label">{t('login.pinned_target')}</span>
            <span className="pinned-target-value">{proxyConfig.pinnedTarget ?? `${serverHost}:${port}`}</span>
          </div>
        ) : (
          <details className="login-network-box">
            <summary className="login-network-header">
              <span className="network-box-title" title={t('login.network_config')}>{t('login.network_config')}</span>
              <span className="network-box-hint">{serverHost}:{port}</span>
            </summary>
            <div className="login-network-fields">
              <div className="network-field-row">
                <Field className="network-field-proxy" label={t('login.proxy')}>
                  <input
                    value={proxyHost}
                    onChange={(e) => {
                      setProxyHost(e.target.value)
                      setPreset('custom')
                    }}
                  />
                </Field>
                <Field className="network-field-port" label={t('login.proxy_port')}>
                  <input
                    value={proxyPort}
                    onChange={(e) => {
                      setProxyPort(Number(e.target.value) || 8787)
                      setPreset('custom')
                    }}
                    type="number"
                  />
                </Field>
              </div>
              <div className="network-field-row">
                <Field className="network-field-host" label={t('login.xmage_server')}>
                  <input
                    value={serverHost}
                    onChange={(e) => {
                      setServerHost(e.target.value)
                      setPreset('custom')
                    }}
                  />
                </Field>
                <Field className="network-field-port" label={t('login.port')}>
                  <input
                    value={port}
                    onChange={(e) => {
                      setPort(e.target.value)
                      setPreset('custom')
                    }}
                    type="number"
                  />
                </Field>
              </div>
            </div>
          </details>
        )}

        {error && (
          <div className="error-box">
            <span className="error-icon"><Icon name="alert" size={14} /></span>
            <span className="error-msg">{tError(error, 'login')}</span>
            <CloseButton variant="plain" size="sm" onClick={clearError} />
          </div>
        )}

        <Button variant="primary" className="login-submit-btn" disabled={busy} type="submit">
          {busy ? (
            <span className="btn-connecting-wrap">
              <span className="btn-spinner" />
              <span>{t('login.connecting')}</span>
            </span>
          ) : (
            <span>{t('login.connect_btn')}</span>
          )}
        </Button>
        <Button variant="link" size="sm" onClick={openSetupWizard} data-testid="login-open-setup">
          {t('setup', 'first_time')}
        </Button>
        <div className="login-attribution">
          {t('login.attribution')}
        </div>
      </form>

      {showAvatarPicker && (
        <AvatarPickerModal
          selectedAvatarId={avatarId}
          onSelect={(id) => setAvatarId(id)}
          onClose={() => setShowAvatarPicker(false)}
        />
      )}
      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}
      {showAbout && (
        <AboutModal
          onClose={() => {
            setShowAbout(false)
            refreshNews()
          }}
        />
      )}
    </div>
  )
}
