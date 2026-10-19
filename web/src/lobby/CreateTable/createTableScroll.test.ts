// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * This file reads stylesheets off disk and does string checks on them; it needs
 * no DOM. It runs in the `node` environment because the default `jsdom` one
 * makes Vite externalize `node:*` for the browser and the whole suite dies at
 * import ("No such built-in module: node:") — a red suite that reported 0 tests.
 *
 * The create-table wizard's inner pane used to carry
 * `max-height: 52vh + overflow-y: auto`: at 1280×577 it clipped ~1048px of
 * seats + LLM config content to ~300px, wheel events scrolled the OUTER dialog
 * first and the inner pane showed no scrollbar/affordance, so the per-seat LLM
 * CONFIGURATION card (same-shaped trap: the P1 training-deck picker) was
 * unreachable for a normal user.
 *
 * Fix model: the OUTER `.dlg-panel.dlg-lg` (overflow-y auto, stable gutter,
 * max-height 90vh in ui/DialogShell.css) is the wizard's single scroll owner;
 * the inner `.create-table-body` lays out at intrinsic height, so its content
 * flows through the panel's own visible scrollbar (gutter stable + styled
 * native bar = the affordance) and every LLM-config / P1-picker field stays
 * reachable.
 *
 * jsdom has no layout engine (clientHeight/scrollHeight stay 0, no real
 * overflow), so a live scroll assertion is impossible; these tests pin the CSS
 * CONTRACT of that mechanism instead.
 *
 * The file deliberately contains NO backslashes: regex-source checks are built
 * from plain string ops (indexOf + a whitespace-squeezer) so the assertions
 * cannot silently weaken through escape mangling.
 */

const CSS_PATH = join(__dirname, '..', 'CreateTableDialog.css')
const SHELL_CSS_PATH = join(__dirname, '..', '..', 'ui', 'DialogShell.css')

/** Strip every char below code 33 (all whitespace) so checks are layout-proof. */
function squeeze(s: string): string {
  return [...s].filter((c) => c.charCodeAt(0) >= 33).join('')
}

/** Squeezed body of the `{...}` block that follows `selector + ' {'`. */
function ruleBodyFor(selector: string, raw: string): string {
  const at = raw.indexOf(`${selector} {`)
  expect(at, `a ${selector} rule must exist in the source css`).toBeGreaterThanOrEqual(0)
  const open = raw.indexOf('{', at)
  const close = raw.indexOf('}', open)
  return squeeze(raw.slice(open + 1, close))
}

describe('create-table dialog scroll contract (regression)', () => {
  const css = readFileSync(CSS_PATH, 'utf8')
  const shellCss = readFileSync(SHELL_CSS_PATH, 'utf8')

  it('the inner body pane does NOT re-introduce a height cap or overflow (that was the trap)', () => {
    const body = ruleBodyFor('.create-table-body', css).replaceAll('min-height:260px', '')
    expect(body, 'no height cap of any shape (the old 52vh cap was the trap)').not.toContain('height:')
    expect(body, 'no inner overflow: the outer panel is the single scroll owner').not.toContain('overflow')
    expect(body, 'no viewport-relative cap (vh units = the same trap)').not.toContain('vh')
  })

  it('the outer dialog panel is the single scroll owner (DialogShell contract)', () => {
    const panel = ruleBodyFor('.dlg-panel', shellCss)
    expect(panel).toContain('overflow-y:auto')
    expect(panel).toContain('scrollbar-gutter:stable')
  })

  it('`.dlg-lg` keeps a viewport-relative max-height so long tabs flow to the panel scrollbar', () => {
    const lg = ruleBodyFor('.dlg-lg', shellCss)
    const mh = lg.indexOf('max-height:')
    expect(mh, 'the lg panel must keep a max-height').toBeGreaterThanOrEqual(0)
    const value = lg.slice(mh + 'max-height:'.length, lg.indexOf(';', mh))
    expect(value, 'a pixel cap would re-clip the seats tab; cap must stay viewport-relative')
      .not.toContain('px')
    expect(value).toMatch(/(vh|%)/)
  })

  it('the body keeps its display floor and column model (desktop-parity layout)', () => {
    const body = ruleBodyFor('.create-table-body', css)
    expect(body).toContain('display:flex')
    expect(body).toContain('flex-direction:column')
    expect(body).toContain('min-height:260px')
  })

  it('the shared inner-pane affordance mixin ships a visible scrollbar for panes that keep a cap', () => {
    // Sibling surfaces (History list, hand-bar, game menu) must keep
    // an inner cap (sticky rails / fixed lists) — `.scroll-overflow-pane` is the
    // opt-in mixin that gives their overflow a real bar.
    const flat = squeeze(css)
    expect(flat).toContain('.scroll-overflow-pane::-webkit-scrollbar{')
    expect(flat).toContain('.scroll-overflow-pane::-webkit-scrollbar-thumb{')
    expect(flat, 'Firefox fallback: thin bar with a visible thumb color')
      .toContain('scrollbar-width:thin')
    expect(flat).toContain('scrollbar-color:rgb(var(--gold-rgb)')
  })
})

