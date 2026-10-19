// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { cleanup, render } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { createPortal } from 'react-dom'
import GameStrip from './GameStrip'
import { BoardDivider, DividerSlotContext } from '../board/BoardShell'

/** The real stylesheet texts vite ships (`?raw`/`new URL(…, import.meta.url)`
 *  are rewritten by vite's asset transform under vitest — plain fs paths are
 *  not). `import.meta.url` is a file:// URL here (vitest node runner). */
const hereDir = import.meta.url.slice('file://'.length).replace(/\/[^/]*$/, '')
const gameStripCss = readFileSync(`${hereDir}/GameStrip.css`, 'utf8')
const boardShellCss = readFileSync(`${hereDir}/../board/BoardShell.css`, 'utf8')
const handBarCss = readFileSync(`${hereDir}/../board/HandBar.css`, 'utf8')

/**
 * Regression for the mulligan bar with ZERO clickable pixels at 1280×577
 * (pixel-scan + wire proof: clicks sent nothing; fine at 800 px where the bar
 * clears the band).
 *
 * Anatomy: the divider slot `.board-shell-divider.has-strip` (BoardShell.css,
 * z-30 stacking island) hosts the GameStrip portal; `.game-strip` fills it
 * with `inset: 0` across the whole band width and no pointer-events reset, so
 * the strip hit-tested as ONE opaque box above the hand-prompt slot
 * (`.hand-bar-prompt`, z 60 — but inside the z-20 `.hand-bar` island, so its
 * z can never out-rank the sibling strip island) and ate the "Keep hand"
 * click living at the bar's upper edge. The dock's prompt island was
 * already clear; the mulligan one could not be lifted the same way because
 * `HandBar.tsx` renders the slot INSIDE the `.hand-bar` island.
 *
 * Fix shape (hit-testing only — paint order untouched): the strip root and
 * the whole divider band go `pointer-events: none`, and ONLY the painted
 * pieces take the pointer again (`auto` on the content-hugging left/right
 * pieces; on the stretching center piece only on its rendered widgets, so an
 * empty middle stays click-transparent).
 *
 * jsdom lays nothing out and applies no stylesheets, so the test injects the
 * REAL stylesheets (same text vite ships), renders the REAL component tree,
 * and asserts the computed pointer-events/z-orders of the boxes involved;
 * getComputedStyle works here because every asserted box is positioned by
 * the same injected CSS.
 */

const STRIP_Z = 30

function injectCss(cssText: string) {
  const style = document.createElement('style')
  style.textContent = cssText
  document.head.appendChild(style)
  return style
}

function Harness() {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  return (
    <DividerSlotContext.Provider value={setSlot}>
      <div className="board-shell">
        <BoardDivider />
      </div>
      {slot &&
        createPortal(
          <GameStrip
            left={<button type="button" data-testid="left-btn" />}
            center={
              <button type="button" data-testid="center-pill" />
            }
            right={
              <button type="button" data-testid="right-btn" />
            }
            dropdown={<span data-testid="dropdown" />}
          />,
          slot,
        )}
    </DividerSlotContext.Provider>
  )
}

function PromptedHarness() {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  return (
    <DividerSlotContext.Provider value={setSlot}>
      <div className="board-shell" data-testid="stack-box">
        <BoardDivider />
      </div>
      {slot &&
        createPortal(
          <GameStrip left={null} center={null} right={null} dropdown={null} />,
          slot,
        )}
      <div className="board-wrap">
        <div className="hand-bar">
          <div className="hand-bar-prompt" data-testid="prompt-box">
            <div className="mulligan-bar" data-testid="mulligan-keep">Keep hand</div>
          </div>
        </div>
      </div>
    </DividerSlotContext.Provider>
  )
}

