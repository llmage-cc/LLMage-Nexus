import { lazy, Suspense, useEffect, useState } from 'react'
import { usePhase, useStore, loadConn, doConnect, probeProxyConfig } from './state/store'
import { saveConn } from './state/persistence'
import { isDeploymentLocked } from './setup/deploymentLock'
import { linkBanner } from './system/linkBanner'
import { isGalleryHash } from './dev/galleryRoute'
import { setState } from './state/state'
import { parseDeepLink } from './lobby/deepLink'
import { canAutoConnect } from './lobby/autoConnect'
import { getAuthToken } from './net/authToken'
import { setSetting } from './state/actions'
import { ZOOM_DEFAULT, stepZoom } from './appearance/zoom'
import { useTranslation } from './i18n'
import { soundManager } from './audio/soundManager'
import { loadAudioSettings, loadMusicSettings, loadAppearanceSettings, applyAppearanceToDocument } from './state/persistence'
import LoginScreen from './lobby/LoginScreen'
import LobbyScreen from './lobby/LobbyScreen'
import SpectatorStagingScreen from './lobby/SpectatorStagingScreen'
import DeckIssuesDialog from './lobby/DeckIssuesDialog'
import SetupWizard from './setup/SetupWizard'
import { OPEN_SETUP_EVENT } from './setup/setupFlag'
import { bootPlanFromStorage } from './setup/bootRestore'
import GameScreen from './game/GameScreen'
import GameEndDialog from './game/GameEndDialog'
import EliminatedDialog from './game/EliminatedDialog'
import ConfirmHost from './ui/ConfirmHost'
import DraftScreen from './game/DraftScreen'
import ConstructScreen from './game/ConstructScreen'
import Attribution from './system/Attribution'
import LoginRetryHint from './system/LoginRetryHint'
import DemoTour from './demo/DemoTour'

// State gallery (dev only). The dynamic import sits behind
// `import.meta.env.DEV`, so the production build does not include the frames.
const GalleryScreen = import.meta.env.DEV ? lazy(() => import('./dev/GalleryScreen')) : null

