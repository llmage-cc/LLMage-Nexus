// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { cleanup, render } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import GameDock, { DockPrompt, PromptSlotProvider } from './GameDock'
import { setState } from '../state/store'

/** The real stylesheet texts vite ships (`?raw`/`new URL(…, import.meta.url)`
 *  are rewritten by vite's asset transform under vitest — plain fs paths are
 *  not). `import.meta.url` is a file:// URL here (vitest node runner). */
const hereDir = import.meta.url.slice('file://'.length).replace(/\/[^/]*$/, '')
const gameDockCss = readFileSync(`${hereDir}/GameDock.css`, 'utf8')
const boardShellCss = readFileSync(`${hereDir}/../board/BoardShell.css`, 'utf8')

/**
 * Regression for the mana-pool "Pass anyway?" soft-lock: the yes/no confirm renders inside
 * `.game-dock-prompt` while the control strip — the divider slot that hosts the
 * GameStrip portal (`.board-shell-divider.has-strip`) — paints its right-rail
 * icon toggles across the Yes row; clicks on Yes were swallowed and the turn
 * never advanced until the player discovered the No row or DOM-level access.
 *
 * Fix shape (GameDock.css): the dock stops being its own stacking island
 * (`.game-dock` was z-index: 29; children could never rank past the strip's
 * island at 30) and ONLY its prompt segment becomes one — positioned, z 31:
 * one tier above the strip (30), under modal backdrops (ui/Modal.tsx MODAL_Z_
 * BASE = 500) and under the dock's own popups (pass menu z 150, drawer z 40 —
 * both unaffected by the segment lift since they still win inside the dock).
 *
 * jsdom lays nothing out and applies no stylesheets, so the test injects the
 * REAL stylesheets (same text vite ships), renders the REAL component tree,
 * and asserts the computed z-orders of the segments; getComputedStyle works
 * here because every asserted box is positioned by the same injected CSS.
 */

const STRIP_Z = 30
const MODAL_Z_BASE = 500

function injectCss(cssText: string) {
  const style = document.createElement('style')
  style.textContent = cssText
  document.head.appendChild(style)
  return style
}

function Harness() {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  return (
    <PromptSlotProvider value={slot}>
      <GameDock action={<span data-testid="action" />} onPromptSlot={setSlot} />
      <DockPrompt>
        <div className="action-prompt-bar ask-prompt-bar" data-testid="confirm-bar">
          <div className="feedback-options"><div className="feedback-choice-card">1 Yes</div></div>
        </div>
      </DockPrompt>
    </PromptSlotProvider>
  )
}

describe('GameDock ask-confirm stacking', () => {
  const sheets: HTMLStyleElement[] = []
  afterEach(() => {
    cleanup()
    sheets.splice(0).forEach((el) => el.remove())
  })

  it('ranks the confirm layer above the strip and below modal backdrops', () => {
    sheets.push(injectCss(gameDockCss), injectCss(boardShellCss))

    const { getByTestId } = render(<Harness />)
    const dock = getByTestId('game-dock')
    const promptSlot = getByTestId('confirm-bar').parentElement as HTMLElement
    expect(promptSlot.className).toBe('game-dock-prompt')

    const promptZ = Number(getComputedStyle(promptSlot).zIndex)
    // The dock shell itself must not be a stacking island any more: with an
    // explicit z (the old 29) the confirm could never rank past the strip.
    expect(getComputedStyle(dock).zIndex).toBe('auto')

    // Confirm layer: one tier above the strip ('.board-shell-divider.has-strip'
    // = 30, asserted below from the injected real CSS)…
    expect(promptZ).toBe(STRIP_Z + 1)
    // …and far below modal backdrops (the bar is non-modal).
    expect(promptZ).toBeLessThan(MODAL_Z_BASE)

    // The portal target is untouched: the fix is stacking-only.
    expect(getByTestId('confirm-bar').closest('[data-testid="game-dock"]')).toBe(dock)
  })

  it('keeps the z-ladder contract in the stylesheet text (strip 30 < confirm < modals)', () => {
    expect(gameDockCss).toMatch(/\.game-dock\s*\{[^}]*z-index:\s*auto/)
    expect(gameDockCss).toMatch(/\.game-dock > \.game-dock-prompt\s*\{[^}]*z-index:\s*31/)
    expect(gameDockCss).toMatch(/\.game-dock\[data-prompt-above-modal\] > \.game-dock-prompt\s*\{[^}]*z-index:\s*12001/)
    expect(boardShellCss).toMatch(/\.board-shell-divider\.has-strip\s*\{[^}]*z-index:\s*30/)
  })

  it('lifts the confirm above the card-inspector wall while it is open (leg 2: modal-swallow)', () => {
    sheets.push(injectCss(gameDockCss), injectCss(boardShellCss))
    const card = { id: 'c1', name: 'The One Ring' } as never
    setState({ inspectedCard: card })

    const { getByTestId } = render(<Harness />)
    const promptSlot = getByTestId('confirm-bar').parentElement as HTMLElement
    // data-prompt-above-modal is set → the segment rides over the inspector's
    // z-12000 backdrop (but still under the drawer/popups: nothing changed for
    // interactive modals, which claim the screen on purpose via the same store).
    expect(getByTestId('game-dock').getAttribute('data-prompt-above-modal')).not.toBeNull()
    expect(Number(getComputedStyle(promptSlot).zIndex)).toBe(12001)

    // Cleanup the store before the next test (fixture hygiene).
    setState({ inspectedCard: null })
  })
})