describe('GameStrip stacking: the divider band must not eat prompt-bar clicks', () => {
  const sheets: HTMLStyleElement[] = []
  afterEach(() => {
    cleanup()
    sheets.splice(0).forEach((el) => el.remove())
  })

  it('hits the strip transparent: only the painted pieces are pointer-events auto', () => {
    sheets.push(injectCss(gameStripCss), injectCss(boardShellCss))

    const { getByTestId } = render(<Harness />)
    const divider = getByTestId('game-strip').parentElement as HTMLElement
    expect(divider.className).toContain('has-strip')

    // The island and its full-width strip content must never intercept:
    // prompt bars paint BENEATH this band.
    expect(getComputedStyle(divider).pointerEvents).toBe('none')
    expect(getComputedStyle(getByTestId('game-strip')).pointerEvents).toBe('none')

    // Painted pieces stay live: their whole content-hugging box is the click
    // target inside the dead band.
    const left = getByTestId('left-btn').parentElement as HTMLElement
    const right = getByTestId('right-btn').parentElement as HTMLElement
    expect(left.className).toBe('game-strip-left')
    expect(right.className).toBe('game-strip-right')
    expect(getComputedStyle(left).pointerEvents).toBe('auto')
    expect(getComputedStyle(right).pointerEvents).toBe('auto')
    expect(getComputedStyle(getByTestId('left-btn')).pointerEvents).toBe('auto')
    expect(getComputedStyle(getByTestId('right-btn')).pointerEvents).toBe('auto')

    // The center piece stretches across the whole middle (flex: 1): only its
    // rendered widgets may take the pointer, never its box.
    const centerPiece = getByTestId('center-pill').parentElement as HTMLElement
    expect(centerPiece.className).toBe('game-strip-center')
    expect(getComputedStyle(centerPiece).pointerEvents).toBe('none')
    expect(getComputedStyle(getByTestId('center-pill')).pointerEvents).toBe('auto')
  })

  it('ranks the mulligan prompt slot under the strip island (the shape that forces the fix)', () => {
    sheets.push(injectCss(gameStripCss), injectCss(boardShellCss), injectCss(handBarCss))

    const { getByTestId } = render(<PromptedHarness />)
    const strip = getByTestId('game-strip')
    const divider = strip.parentElement as HTMLElement
    const slot = getByTestId('prompt-box')

    // Real DOM shapes: the strip lives in the divider island off .board-shell;
    // the mulligan prompt slot lives inside the .hand-bar island.
    expect(divider.className).toContain('has-strip')
    expect(document.body.contains(slot)).toBe(true)
    expect(slot.className).toBe('hand-bar-prompt')

    // The slot's z 60 is trapped inside the hand bar's z-20 island: however
    // big a z it carries, the island never out-ranks the strip's z-30 island
    // (20 < 30 — the exact reason the band ate the "Keep hand" click before
    // the fix, and why the fix must make the BAND hit-transparent instead of
    // lifting the slot).
    const hand = slot.parentElement as HTMLElement
    expect(hand.className).toContain('hand-bar')
    expect(getComputedStyle(slot).zIndex).toBe('60')
    expect(getComputedStyle(divider).zIndex).toBe(String(STRIP_Z))
    expect(getComputedStyle(hand).zIndex).toBe('20')
    expect(Number(getComputedStyle(hand).zIndex)).toBeLessThan(STRIP_Z)
  })

  it('keeps the hit-test contract in the stylesheet text (band none, pieces auto)', () => {
    expect(gameStripCss).toMatch(/\.game-strip\s*\{[^}]*pointer-events:\s*none/)
    expect(gameStripCss).toMatch(/\.game-strip-left,\s*\.game-strip-right\s*\{[^}]*pointer-events:\s*auto/)
    expect(boardShellCss).toMatch(/\.board-shell-divider\.has-strip\s*\{[^}]*pointer-events:\s*none/)
    expect(boardShellCss).toMatch(/\.board-shell-divider\.has-strip\s*\{[^}]*z-index:\s*30/)
    // The prompt slot shape that made lift-the-slot impossible stays pinned:
    // a z 60 slot INSIDE the z 20 hand bar island (a dock-style lift would
    // need a portal out of HandBar.tsx first).
    expect(handBarCss).toMatch(/\.hand-bar\s*\{[^}]*z-index:\s*20/)
    expect(handBarCss).toMatch(/\.hand-bar-prompt\s*\{[^}]*z-index:\s*60/)
  })
})