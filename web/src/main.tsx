import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import ErrorBoundary from './ui/ErrorBoundary'
import { preloadInitialLocale } from './i18n'
import { installErrorCapture } from './system/errorLog'
import { loadImageIndex, scheduleBootWarm } from './cards/offlineIndex'
import { ensureBundledDecksLoaded } from './lobby/decks'
import './styles.css'

installErrorCapture()

// The nine locales are separate chunks; only the one this player reads is fetched, and the
// render below starts immediately in English if it has not arrived yet.
preloadInitialLocale()

// Warm the offline Scryfall image index (scryfall-cards + printings + token-arts, ~10.5 MB,
// fetched AND main-thread parsed) and the bundled deck corpus (~5.5 MB) once the browser is
// idle — never on the first-paint critical path. Firing both at boot made every visitor,
// including one who only opened the login screen and left, pay for the full ~16 MB, and the
// parses competed with the locale chunk on first paint. `scheduleBootWarm` defers them behind
// `requestIdleCallback` (with a `setTimeout` fallback) and swallows any rejection, so leaving
// the login screen leaves no pending request behind. Nothing depends on the warm-up having
// completed at boot: the Create-Table deck list and the Decks gallery read the synchronous
// views and fill in when the load lands.
scheduleBootWarm([loadImageIndex, ensureBundledDecksLoaded])

async function start() {
  if (__DEMO__) {
    const { seedDemoSession } = await import('./demo/boot')
    await seedDemoSession()
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
}

void start()
