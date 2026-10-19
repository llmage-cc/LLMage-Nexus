import { test, expect } from './fixtures'
import { fakeOnly } from './support/fake-mode'
import { TABLE } from '../fixtures/table-names'
import { DECK } from '../fixtures/deck-names'
import { withFakeServer } from './support/fake-backend'
import { startGame } from './support/start-game'
import { cardInspectorScenario } from '../fixtures/scenarios/cardInspector'

// Guard evolution (2026-10-09): the old spec asserted the client-side RATE was
// kept under Scryfall's API limits. The image path no longer talks to
// api.scryfall.com at all — board/token/lobby art resolves from the offline
// index (web/src/cards/offlineIndex.ts) to direct cards.scryfall.io CDN URLs,
// and a map miss renders the placeholder. This spec now guards that contract:
// a rendered board must produce ZERO api.scryfall.com image-resolution
// requests. If someone reintroduces a live lookup, this fails.

fakeOnly()

const svg = (w: number, h: number, fill: string, label: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${fill}"/>` +
  `<text x="50%" y="50%" font-size="${Math.round(h / 8)}" text-anchor="middle" fill="#000">${label}</text></svg>`

/** Requests that would count as live per-card image resolution against the API. */
function isImageResolutionRequest(url: string): boolean {
  if (!url.includes('api.scryfall.com')) return false
  if (url.includes('/cards/named')) return true
  if (url.includes('/cards/search')) {
    // localized-name enrichment searches (`name:/^...$/`) are a different
    // feature; image lookups used the plain / include:extras query shapes.
    return !url.includes('name%3A%2F%5E')
  }
  // /cards/{set}/{num}?format=json (two path segments — a lang segment means
  // the localized-printing feature, not image resolution)
  return /\/cards\/[^/?]+\/[^/?]+\?format=json/.test(url)
}

test.describe('Scryfall image resolution (offline index)', () => {
  test('a rendered board resolves art from the CDN with zero api.scryfall.com image requests @game', async ({ page }) => {
    const apiCalls: string[] = []
    await page.route('**/api.scryfall.com/**', (route) => {
      apiCalls.push(route.request().url())
      return route.fulfill({ status: 418, body: 'api.scryfall.com must not be used for images' })
    })
    await page.route('**/cards.scryfall.io/**', (route) => {
      const url = route.request().url()
      void route.fulfill({
        contentType: 'image/svg+xml',
        body: svg(488, 680, url.includes('art_crop') ? '#ffb347' : '#9ecbff', url.includes('art_crop') ? 'ART' : 'CARD'),
      })
    })

    await withFakeServer(cardInspectorScenario, async () => {
      const { pageErrors } = await startGame(page, {
        prefix: 'imgbudget',
        tableName: TABLE.cardInspector,
        deck: DECK.lands,
      })
      await expect(page.locator('.game-board')).toBeVisible({ timeout: 20_000 })

      const img = page.locator('.player-zone .card-slot[data-card-name="The One Ring"] img.card-image').first()
      await expect(img).toBeVisible()
      const src = await img.getAttribute('src')
      expect(src ?? '', 'the board image resolves to the Scryfall CDN').toContain('cards.scryfall.io')
      expect(src ?? '').toMatch(/\/(normal|small|large|art_crop)\/front\//)

      // let any straggler request land before asserting the budget
      await page.waitForTimeout(300)

      const imageCalls = apiCalls.filter(isImageResolutionRequest)
      expect(imageCalls, `live image lookups leaked: ${imageCalls.join(' | ')}`).toEqual([])
      expect(pageErrors, `pageerrors: ${pageErrors.map(String).join(' | ')}`).toEqual([])
    })
  })
})
