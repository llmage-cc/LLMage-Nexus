import { fakeOnly } from './support/fake-mode'
import { TABLE } from '../fixtures/table-names'
import { DECK } from '../fixtures/deck-names'
import { test, expect } from './fixtures'
import { combatHumanBlockScenario } from '../fixtures/scenarios/combatHuman'
import { withFakeServer } from './support/fake-backend'
import { startGame } from './support/start-game'

fakeOnly()

const zOf = (page: import('@playwright/test').Page, sel: string) =>
  page.locator(sel).first().evaluate((el) => Number(getComputedStyle(el).zIndex))

/** EFFECTIVE stacking order: the z-index of the nearest ancestor (including the
 *  node itself) that forms a stacking context — non-static position with a
 *  numeric z-index — or 0 if none. It is what decides painting inside the root
 *  context the dock and the strip share. Needed because a positioned element
 *  WITHOUT its own z-index computes the keyword "auto" and `Number("auto")` is
 *  NaN: reading the node's literal value gave `NaN <= 30`, always false. The
 *  probe's retarget to `.action-button-container` (the dock stopped being a
 *  stacking island — z auto) swapped a real number (29) for that "auto" and
 *  left the assertion permanently red without the product failing. */
const effZ = (page: import('@playwright/test').Page, sel: string) =>
  page.locator(sel).first().evaluate((el) => {
    let node: Element | null = el
    while (node) {
      const cs = getComputedStyle(node as HTMLElement)
      if (cs.position !== 'static' && cs.zIndex !== 'auto') return Number(cs.zIndex)
      node = node.parentElement
    }
    return 0
  })

test('the game menu (⋯) sits above the dock and the arrows yield while it is open', { tag: '@combat' }, async ({ page }) => {
  await withFakeServer(() => combatHumanBlockScenario(), async () => {
    await startGame(page, {
      prefix: 'gmo',
      tableName: TABLE.combatHumanBlock,
      deck: DECK.combatHuman,
      simDeck: DECK.blockSim,
      skipCombat: true,
    })

    // 1. The control strip (which carries the ⋯ menu and the drawer) paints above
    //    the dock: the action button must not cover its settings popup.
    //    (The dock is no longer a stacking island — z auto —; the prompt
    //    segment IS an island above the strip, so the painting probe is made on
    //    the action button, not on the prompt. Order is measured EFFECTIVE, not
    //    literal: the button computes "auto".
    //    Measured at 1600x900 (default viewport): strip 432..468, button
    //    735..796 — they do not overlap; the assertion pins the stacking order
    //    that decides painting if a short viewport crosses them.)
    const dockZ = await effZ(page, '.game-dock > .action-button-container')
    const stripZ = await effZ(page, '.board-shell-divider.has-strip')
    expect(stripZ, 'the control strip must remain the island (numeric z)').toBeGreaterThan(0)
    expect(dockZ, 'the action button stays below the control strip').toBeLessThanOrEqual(stripZ)

    // 2. Con el cajón de pila abierto las flechas suben sobre el tablero…
    await page.locator('.drawer-toggles button').first().click()
    await expect(page.locator('.game-drawer[data-tab="stack"]')).toBeVisible()
    expect(await zOf(page, '.combat-arrows-overlay')).toBe(45)

    // 3. …pero ceden mientras el menú ⋯ está abierto: el popup es opaco y las
    //    líneas de combate no lo cruzan.
    await page.getByTestId('game-menu-btn').click()
    await expect(page.locator('.game-menu-panel')).toBeVisible()
    expect(await zOf(page, '.combat-arrows-overlay')).toBe(28)

    // 4. La prueba de pintado real: donde el panel solapa el dock, el punto
    //    pertenece al panel (si la geometría los solapa en este viewport).
    const overlapped = await page.evaluate(() => {
      const panel = document.querySelector('.game-menu-panel') as HTMLElement | null
      const pill = document.querySelector('.big-action-btn') as HTMLElement | null
      if (!panel || !pill) return null
      const a = panel.getBoundingClientRect()
      const b = pill.getBoundingClientRect()
      const x = Math.max(a.left, b.left) + 10
      const y = Math.min(a.bottom, b.bottom) - 10
      if (x >= Math.min(a.right, b.right) || y <= Math.max(a.top, b.top)) return null
      const hit = document.elementFromPoint(x, y)
      return hit ? panel.contains(hit) || hit === panel : false
    })
    if (overlapped !== null) expect(overlapped, 'el panel gana el solape con el dock').toBe(true)
  })
})
