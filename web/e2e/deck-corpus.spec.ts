import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'
import { FAKE_MODE } from './dual'
import { withFakeServer } from './support/fake-backend'
import { llmageScenario } from '../fixtures/scenarios/llmageGate'
import { decksGalleryScenario } from '../fixtures/scenarios/decksGallery'
import { gotoLogin } from './support/proxy-config'
import { dismissSetupWizard } from './support/start-game'

/**
 * Bundled built-in deck corpus E2E. The webui ships ~5,013 decks as a lazily
 * loaded asset; they must show up in the Create-Table deck list and in the
 * Decks gallery.
 *
 * Fake-only: the corpus is a client-side same-origin asset served by the vite dev
 * server, so no backend is needed. It arrives after the first paint (the 9 compiled
 * samples show immediately), so both tests poll for the corpus rather than assuming
 * it is there on the first read.
 */

/** A deck that is always first in the generated corpus (mtgtop8 majors). */
const CORPUS_DECK = 'Monastery Miracles'
/** The compiled samples are 9; anything above a hundred means the corpus landed. */
const CORPUS_MIN_OPTIONS = 1000

async function login(page: Page, username: string): Promise<void> {
  await dismissSetupWizard(page)
  await page.getByPlaceholder(/Usuario|Username/i).fill(username)
  await page.getByPlaceholder(/Contraseña|Password/i).fill('pass')
  await page.getByRole('button', { name: /Conectar|Connect/i }).click()
  await expect(page.getByRole('button', { name: /Mesas|Tables/i })).toBeVisible({ timeout: 20_000 })
}

/** Login and open the Create-Table wizard on the Multijugador (seats) step. */
async function openSeatsStep(page: Page, username: string): Promise<void> {
  await gotoLogin(page)
  await login(page, username)
  await page.getByRole('button', { name: /Nueva/i }).first().click()
  await expect(page.getByRole('heading', { name: /Nueva mesa|Crear Mesa/i })).toBeVisible()
  await page.locator('button.wizard-step', { hasText: /Multijugador/i }).click()
  // The seats step now paints a seat map and edits only the picked seat; the
  // "you" node is index 0 (its editor holds the deck carousel).
  await expect(page.getByTestId('seat-node-0')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('.deck-carousel-track').first()).toBeVisible({ timeout: 15_000 })
}

test.describe('bundled deck corpus', () => {
  test.skip(!FAKE_MODE, 'fake-only: the corpus asset is served by the vite dev server')

  test('the Create-Table deck list fills with the ~5,000-deck bundled corpus @decks', async ({ page }) => {
    const errors: Error[] = []
    page.on('pageerror', (e) => errors.push(e))
    await withFakeServer(() => llmageScenario(), async () => {
      await openSeatsStep(page, `corpus-${Date.now().toString().slice(-8)}`)

      // The 9 compiled samples are there right away; the lazily loaded corpus
      // arrives a moment later. The picker is now a carousel of every deck
      // (upstream's create-table redesign — there is no format tier anymore),
      // so the corpus landing is the card count crossing the sample count.
      const track = page.locator('.deck-carousel-track').first()
      await expect
        .poll(() => track.locator('.deck-carousel-card').count(), { timeout: 60_000 })
        .toBeGreaterThan(CORPUS_MIN_OPTIONS)

      const names = await track
        .locator('.deck-carousel-name')
        .evaluateAll((els: HTMLElement[]) => els.map((el) => el.textContent ?? ''))
      expect(names.some((n) => n.includes('Boros Burn'))).toBe(true)
      // The whole bundled corpus is listed (not one format tier): a legacy-only
      // corpus deck is reachable in the same carousel.
      expect(names.some((n) => n.includes(CORPUS_DECK))).toBe(true)

      // Picking a corpus deck is a real selection, not just a rendered card.
      const corpusCard = track.locator('.deck-carousel-card', { hasText: 'Boros Burn' }).first()
      await corpusCard.click()
      await expect(corpusCard).toHaveAttribute('aria-checked', 'true')
      expect(errors).toEqual([])
    })
  })

  test('the Decks gallery lists the corpus and a corpus deck is searchable @decks', async ({ page }) => {
    const errors: Error[] = []
    page.on('pageerror', (e) => errors.push(e))
    await withFakeServer(() => decksGalleryScenario(), async () => {
      await gotoLogin(page)
      await login(page, `corpusgal-${Date.now().toString().slice(-8)}`)
      await page.getByRole('button', { name: /Mis Mazos|Mazos/i }).click()
      await expect(page.locator('.decks-gallery')).toBeVisible({ timeout: 15_000 })

      // The gallery shows a loading indicator until the corpus lands.
      await expect(page.getByTestId('decks-corpus-loading')).toHaveCount(0, { timeout: 30_000 })

      // Narrow to a known corpus deck (rendering all ~5,000 boxes is heavy;
      // the search filter is what a user would use to find one anyway).
      await page.locator('.decks-search').fill(CORPUS_DECK)
      await expect(page.locator('.deck-box-name', { hasText: CORPUS_DECK }).first()).toBeVisible({ timeout: 10_000 })
      expect(errors).toEqual([])
    })
  })
})