export default function App() {
  const { t, lang } = useTranslation()
  const phase = usePhase()
  const connecting = useStore((s) => s.connecting)
  const wsAlive = useStore((s) => s.wsAlive)
  const link = useStore((s) => s.link)
  const linkAttempt = useStore((s) => s.linkAttempt)
  const loginRetry = useStore((s) => s.loginRetry)
  const settings = useStore((s) => s.settings)
  const deploymentName = useStore((s) => s.proxyConfig.deploymentName)
  const [showSetup, setShowSetup] = useState(() => bootPlanFromStorage().showWizard)
  const [gallery, setGallery] = useState(() => Boolean(GalleryScreen) && isGalleryHash(window.location.hash))

  // Deployment gating: probe the proxy's GET /config once before the
  // login screen. 404/failure → ALL-DEFAULTS, so a stock/old proxy is unchanged.
  useEffect(() => {
    void probeProxyConfig()
  }, [])

  // Branding knob: the base document title is the deployment's name
  // (`XMage Nexus` by default). attentionAlerts keeps prefixing its own
  // `(n) <reason> · <base>` on top of whatever the base is.
  useEffect(() => {
    document.title = deploymentName
  }, [deploymentName])

  useEffect(() => {
    if (!GalleryScreen) return
    const sync = () => setGallery(isGalleryHash(window.location.hash))
    sync()
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  useEffect(() => {
    const open = () => setShowSetup(true)
    window.addEventListener(OPEN_SETUP_EVENT, open)
    return () => window.removeEventListener(OPEN_SETUP_EVENT, open)
  }, [])

  useEffect(() => {
    const captureHash = () => {
      const link = parseDeepLink(window.location.hash)
      if (!link) return
      setState({ pendingDeepLink: link })
      try {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
      } catch {}
    }
    captureHash()
    window.addEventListener('hashchange', captureHash)
    return () => window.removeEventListener('hashchange', captureHash)
  }, [])

  useEffect(() => {
    soundManager.init(loadAudioSettings())
    const music = loadMusicSettings()
    soundManager.setMusicVolume(music.musicEnabled ? music.musicVolume : 0)
    // Reload: re-login with the saved session (logout clears it via reset()). The
    // login result resumes the active game/draft from storage. Whether the wizard has
    // been completed is not part of this decision: see setup/bootRestore.ts.
    if (!bootPlanFromStorage().restore) return
    if (GalleryScreen && isGalleryHash(window.location.hash)) return
    const saved = loadConn()
    if (!saved?.username || phase !== 'idle') return
    void (async () => {
      // The token is persisted per tab (net/authToken.ts). Awaiting the /config
      // probe lets the gate tell a gated deployment whose tab still holds a token
      // (auto-attach, the reload resumes the game) from one without a token (land
      // on the login form's prompt instead of firing a tokenless connect the
      // proxy closes with 4401). The probe is shared with the App-mount call and
      // never throws (it degrades to defaults).
      const config = await probeProxyConfig()
      if (!canAutoConnect(config.authRequired, !!getAuthToken())) return
      // M2: the reload auto-reconnect is the one connect path the deployment
      // lock did not cover — LoginScreen and SetupWizard honor it, but a saved
      // foreign/stale connection would silently bypass it here. On a locked
      // deployment the baked target replaces the saved server host/port BEFORE
      // doConnect, and the saved connection is rewritten so the bypass does not
      // persist into the next reload either.
      let serverHost = saved.serverHost
      let port = saved.port
      if (isDeploymentLocked()) {
        serverHost = (import.meta.env.VITE_DEFAULT_SERVER_HOST as string | undefined) ?? 'localhost'
        port = parseInt(import.meta.env.VITE_DEFAULT_SERVER_PORT ?? '17171', 10) || 17171
        if (serverHost !== saved.serverHost || port !== saved.port) {
          saveConn({ ...saved, serverHost, port })
        }
      }
      void doConnect(saved.wsHost, saved.proxyPort, serverHost, port, saved.username, saved.password, saved.flagName, saved.avatarId)
    })()
  }, [])

  useEffect(() => {
    applyAppearanceToDocument({ sleeveId: settings.sleeveId, boardLayout: settings.boardLayout, uiScale: settings.uiScale, cjkBoost: settings.cjkBoost, transparentDialogs: settings.transparentDialogs }, lang)
  }, [settings.sleeveId, settings.boardLayout, settings.uiScale, settings.cjkBoost, settings.transparentDialogs, lang])

  useEffect(() => {
    applyAppearanceToDocument(loadAppearanceSettings(), lang)
  }, [lang])

  useEffect(() => {
    const onBeforeUnload = () => undefined
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  useEffect(() => {
    const onZoomKeys = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        setSetting('uiScale', stepZoom(settings.uiScale, 1))
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        setSetting('uiScale', stepZoom(settings.uiScale, -1))
      } else if (e.key === '0') {
        e.preventDefault()
        setSetting('uiScale', ZOOM_DEFAULT)
      }
    }
    window.addEventListener('keydown', onZoomKeys)
    return () => window.removeEventListener('keydown', onZoomKeys)
  }, [settings.uiScale])

  const banner = linkBanner({ connecting, wsAlive, link, linkAttempt })

  if (gallery && GalleryScreen) {
    return (
      <Suspense fallback={null}>
        <GalleryScreen />
      </Suspense>
    )
  }

  return (
    <>
      {banner && (
        <div className="reconnect-banner" role="status" data-testid="link-banner" data-link={link}>
          {t('common', banner.key, { n: banner.n })}
        </div>
      )}
      {phase === 'lobby' ? (
        <LobbyScreen />
      ) : phase === 'spectating_pending' ? (
        <SpectatorStagingScreen />
      ) : phase === 'staging' ? (
        <SpectatorStagingScreen mode="player" />
      ) : phase === 'game' ? (
        <GameScreen />
      ) : phase === 'connecting' ? (
        <div className="login-wrap">
          <div className="login-card panel connecting-splash">
            <div className="login-header">
              <img src="/logo.jpeg" alt="XMage Nexus" className="login-logo-img" />
              <p className="subtitle">{t('common', 'connecting_server')}</p>
            </div>
            <div className="connecting-spinner" />
            {loginRetry && <LoginRetryHint attempt={loginRetry.attempt} max={loginRetry.max} until={loginRetry.until} />}
          </div>
        </div>
      ) : (
        <LoginScreen />
      )}
      <DraftScreen />
      <ConstructScreen />
      <GameEndDialog />
      <EliminatedDialog />
      <ConfirmHost />
      <DeckIssuesDialog />
      {__DEMO__ && <DemoTour />}
      {showSetup && <SetupWizard onClose={() => setShowSetup(false)} />}
      {phase !== 'game' && (
        <footer className="app-attribution">
          <Attribution />
        </footer>
      )}
    </>
  )
}
