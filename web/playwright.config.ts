import { cpus } from 'node:os'
import { defineConfig } from '@playwright/test'

const FAKE_MODE = process.env.E2E_BACKEND !== 'real'

// fake: every FixtureServer starts on a dynamic port (see e2e/fixtures.ts and
// e2e/support/fake-backend.ts), so tests are independent of each other and can
// be spread across workers. real: 1 serial worker (the stack is unique).
const E2E_WORKERS =
  Number(process.env.E2E_WORKERS) || Math.max(1, Math.min(4, cpus().length - 1))

// DEDICATED port for the fake e2e dev server (same lesson as the
// FixtureServer's own port):
// if the user's dev server or the stack's vite occupy 5173, with
// reuseExistingServer Playwright reuses THAT server and the specs run
// against its module graph (stale HMR, old UI), failing intermittently.
// With a dedicated port + strictPort, the e2e always starts from a clean
// server running the current code. Real still uses 5173 (the stack's vite).
// Dedicated port for the e2e round's server. Default is the historical one
// (5175 fake / 5173 real); E2E_PORT diverts it so several e2e rounds can
// run in parallel in different worktrees without colliding on strictPort.
const E2E_PORT = Number(process.env.E2E_PORT) || (FAKE_MODE ? 5175 : 5173)

// Browser × viewport matrix: default Chromium 1600×900 (the daily loop does
// not change). WebKit = Tauri's real engine on macOS.
//   E2E_BROWSER=webkit npm run test:e2e
//   E2E_VIEWPORT=1366x768|1920x1080|2560x1440 npm run test:e2e
const E2E_BROWSER = process.env.E2E_BROWSER === 'webkit' ? 'webkit' : 'chromium'

function parseViewport(): { width: number; height: number } {
  const m = /^\s*(\d+)\s*x\s*(\d+)\s*$/i.exec(process.env.E2E_VIEWPORT ?? '')
  if (m) return { width: Number(m[1]), height: Number(m[2]) }
  return { width: 1600, height: 900 }
}

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  fullyParallel: FAKE_MODE,
  workers: FAKE_MODE ? E2E_WORKERS : 1,
  retries: 0,
  // in fake mode (the default) the e2e does not depend on the stack: vite starts on its own
  webServer: FAKE_MODE
    ? {
        command: `npm run dev -- --port ${E2E_PORT} --strictPort`,
        url: `http://localhost:${E2E_PORT}`,
        reuseExistingServer: false,
        timeout: 60_000,
        // A shell that launches the round can carry NODE_ENV=production (some CI
        // shells export it). A dev server resolved in production mode reports
        // import.meta.env.DEV=false and the dynamic `#/gallery` import collapses
        // (GalleryScreen stays null), so gallery.spec.ts dies in openGallery with
        // "element not found". The fake e2e server is a dev server by definition, so
        // forcing development mode is a no-op when it already was one.
        env: { ...process.env, NODE_ENV: 'development' },
      }
    : undefined,
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    viewport: parseViewport(),
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    // The specs select the UI by Spanish text ('Usuario', 'Conectar',
    // 'Empezar'…): without this navigator.language (en-US) put the i18n in
    // English and the whole suite hung on the login screen.
    locale: 'es-ES',
  },
  reporter: [['list'], ['html', { open: 'never' }]],
  projects: [{ name: E2E_BROWSER, use: { browserName: E2E_BROWSER } }],
})
