import { fakeOnly } from './support/fake-mode'
import { TABLE } from '../fixtures/table-names'
import { DECK } from '../fixtures/deck-names'
import { test, expect } from './fixtures'
import { combatHumanBlockScenario } from '../fixtures/scenarios/combatHuman'
import { withFakeServer } from './support/fake-backend'
import { startGame } from './support/start-game'

fakeOnly()

/* Regression guard: on the minimum supported
   viewport (1280x577) the game-menu panel (with its MANA PAYMENT toggles) must
   stay inside the visible viewport, must not grow the document, and any
   clipped content must be reachable through the panel's own scroll.
   DOM/bounding-box assertions only — no pixel/screenshot checks. */
test('the ⋯ menu with its mana-payment section stays inside the viewport', { tag: '@combat' }, async ({ page }) => {
  await withFakeServer(() => combatHumanBlockScenario(), async () => {
    await startGame(page, {
      prefix: 'gmof',
      tableName: TABLE.combatHumanBlock,
      deck: DECK.combatHuman,
      simDeck: DECK.blockSim,
      skipCombat: true,
    })

    await page.getByTestId('game-menu-btn').click()
    const panel = page.locator('.game-menu-panel')
    await expect(panel).toBeVisible()
    await expect(page.getByTestId('game-menu-mana-smart')).toBeAttached()
    await page.waitForTimeout(400)

    const geo = await page.evaluate(() => {
      const p = document.querySelector('.game-menu-panel') as HTMLElement
      const r = p.getBoundingClientRect()
      const rows = [...p.querySelectorAll('.game-menu-check, .game-menu-section-label, .game-menu-divider')].map((el) => {
        const b = el.getBoundingClientRect()
        return { t: (el as HTMLElement).dataset.testid ?? el.className, top: Math.round(b.top), bottom: Math.round(b.bottom) }
      })
      return {
        vw: window.innerWidth,
        vh: window.innerHeight,
        panel: { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) },
        ddMax: getComputedStyle(document.querySelector('.game-strip-right') as Element).getPropertyValue('--dd-max').trim(),
        scrollH: p.scrollHeight,
        clientH: p.clientHeight,
        overflowY: getComputedStyle(p).overflowY,
        docScrollH: document.documentElement.scrollHeight,
        docClientH: document.documentElement.clientHeight,
        rows,
      }
    })

    // 1. The panel box stays inside the visible viewport on every edge.
    expect(geo.panel.top, `panel top within viewport: ${JSON.stringify(geo)}`).toBeGreaterThanOrEqual(0)
    expect(geo.panel.bottom, `panel bottom within viewport: ${JSON.stringify(geo)}`).toBeLessThanOrEqual(geo.vh)
    expect(geo.panel.left, `panel left within viewport: ${JSON.stringify(geo)}`).toBeGreaterThanOrEqual(0)
    expect(geo.panel.right, `panel right within viewport: ${JSON.stringify(geo)}`).toBeLessThanOrEqual(geo.vw)

    // 2. The page itself must not grow: nothing may push the document taller
    //    than the window (menu items rendered "below the viewport").
    expect(geo.docScrollH, `document must not scroll at 577px height: ${JSON.stringify(geo)}`).toBeLessThanOrEqual(geo.docClientH)

    // 3. When content is clipped, it must be reachable via the panel's own
    //    scroll: the last row must fit inside panel-top + full scroll height.
    if (geo.scrollH > geo.clientH) {
      expect(geo.overflowY, `clipped panel must scroll internally: ${JSON.stringify(geo)}`).toMatch(/auto|scroll/)
      const last = geo.rows[geo.rows.length - 1]
      expect(last.bottom, `last row reachable by internal scroll: ${JSON.stringify(geo)}`).toBeLessThanOrEqual(
        geo.panel.top + geo.scrollH,
      )
    }

    // 4. The panel wins the hit-test where it overlaps the board.
    const paints = await panel.evaluate((el) => {
      const r = el.getBoundingClientRect()
      const x = Math.min(Math.max(r.left + 10, 0), window.innerWidth - 1)
      const y = Math.min(Math.max(r.top + 10, 0), window.innerHeight - 1)
      const hit = document.elementFromPoint(x, y)
      return hit ? el.contains(hit) || hit === el : false
    })
    expect(paints, 'panel wins the hit-test where it overlaps').toBe(true)
  })
})