/**
 * State gallery (`#/gallery`, dev only).
 *
 * Siempre: recorre TODAS las entradas y exige que cada una monte sin errores de
 * página (el número lo fija el builder; hoy 160+).
 *
 * Regresión visual (`E2E_VISUAL=1`): compara una selección representativa con
 * `toHaveScreenshot` (animaciones desactivadas, red externa bloqueada para que
 * los placeholders de carta sean deterministas). Los baselines son por
 * plataforma: se generan en local con `E2E_VISUAL=1 npx playwright test
 * gallery.spec.ts --update-snapshots`; en CI quedan opt-in.
 */
import { test, expect, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const HIDE_ARROWS_CSS = fileURLToPath(new URL('./gallery-visual.css', import.meta.url))

const VISUAL = process.env.E2E_VISUAL === '1'

// `E2E_VISUAL_ENTRIES=prompt:trigger-order,...` regenera/verifica solo esas
// entradas (p. ej. tras cambiar un diálogo) sin reescribir toda la matriz.
const VISUAL_ENTRIES_ALL = [
  'frame:mutate',
  'frame:combat',
  'frame:xcosts',
  'frame:block',
  'prompt:target',
  'prompt:mana',
  'prompt:combat-attack',
  'prompt:card-grid',
  'prompt:mulligan',
  'prompt:trigger-order',
  'prompt:voting',
  'screen:login',
  'screen:lobby-empty',
  'screen:lobby-overflow',
  'screen:decks',
  'screen:draft',
  'screen:draft-waiting',
  'screen:construct',
  'screen:construct-overflow',
  'screen:tournament-inprogress',
  'screen:tournament-finished',
  'screen:tournament-loading',
  'screen:tournament-error',
  'screen:tournament-empty',
  'screen:tournament-waiting',
  'screen:tournament-panel',
  'screen:draft-stalled',
  'screen:setup',
  'screen:login-connecting',
  'screen:login-error',
  'screen:lobby-error',
  'screen:wizard',
  'screen:staging-player',
  'screen:staging-pod',
  'screen:staging-spectator',
  'screen:gameend-game',
  'screen:gameend-match',
  'screen:settings',
  'screen:appearance',
  'screen:about',
  'screen:help',
  'board:pod-4',
  'board:arena-4',
  'board:pod-commander',
  'game:hand-15',
  'game:long-names',
  'global:lang-lobby-ru',
  'global:lang-game-ja',
  'global:zoom-lobby-125',
  'global:reconnecting',
]

const VISUAL_ENTRIES = process.env.E2E_VISUAL_ENTRIES
  ? process.env.E2E_VISUAL_ENTRIES.split(',').map((id) => id.trim()).filter(Boolean)
  : VISUAL_ENTRIES_ALL

async function openGallery(page: Page) {
  await page.addInitScript(() => localStorage.clear())
  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort())
  // Movimiento reducido a nivel de página: `test.use({ reducedMotion })` no
  // llega a aplicarse en este setup (verificado: matchMedia da false), y sin
  // esto las flechas conservan trazo discontinuo animado cuya fase no es
  // reproducible entre sesiones (WebKit no la congela ni con
  // `animations:'disabled'`). Con `emulateMedia` el CSS de producto
  // (`@media (prefers-reduced-motion: reduce)`) apaga pulsos/glows y deja los
  // trazos sólidos → capturas deterministas.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/#/gallery')
  // The first navigation under the dev server builds the module graph on demand:
  // measured 6.6 s to `load` and ~12 s to the gallery root on a cold vite, well under
  // the default 5 s once an earlier spec has warmed it. Budget the mount, not the
  // compiler — this is a dev-only surface, so the number should measure "the app
  // mounted", not how much vite still had queued. Reproduced on the untouched base,
  // so it is a pre-existing cold-start fragility, not a product regression.
  await expect(page.locator('[data-gallery]')).toBeVisible({ timeout: 60_000 })
  // Espera a las fuentes antes de montar entradas: las medidas de layout
  // (`useZoneScale`, tarjetas) usan métricas finales y no las de reserva.
  await page.evaluate(() => document.fonts.ready)
}

