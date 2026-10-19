// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const shell = readFileSync(fileURLToPath(new URL('./DialogShell.css', import.meta.url)), 'utf8')
const styles = readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8')
const create = readFileSync(fileURLToPath(new URL('../lobby/CreateTableDialog.css', import.meta.url)), 'utf8')

// Popups (modal dialogs and board overlays). Full-screen flows are NOT popups
// and keep their height: draft, construct, sideboard, deck builder, tournament
// panel and the context menu.
const popups = [
  'styles.css',
  'lobby/JoinTableDialog.css',
  'setup/SetupWizard.css',
  'board/PileOverlay.css',
  'board/CardInspector.css',
]

function rule(css: string, selector: string): string {
  const m = css.match(new RegExp(`(^|[,}\\s])${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`))
  return m ? m[2] : ''
}

describe('dialog height is a share of the screen', () => {
  // The fork caps the viewport share differently from upstream's flat
  // `--dlg-max-h: 70vh`. Our cap is viewport-DERIVED
  // — `min(780px, 90vh, 100dvh - 24px gutter)` — because a fixed vh cap re-traps
  // the create-table wizard's per-seat LLM-config panel on short windows (the
  // panel top goes above the visible area and its own scrollbar becomes
  // unreachable). The invariant that matters survives: every popup
  // is capped by a vh share of the screen, none is left unbounded, and none is
  // hardcoded in px.
  it('caps every dialog by a viewport-height share', () => {
    expect(styles).toContain('--dlg-max-h: min(calc(780px / var(--ui-zoom)), 90vh, calc((100dvh - var(--dlg-viewport-gutter)) / var(--ui-zoom)))')
  })

  it('leaves no popup unbounded (every max-height is viewport-relative, none in px)', () => {
    for (const file of popups) {
      const css = readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), 'utf8')
      for (const m of css.matchAll(/max-height:\s*([^;]+);/g)) {
        expect(m[1], `${file}: ${m[0].trim()} must be viewport-relative`).toMatch(/vh|dvh|%|var\(/)
      }
    }
  })
})

describe('create-table dialog overflow', () => {
  it('caps the large dialog by a viewport-relative height, not a hardcoded px', () => {
    const lg = rule(shell, '.dlg-lg')
    const mh = lg.indexOf('max-height:')
    expect(mh, 'the lg panel must keep a max-height').toBeGreaterThanOrEqual(0)
    expect(lg.slice(mh), 'the cap must stay viewport-relative').toMatch(/vh|dvh/)
  })

  // MERGE NOTE (2026-10-12): upstream scrolls the step BODY inside the panel
  // (`overflow-y: auto; flex: 1 1 auto; min-height: 0`) so the chrome stays put.
  // The fork keeps the OUTER panel as the single scroll owner instead — an inner
  // body cap is what made the per-seat LLM-config panel unreachable. The
  // part of upstream's intent we keep: no hardcoded 52vh cap, and the body is a
  // NON-scrolling intrinsic-height flex item.
  it('keeps the body free of an inner cap (the outer panel is the scroll owner)', () => {
    expect(rule(create, '.create-table-body')).toContain('flex: none')
    expect(rule(create, '.create-table-body')).not.toContain('max-height: 52vh')
    expect(rule(create, '.create-table-body')).not.toContain('overflow-y')
  })

  it('lays the wizard out as a flex column so the chrome stays put', () => {
    expect(rule(create, '.create-table-dialog')).toContain('flex-direction: column')
  })

  it('ellipsizes step labels instead of letting them overflow', () => {
    expect(rule(create, '.wizard-step-text')).toContain('text-overflow: ellipsis')
  })
})