import { useEffect, useState } from 'react'
import Button from '../ui/Button'
import { useTranslation } from '../i18n'
import DialogShell from '../ui/DialogShell'
import Icon from '../ui/Icon'
import { LanguageSection, InterfaceSection, BoardSection, SoundSection, GameplayQuickSection } from '../settings/sections'
import AvatarImage from '../lobby/AvatarImage'
import AvatarPickerModal from '../lobby/AvatarPickerModal'
import CountryFlag from '../lobby/CountryFlag'
import { guessDefaultFlag } from '../lobby/defaultFlag'
import { sortedFlags, countryName, type ServerPreset } from '../lobby/flags'
import { loadConn, saveConn, type ConnectionInfo } from '../state/persistence'
import { doConnect } from '../state/store'
import { getAuthToken as rememberedAuthToken } from '../net/authToken'
import { peekProxyConfig, DEFAULT_PROXY_CONFIG } from '../net/proxyConfig'
import { probeProxyConfig } from '../state/gateway'
import { getState } from '../state/state'
import { parseAutoConnect } from '../lobby/autoConnect'
import { markSetupDone, SETUP_CONN_EVENT } from './setupFlag'
import { isDeploymentLocked } from './deploymentLock'
import './SetupWizard.css'
import Field from '../ui/Field'

type StepId = 'language' | 'identity' | 'server' | 'board' | 'soundplay' | 'done'

const ALL_STEPS: StepId[] = ['language', 'identity', 'server', 'board', 'soundplay', 'done']

/** The steps the wizard walks. A locked deployment drops the server-picker step. */
function stepsFor(locked: boolean): StepId[] {
  return locked ? ALL_STEPS.filter((s) => s !== 'server') : ALL_STEPS
}

interface ServerDraft {
  preset: ServerPreset
  proxyHost: string
  proxyPort: number
  serverHost: string
  port: string
}

function initialServerDraft(locked: boolean): ServerDraft {
  const base: ServerDraft = {
    preset: 'local',
    proxyHost: import.meta.env.VITE_DEFAULT_PROXY_HOST ?? 'localhost',
    proxyPort: Number(import.meta.env.VITE_DEFAULT_PROXY_PORT) || 8787,
    serverHost: import.meta.env.VITE_DEFAULT_SERVER_HOST ?? 'localhost',
    port: import.meta.env.VITE_DEFAULT_SERVER_PORT ?? '17171',
  }
  // A locked deployment bakes its own target and never lets a saved/foreign
  // connection override it.
  if (locked) return base
  const saved = loadConn()
  if (!saved) return base
  const draft: ServerDraft = {
    preset: 'custom',
    proxyHost: saved.wsHost,
    proxyPort: saved.proxyPort,
    serverHost: saved.serverHost,
    port: String(saved.port),
  }
  if (saved.serverHost === 'beta.xmage.today') draft.preset = 'official'
  else if (saved.serverHost === 'mage.xdhs.net') draft.preset = 'xdhs'
  else if (saved.serverHost === 'localhost' || saved.serverHost === '127.0.0.1') draft.preset = 'local'
  return draft
}

function applyPreset(p: ServerPreset, prev: ServerDraft): ServerDraft {
  if (p === 'local') return { ...prev, preset: p, proxyHost: 'localhost', proxyPort: 8787, serverHost: 'localhost', port: '17171' }
  if (p === 'official') return { ...prev, preset: p, proxyHost: 'localhost', proxyPort: 8787, serverHost: 'beta.xmage.today', port: '17171' }
  if (p === 'xdhs') return { ...prev, preset: p, proxyHost: 'localhost', proxyPort: 8797, serverHost: 'mage.xdhs.net', port: '17171' }
  return { ...prev, preset: p }
}