async function entryIds(page: Page): Promise<string[]> {
  return page
    .locator('[data-gallery-entry]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-gallery-entry') ?? '').filter(Boolean))
}

async function showEntry(page: Page, id: string) {
  const button = page.locator(`[data-gallery-entry="${id}"]`)
  await expect(button, `falta la entrada ${id}`).toHaveCount(1)
  await button.click()
  await expect(page.locator(`[data-gallery-stage="${id}"]`)).toBeAttached({ timeout: 10_000 })
  // Fuentes tras montar la entrada: las pantallas del juego piden tipografías
  // nuevas al aparecer y un swap tardío cambia métricas a mitad de captura.
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(250)
  // `CombatArrowsOverlay` mide rects una vez al montar y solo recalcula si el
  // tablero (o la ventana) cambia de tamaño; el primer cálculo puede caer
  // antes de que asiente el escalado de zonas (useZoneScale), y unas sesiones
  // reciben después un tick del ResizeObserver y otras no → geometría de
  // flechas distinta entre sesiones (hasta 9 px; WebKit lo destapó). Forzar el
  // mismo camino de recálculo que usa la app en un resize deja el estado
  // asentado y reproducible.
  await page.evaluate(() => window.dispatchEvent(new Event('resize')))
  await page.waitForTimeout(150)
}