/**
 * The step action row sat below the fold:
 * `.dialog-actions.wizard-actions` was an ordinary flow child at the end of the
 * pane's content. At 1440x900 the Next button measured y 903 / bottom 938 — 48px
 * past the 810px panel and past the 900px viewport — and ~400px below the fold at
 * 1280x577, with no affordance at the point of action saying "scroll for Next".
 *
 * Remedy: the row becomes a sticky footer of the panel scrollport.
 * jsdom has no layout engine, so — exactly as the header above explains — this
 * pins the CSS contract of that mechanism: the row sticks to the bottom of the
 * single scroll owner (`.dlg-panel`, ui/DialogShell.css), carries an opaque fill
 * plus a top hairline, and introduces neither a scroll owner nor a height cap of
 * its own. The geometry itself is measured by web/scripts/verify-create-table-fold.mjs.
 */
describe('create-table wizard action row is a sticky footer of the panel scrollport', () => {
  const css = readFileSync(CSS_PATH, 'utf8')
  const shellCss = readFileSync(SHELL_CSS_PATH, 'utf8')
  const ACTIONS = '.dialog-actions.wizard-actions'

  it('pins the row to the bottom of the scroll owner instead of leaving it in flow', () => {
    const actions = ruleBodyFor(ACTIONS, css)
    expect(actions, 'the row must be sticky, not a static flow child at the content end').toContain('position:sticky')
    expect(actions, 'sticky to the bottom edge of the panel scrollport').toContain('bottom:0')
  })

  it('paints the pinned row on the panel surface behind a separating hairline', () => {
    const actions = ruleBodyFor(ACTIONS, css)
    const bg = actions.indexOf('background:')
    expect(bg, 'the row overlaps scrolled content, so it needs an opaque fill').toBeGreaterThanOrEqual(0)
    const value = actions.slice(bg + 'background:'.length, actions.indexOf(';', bg))
    expect(value, 'a transparent fill would leave the buttons unreadable over scrolled content').not.toContain('transparent')
    expect(actions, 'a top hairline keeps the row from reading as part of the flowing content').toContain('border-top:1pxsolid')
  })

  it('adds no second scroll owner and no height cap (the panel keeps the single one)', () => {
    const actions = ruleBodyFor(ACTIONS, css)
    expect(actions, 'no inner scroller: the panel is the wizard single scroll owner').not.toContain('overflow')
    expect(actions, 'no height cap on the action row').not.toContain('height:')
    const panel = ruleBodyFor('.dlg-panel', shellCss)
    expect(panel).toContain('overflow-y:auto')
    expect(panel).toContain('scrollbar-gutter:stable')
  })
})