export default function SetupWizard({ onClose }: { onClose: () => void }) {
  const { t, lang } = useTranslation()
  const locked = isDeploymentLocked()
  const steps = stepsFor(locked)
  const [step, setStep] = useState(0)
  const [username, setUsername] = useState(() => loadConn()?.username ?? (import.meta.env.DEV ? 'player1' : ''))
  const [password, setPassword] = useState(() => loadConn()?.password ?? (import.meta.env.DEV ? 'password' : ''))
  const [flagName, setFlagName] = useState(() => loadConn()?.flagName ?? guessDefaultFlag())
  const [avatarId, setAvatarId] = useState(() => loadConn()?.avatarId ?? 10)
  const [showAvatarPicker, setShowAvatarPicker] = useState(false)
  const [server, setServer] = useState<ServerDraft>(() => initialServerDraft(locked))
  const [identityError, setIdentityError] = useState(false)

  const stepId = steps[step]
  const isLast = stepId === 'done'
  // The public server (beta) does not use passwords; the field is disabled,
  // cleared and does not travel in the saved connection.
  const passwordDisabledOnBeta = server.serverHost.trim() === 'beta.xmage.today'

  useEffect(() => {
    if (passwordDisabledOnBeta && password) setPassword('')
  }, [passwordDisabledOnBeta, password])

  const goNext = () => {
    if (stepId === 'identity' && !username.trim()) {
      setIdentityError(true)
      return
    }
    setIdentityError(false)
    setStep(step + 1)
  }

  const buildConn = (): ConnectionInfo => ({
    wsHost: server.proxyHost.trim() || 'localhost',
    proxyPort: server.proxyPort,
    serverHost: server.serverHost.trim() || server.proxyHost.trim() || 'localhost',
    port: parseInt(server.port, 10) || 17171,
    username: username.trim(),
    password: passwordDisabledOnBeta ? '' : password,
    flagName,
    avatarId,
  })

  const finish = async () => {
    if (!username.trim()) {
      setStep(steps.indexOf('identity'))
      setIdentityError(true)
      return
    }
    const conn = buildConn()
    saveConn(conn)
    // Pre-fill the login screen (it listens for SETUP_CONN_EVENT): still useful if
    // the connect below fails and the user lands back on the form.
    window.dispatchEvent(new CustomEvent(SETUP_CONN_EVENT, { detail: conn }))
    markSetupDone()
    // The final primary button promises "you can connect and play now": it must
    // actually connect, not just persist and close. On a gated deployment
    // the token is already in module memory from the login screen; an explicit
    // ?proxyPort= (the e2e FixtureServer) still wins, exactly like login's submit.
    const token = rememberedAuthToken()
    // A token-gated deployment with NO token in memory yet (the very first
    // run: the wizard's Enter is the first thing the user clicks, and the token
    // field lives on the login screen) must not fire a connect the proxy will
    // close with 4401 ("Auth token required"). Persist + close and leave the
    // connect to the login screen, whose token field is visible and pre-filled
    // by the SETUP_CONN_EVENT above. A non-gated deployment, or a gated one with
    // a token already remembered, connects immediately.
    //
    // That gate decision reads `authRequired`, which the App-mount probe
    // fills ASYNC — a fast first-run user can hit Enter while the store still
    // holds the ALL-DEFAULTS boot shape and the probe has not settled. When the
    // gate decision actually depends on it (no remembered token) AND the store
    // is still all-defaults AND no probe result is cached, await a FRESH probe
    // before deciding, so the gated case is caught instead of firing a
    // tokenless connect → 4401 → bounce back to login. The probe never throws
    // (it degrades to defaults).
    let authRequired = getState().proxyConfig.authRequired
    if (!token && getState().proxyConfig === DEFAULT_PROXY_CONFIG && !peekProxyConfig()) {
      await probeProxyConfig(conn.wsHost, conn.proxyPort)
      authRequired = getState().proxyConfig.authRequired
    }
    if (authRequired && !token) {
      onClose()
      return
    }
    void doConnect(
      conn.wsHost,
      parseAutoConnect(window.location.search).proxyPort ?? conn.proxyPort,
      conn.serverHost,
      conn.port,
      conn.username,
      conn.password,
      conn.flagName,
      conn.avatarId,
      token || undefined,
    )
    onClose()
  }

  const skip = () => {
    // Omitir deja el login INTACTO: solo marca el setup como hecho. Persistir
    // una conexión por defecto (proxy 8787) pisaba el ?proxyPort= del e2e y
    // lanzaba los tests fake contra el proxy real (causa raíz de los 77 fallos
    // de staging/lobby del 2026-09-05→09-11).
    markSetupDone()
    onClose()
  }

  const serverLabel = server.preset === 'official'
    ? t('login', 'server_official')
    : server.preset === 'xdhs'
      ? t('login', 'server_xdhs')
      : server.preset === 'local' ? t('login', 'server_local') : `${server.serverHost}:${server.port}`

  return (
    <DialogShell
      labelledBy="setup-title"
      titleId="setup-title"
      size="lg"
      testId="setup-wizard"
      legacyPanelClass="setup-wizard"
      onClose={onClose}
      kickerIcon="sparkles"
      kickerLabel={t('setup', 'title')}
      title={t('setup', stepId === 'language' ? 'welcome_title' : stepId === 'done' ? 'done_title' : `step_${stepId}` as 'step_language')}
      topRight={<span className="setup-counter" data-testid="setup-counter">{t('setup', 'step_of', { current: step + 1, total: steps.length })}</span>}
      closeInCorner
    >
      <div className="setup-body">
        {stepId === 'language' && (
          <>
            <p className="setup-lead">{t('setup', 'welcome_desc')}</p>
            <LanguageSection />
          </>
        )}
        {stepId === 'identity' && (
          <>
            <p className="setup-lead">{t('setup', 'step_identity_desc')}</p>
            <div className="setup-identity">
              <button
                type="button"
                className="setup-avatar"
                onClick={() => setShowAvatarPicker(true)}
                data-testid="setup-avatar"
                title={t('setup', 'avatar_change')}
              >
                <AvatarImage avatarId={avatarId} username={username} size="large" />
                <span className="setup-avatar-flag"><CountryFlag flagName={flagName} /></span>
              </button>
              <div className="setup-identity-fields">
                <Field
                  className="setup-field"
                  label={t('login', 'username')}
                  error={identityError && <span data-testid="setup-username-error">{t('setup', 'username_required')}</span>}
                >
                  <input value={username} onChange={(e) => { setUsername(e.target.value); setIdentityError(false) }} maxLength={14} required aria-invalid={identityError || undefined} data-testid="setup-username" autoComplete="username" />
                </Field>
                <Field
                  className="setup-field"
                  label={t('login', 'password')}
                  hint={passwordDisabledOnBeta && t('login', 'password_disabled_beta')}
                  hintTone="warn"
                >
                  <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" disabled={passwordDisabledOnBeta} data-testid="setup-password" />
                </Field>
                <Field className="setup-field" label={t('login', 'flag')}>
                  <select value={flagName} onChange={(e) => setFlagName(e.target.value)} data-testid="setup-flag">
                    {sortedFlags(lang).map((f) => (
                      <option key={f.code} value={f.code}>{f.emoji} {countryName(f.code, lang)}</option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>
          </>
        )}
        {!locked && stepId === 'server' && (
          <>
            <p className="setup-lead">{t('setup', 'step_server_desc')}</p>
            <div className="setup-presets" role="group" aria-label={t('login', 'server_target')}>
              {(['local', 'official', 'xdhs', 'custom'] as ServerPreset[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`setup-preset ${server.preset === p ? 'selected' : ''}`}
                  aria-pressed={server.preset === p}
                  onClick={() => setServer((s) => applyPreset(p, s))}
                  data-testid={`setup-preset-${p}`}
                >
                  <Icon name={p === 'local' ? 'home' : p === 'official' ? 'globe' : p === 'xdhs' ? 'users' : 'settings'} size={15} />
                  <span>{t('login', p === 'local' ? 'server_local' : p === 'official' ? 'server_official' : p === 'xdhs' ? 'server_xdhs' : 'server_custom')}</span>
                </button>
              ))}
            </div>
            {server.preset === 'custom' && (
              <div className="setup-network">
                <Field className="setup-field" label={t('login', 'proxy')}>
                  <input value={server.proxyHost} onChange={(e) => setServer((s) => ({ ...s, proxyHost: e.target.value }))} data-testid="setup-proxy-host" />
                </Field>
                <div className="setup-network-row">
                  <Field className="setup-field" label={t('login', 'xmage_server')}>
                    <input value={server.serverHost} onChange={(e) => setServer((s) => ({ ...s, serverHost: e.target.value }))} data-testid="setup-server-host" />
                  </Field>
                  <Field className="setup-field setup-field-port" label={t('login', 'port')}>
                    <input value={server.port} onChange={(e) => setServer((s) => ({ ...s, port: e.target.value }))} type="number" data-testid="setup-port" />
                  </Field>
                </div>
              </div>
            )}
          </>
        )}
        {stepId === 'board' && (
          <>
            <p className="setup-lead">{t('setup', 'step_board_desc')}</p>
            <InterfaceSection />
            <BoardSection />
          </>
        )}
        {stepId === 'soundplay' && (
          <>
            <p className="setup-lead">{t('setup', 'step_soundplay_desc')}</p>
            <SoundSection />
            <GameplayQuickSection />
          </>
        )}
        {stepId === 'done' && (
          <>
            <p className="setup-lead">{t('setup', 'done_desc')}</p>
            <ul className="setup-summary">
              <li><strong>{t('login', 'username')}:</strong> {username || '—'}</li>
              <li><strong>{t('login', 'server_target')}</strong> {serverLabel}</li>
            </ul>
          </>
        )}
      </div>
      <div className="setup-footer">
        {!isLast
          ? <Button variant="link" size="sm" onClick={skip} data-testid="setup-skip">{t('setup', 'skip')}</Button>
          : <span />}
        <div className="setup-nav">
          {step > 0 && (
            <Button onClick={() => setStep(step - 1)} data-testid="setup-back">
              {t('lobby', 'wizard_back')}
            </Button>
          )}
          {!isLast && (
            <Button variant="primary" onClick={goNext} data-testid="setup-next">
              {t('lobby', 'wizard_next')}
            </Button>
          )}
          {isLast && (
            <Button variant="primary" onClick={finish} data-testid="setup-enter">
              {t('setup', 'enter')}
            </Button>
          )}
        </div>
      </div>
      {showAvatarPicker && (
        <AvatarPickerModal
          selectedAvatarId={avatarId}
          onSelect={(id) => setAvatarId(id)}
          onClose={() => setShowAvatarPicker(false)}
        />
      )}
    </DialogShell>
  )
}