test.describe('state gallery', () => {
  test('todas las entradas montan sin errores de página', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(String(error)))

    await openGallery(page)
    const ids = await entryIds(page)
    expect(ids.length).toBeGreaterThan(40)
    // El coste crece con la galería (~0,5 s por entrada en local, más del
    // doble en el runner de CI): presupuesto proporcional, no un tope fijo.
    test.setTimeout(Math.max(120_000, ids.length * 2_000))

    for (const id of ids) {
      await showEntry(page, id)
    }

    expect(pageErrors).toEqual([])
  })

  test('el ASK de Slicer sanea {this} con el nombre de la fuente', async ({ page }) => {
    await openGallery(page)
    await showEntry(page, 'prompt:ask-slicer')

    const dialog = page.locator('.ask-prompt-bar')
    await expect(dialog).toBeVisible()
    await expect(dialog).not.toContainText('{this}')
    await expect(dialog.locator('.action-prompt-msg')).toContainText('Slicer, Hired Muscle')
  })

  test('los visores revelados se pintan por encima de la galería', async ({ page }) => {
    await openGallery(page)
    await showEntry(page, 'frame:opponent-reveal')

    const overlay = page.locator('.pile-overlay')
    await expect(overlay).toBeVisible()
    await expect(overlay).toContainText('Aether Vial')
    // `toBeVisible` no detecta oclusión: el portal quedaba bajo la galería
    // (z-index 100 vs 500) y la aserción de visibilidad pasaba igual.
    const topmost = await overlay.evaluate((el) => {
      const rect = el.getBoundingClientRect()
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + 10)
      return hit === el || el.contains(hit)
    })
    expect(topmost).toBe(true)
  })

  test('el wizard de crear mesa no se recorta (el panel cabe en el viewport)', async ({ page }) => {
    await openGallery(page)

    // Regresión de issue #12: con la clase legacy `.overlay` ganándole por orden
    // de import a `.dlg-backdrop`, el `align-items: center` anulaba el
    // `place-items: safe center` y el panel se recortaba sin scroll posible;
    // además `.create-table-body` era un segundo scroller con `max-height: 52vh`.
    // Ahora el panel es el único eje de scroll y el fondo es el respaldo.
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 900, height: 700 },
      { width: 1366, height: 768 },
    ]) {
      await page.setViewportSize(viewport)
      await showEntry(page, 'screen:wizard')

      const metrics = await page.evaluate(() => {
        const panel = document.querySelector('.dlg-panel') as HTMLElement | null
        const backdrop = document.querySelector('.dlg-backdrop') as HTMLElement | null
        const body = document.querySelector('.create-table-body') as HTMLElement | null
        if (!panel || !backdrop || !body) return null
        const rect = panel.getBoundingClientRect()
        const steps = [...document.querySelectorAll('.wizard-step')] as HTMLElement[]
        return {
          top: rect.top,
          bottom: rect.bottom,
          viewportHeight: window.innerHeight,
          backdropAlign: getComputedStyle(backdrop).alignItems,
          bodyOverflowY: getComputedStyle(body).overflowY,
          panelOverflowY: getComputedStyle(panel).overflowY,
          panelScrolls: panel.scrollHeight > panel.clientHeight + 1,
          submitBottom: (() => {
            const btn = document.querySelector('.create-submit-btn') as HTMLElement | null
            if (!btn) return null
            return Math.round(btn.getBoundingClientRect().bottom)
          })(),
          stepperTop: (() => {
            const nav = document.querySelector('[aria-label*="Pasos"], [aria-label*="steps"], [aria-label*="Creation"]') as HTMLElement | null
            return nav ? Math.round(nav.getBoundingClientRect().top) : null
          })(),
          stepWidths: steps.map((s) => Math.round(s.getBoundingClientRect().width)),
        }
      })

      expect(metrics, `the wizard did not mount the panel`).not.toBeNull()
      const m = metrics!
      // The whole panel inside the viewport: the complaint was "I cannot see
      // the whole menu at once".
      expect(m.top).toBeGreaterThanOrEqual(0)
      expect(m.bottom).toBeLessThanOrEqual(m.viewportHeight + 1)
      // The backdrop keeps `safe center` (if `.overlay` comes back, this fails).
      expect(m.backdropAlign).toBe('safe center')
      // The panel is the ONLY scroll axis and the step body is an intrinsically
      // sized item, with no `overflow` of its own: that is the invariant pinned
      // by `DialogShell.overflow.test.ts` (`.create-table-body` has
      // `flex: none` and no `overflow-y`). The earlier assertion required
      // `overflow-y: auto` on the body — the upstream design, which scrolls the
      // step inside the panel — but that inner pane collapsed to ~297 px (36 px
      // at 1280×577) under the panel's height cap and hid every field below
      // the fold; that is why the body stopped being a pane.
      // What the claim requires — that the wizard is not clipped — is checked
      // where it actually happens: the panel scrolls and the content fits.
      expect(m.bodyOverflowY).toBe('visible')
      expect(m.panelOverflowY).toBe('auto')
      expect(m.panelScrolls).toBe(true)
      // Wizard steps of equal width: if a long label widens a step, the
      // connector (positioned in %) falls out of alignment.
      expect(new Set(m.stepWidths).size).toBe(1)
      // The Create Table button stays inside the viewport without moving the panel.
      if (m.submitBottom !== null) {
        expect(m.submitBottom).toBeLessThanOrEqual(m.viewportHeight + 1)
      }
    }
  })

  test('regresión visual de la selección representativa', async ({ page }) => {
    test.skip(!VISUAL, 'E2E_VISUAL=1 requerido (baselines por plataforma)')
    await openGallery(page)
    const viewport = page.viewportSize() ?? { width: 0, height: 0 }

    for (const id of VISUAL_ENTRIES) {
      await showEntry(page, id)
      const name = `${id.replace(/[^a-z0-9]+/gi, '-')}-${viewport.width}x${viewport.height}.png`
      await expect(page.locator('.gallery-stage')).toHaveScreenshot(name, {
        animations: 'disabled',
        caret: 'hide',
        // El rasterizado de los trazos discontinuos y marcadores SVG de las
        // flechas cambia de una sesión a otra (medido 452–3 504 px en
        // `board:arena-4` a 2560, con jitter estable dentro de cada sesión), así
        // que la capa se oculta (no se enmascara: `.combat-arrows-overlay` mide
        // el tablero entero y un `mask` lo dejaba todo magenta). Su geometría la
        // cubren los e2e de combate.
        // 1200 px restantes absorben el AA del resto del stage (~0,05 %) y
        // siguen fallando ante regresiones reales de layout (decenas de miles).
        stylePath: HIDE_ARROWS_CSS,
        maxDiffPixels: 1200,
      })
    }
  })
})

