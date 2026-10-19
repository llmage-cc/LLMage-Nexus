#!/usr/bin/env node
/**
 * Offline geometry probe for the Create-Table wizard action row: the step action
 * row must not sit below the fold.
 *
 * The action row (`.dialog-actions.wizard-actions`) is a sticky footer of the
 * wizard's single scroll owner (`.dlg-panel`, ui/DialogShell.css). jsdom cannot
 * measure that, and the repo rule is "no dev server, no vite, no app build", so
 * this script builds a static fixture page out of the REAL stylesheets read off
 * disk (ui/tokens.css, styles.css, ui/primitives.css, ui/DialogShell.css,
 * lobby/CreateTableDialog.css) plus a transcription of the real DOM that
 * DialogShell / CreateTableDialog / GeneralTab / SummaryStrip render (same
 * classes, same nesting, same inline styles), opens it in headless Chromium and
 * measures the row at two viewports.
 *
 * It measures the loaded CSS twice:
 *   - as it is on disk (the fix),
 *   - with the `.dialog-actions.wizard-actions` rule removed (the pre-fix
 *     control): that leg must put the row below the fold, otherwise the fixture
 *     is not reproducing the defect and the whole probe passes vacuously.
 *
 * Run (playwright-core is in web/node_modules; on a box without it, point
 * NODE_PATH at a global install):
 *   cd web && node scripts/verify-create-table-fold.mjs
 *   NODE_PATH=$(npm root -g) node scripts/verify-create-table-fold.mjs
 *
 * Exit code 0 = every assertion holds, 1 = at least one failed.
 */
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright-core')

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(WEB, p), 'utf8')

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 577 },
]
const VIEWPORTS_LABEL = '1440x900, 1280x577'

// ── the real stylesheets, in the order the app loads them ────────────────────
// styles.css opens with `@import './ui/tokens.css'`, which cannot resolve inside
// a single file:// page; tokens.css is inlined in its place, byte for byte.
const TOKENS = read('src/ui/tokens.css')
const STYLES = read('src/styles.css').replace("@import './ui/tokens.css';", '')
const CSS = [
  TOKENS,
  STYLES,
  read('src/ui/primitives.css'),
  read('src/ui/DialogShell.css'),
  read('src/lobby/CreateTableDialog.css'),
].join('\n')

/** Drop one flat (brace-free body) rule from a stylesheet, with its comment. */
function withoutRule(cssText, selector) {
  const at = cssText.indexOf(`${selector} {`)
  if (at < 0) throw new Error(`probe fixture: rule ${selector} not found in the stylesheet`)
  const open = cssText.indexOf('{', at)
  const close = cssText.indexOf('}', open)
  const start = cssText.lastIndexOf('}', at) + 1
  return cssText.slice(0, start) + cssText.slice(close + 1)
}

/** Size-faithful icon stand-in: the real Icon() renders an inline SVG with this
 *  inline style and this width/height, which is all that carries layout. */
const icon = (size) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ` +
  `style="display: inline-block; vertical-align: middle; flex-shrink: 0;"><circle cx="12" cy="12" r="9"></circle></svg>`

const chip = (label, cls = 'ui-chip ui-chip--btn ui-chip--neutral ui-chip--pill', iconName = null) =>
  `<button type="button" class="${cls}" aria-pressed="false">${iconName ? icon(12) + ' ' : ''}${label}</button>`

const wizardStep = (n, text, state, last) => `
        <button type="button" class="wizard-step ${state}" ${state === 'active' ? 'aria-current="step"' : ''} title="${text}">
          <span class="wizard-step-circle">${state === 'completed' ? '&#10003;' : n}</span>
          <span class="wizard-step-label"><span class="wizard-step-icon">${icon(13)}</span><span class="wizard-step-text">${text}</span></span>
          ${last ? '' : `<span class="wizard-connector${state === 'completed' ? ' done' : ''}"></span>`}
        </button>`

/** The dialog exactly as DialogShell + CreateTableDialog render it (step 1, "General"). */
const DIALOG = `
  <div class="dlg-backdrop" role="presentation" style="z-index: 501;">
    <section class="dlg-panel dlg-lg dialog create-table-dialog" role="dialog" aria-modal="true" aria-labelledby="create-table-title" data-testid="create-table-dialog">
      <div class="dlg-head">
        <div class="dlg-kicker"><span class="kicker-icon">${icon(13)}</span> Step 1 of 4 &middot; General</div>
        <div class="dlg-head-right">
          <button type="button" class="ui-close ui-close--plain ui-close--md create-dialog-close-btn" aria-label="Close" title="Close">${icon(14)}</button>
        </div>
      </div>
      <h2 id="create-table-title" class="dlg-title">New Table</h2>
      <p class="dlg-message">Pick a mode, a format and the rules, then invite players to your table.</p>
      <div class="wizard-progress-track" aria-hidden="true"><div class="wizard-progress-fill" style="width: 25%;"></div></div>
      <nav class="wizard-stepper" aria-label="Creation steps">${wizardStep(1, 'General', 'active', false)}${wizardStep(2, 'Timers & Rules', '', false)}${wizardStep(3, 'Visibility', '', false)}${wizardStep(4, 'Seats', '', true)}
      </nav>
      <div class="create-table-body">
        <div class="create-tab-content">
          <div class="wizard-step-heading">
            <h3>${icon(15)} General</h3>
            <p>Mode, table name, game type, format and the rules of the table.</p>
          </div>

          <div class="create-mode-selector">
            <button type="button" class="create-mode-card active">
              <div class="create-mode-card-icon">${icon(18)}</div>
              <div class="create-mode-card-content"><div class="create-mode-card-title">Duel</div><div class="create-mode-card-desc">Two players face each other in a single match.</div></div>
            </button>
            <button type="button" class="create-mode-card ">
              <div class="create-mode-card-icon">${icon(18)}</div>
              <div class="create-mode-card-content"><div class="create-mode-card-title">Multiplayer</div><div class="create-mode-card-desc">Up to eight seats at one table, free for all.</div></div>
            </button>
            <button type="button" class="create-mode-card ">
              <div class="create-mode-card-icon">${icon(18)}</div>
              <div class="create-mode-card-content"><div class="create-mode-card-title">Tournament</div><div class="create-mode-card-desc">Rounds and standings for a group of players.</div></div>
            </button>
          </div>

          <div class="create-presets-strip">
            <span class="create-presets-label">${icon(12)} Quick presets:</span>
            <div class="create-presets-buttons">
              ${chip('Modern Bo3')}${chip('Commander 4P')}${chip('Draft MH3 (8P)')}${chip('Modern Swiss (8P)')}
            </div>
          </div>

          <div class="ui-field">
            <div class="ui-field-main"><span class="ui-field-label">Table name</span><input type="text" value="" placeholder="My table"></div>
          </div>

          <div class="create-grid-2col">
            <div class="ui-field">
              <div class="ui-field-main"><span class="ui-field-label">Game type</span><select><option>Two Player Duel (2-2)</option></select></div>
            </div>
            <div class="ui-field">
              <div class="ui-field-main"><span class="ui-field-label">Format</span><select><option>Standard</option></select></div>
            </div>
          </div>

          <div class="ui-field" role="group" aria-labelledby="create-wins-label">
            <span class="ui-field-label" id="create-wins-label">Games needed to win</span>
            <div class="chip-row">${chip('Best of 1')}${chip('Best of 3', 'ui-chip ui-chip--btn ui-chip--brand ui-chip--pill')}${chip('Best of 5')}${chip('Bo7 (4)')}${chip('Bo9 (5)')}</div>
          </div>

          <div class="ui-field" role="group" aria-labelledby="create-skill-label">
            <span class="ui-field-label" id="create-skill-label">Skill level</span>
            <div class="chip-row">${chip('Beginner', 'ui-chip ui-chip--btn ui-chip--neutral ui-chip--pill', 'star')}${chip('Casual', 'ui-chip ui-chip--btn ui-chip--neutral ui-chip--pill', 'star')}${chip('Competitive', 'ui-chip ui-chip--btn ui-chip--neutral ui-chip--pill', 'star')}</div>
          </div>

          <label class="ui-check ui-check--card">
            <input type="checkbox" checked>
            <span class="ui-check-text">
              <span class="ui-check-label">${icon(12)} Rated game</span>
              <span class="ui-check-desc">Results count towards the leaderboard.</span>
            </span>
          </label>
        </div>
      </div>

      <div class="create-table-summary-strip">
        <span class="ui-chip ui-chip--neutral ui-chip--xs">Two Player Duel &middot; 2p</span>
        <span class="ui-chip ui-chip--neutral ui-chip--xs">Standard</span>
        <span class="ui-chip ui-chip--neutral ui-chip--xs">Bo3 (2)</span>
        <span class="ui-chip ui-chip--neutral ui-chip--xs">30 min</span>
        <span class="ui-chip ui-chip--brand ui-chip--xs">${icon(12)} Rated</span>
      </div>

      <div class="dialog-actions wizard-actions">
        <div class="wizard-actions-left">
          <button type="button" class="ui-btn ui-btn--secondary ui-btn--md">Cancel</button>
        </div>
        <div class="wizard-actions-right">
          <button type="button" class="ui-btn ui-btn--primary ui-btn--md">Next</button>
        </div>
      </div>
    </section>
  </div>`

function fixtureHtml(cssText, title) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
${cssText}
</style>
</head>
<body>
<div id="root">${DIALOG}</div>
</body>
</html>
`
}

const MEASURE = () => {
  const panel = document.querySelector('.dlg-panel')
  const row = document.querySelector('.dialog-actions.wizard-actions')
  const next = document.querySelector('.wizard-actions-right button')
  const body = document.querySelector('.create-table-body')
  const rect = (el) => {
    const r = el.getBoundingClientRect()
    return { top: +r.top.toFixed(2), bottom: +r.bottom.toFixed(2), height: +r.height.toFixed(2) }
  }
  const panelStyle = getComputedStyle(panel)
  const bodyStyle = getComputedStyle(body)
  const rowStyle = getComputedStyle(row)
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    panel: {
      ...rect(panel),
      scrollHeight: panel.scrollHeight,
      clientHeight: panel.clientHeight,
      scrollTop: panel.scrollTop,
      overflowY: panelStyle.overflowY,
      paddingTop: panelStyle.paddingTop,
      paddingBottom: panelStyle.paddingBottom,
      borderBottomWidth: panelStyle.borderBottomWidth,
      maxHeight: panelStyle.maxHeight,
    },
    body: {
      ...rect(body),
      scrollHeight: body.scrollHeight,
      clientHeight: body.clientHeight,
      overflowY: bodyStyle.overflowY,
      maxHeight: bodyStyle.maxHeight,
    },
    row: {
      ...rect(row),
      cssPosition: rowStyle.position,
      cssBottom: rowStyle.bottom,
      backgroundColor: rowStyle.backgroundColor,
      borderTopWidth: rowStyle.borderTopWidth,
    },
    next: rect(next),
    // What is painted in the band between the pinned row and the panel's inner
    // bottom edge (the panel's own bottom padding) while the content scrolls.
    bandElement: (() => {
      const pr = panel.getBoundingClientRect()
      const y = row.getBoundingClientRect().bottom + 4
      if (y >= pr.bottom) return null
      const el = document.elementFromPoint(pr.left + pr.width / 2, y)
      return el ? `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 90) : null
    })(),
    pageScrollTop: document.scrollingElement.scrollTop,
    docScrollHeight: document.documentElement.scrollHeight,
  }
}

const failures = []
let checks = 0
function check(label, ok, detail) {
  checks++
  if (!ok) failures.push(`${label} — ${detail}`)
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  [${detail}]` : ''}`)
}

async function measureAt(page, viewport, variant) {
  const inner = await page.evaluate(MEASURE)
  const innerBottom = inner.panel.bottom - parseFloat(inner.panel.borderBottomWidth)
  const overflow = inner.panel.scrollHeight - inner.panel.clientHeight
  const gapUnderButtons = +(innerBottom - inner.next.bottom).toFixed(2)
  console.log(
    `\n[${variant}] ${viewport.width}x${viewport.height} — ` +
      `panel y ${inner.panel.top}..${inner.panel.bottom} (h ${inner.panel.height}, pad-bottom ${inner.panel.paddingBottom}, max-h ${inner.panel.maxHeight}), ` +
      `scroller ${inner.panel.scrollHeight}/${inner.panel.clientHeight} (overflow ${overflow}) overflow-y ${inner.panel.overflowY}`,
  )
  console.log(
    `           row ${inner.row.top}..${inner.row.bottom} (h ${inner.row.height}) css position:${inner.row.cssPosition} bottom:${inner.row.cssBottom} bg ${inner.row.backgroundColor}; ` +
      `Next ${inner.next.top}..${inner.next.bottom}; gap under Next ${gapUnderButtons}; page scrollTop ${inner.pageScrollTop}; ` +
      `painted just under the row: ${inner.bandElement}`,
  )
  return { ...inner, innerBottom, overflow, gapUnderButtons }
}

const browser = await chromium.launch({ args: ['--no-sandbox'] })
try {
  const dir = mkdtempSync(join(tmpdir(), 'create-table-fold-'))
  const fixedPath = join(dir, 'fixed.html')
  const controlPath = join(dir, 'control.html')
  writeFileSync(fixedPath, fixtureHtml(CSS, 'create-table wizard — as on disk'))
  writeFileSync(controlPath, fixtureHtml(withoutRule(CSS, '.dialog-actions.wizard-actions'), 'create-table wizard — action row rule removed'))
  console.log(`fixture written to ${dir}`)

  for (const viewport of VIEWPORTS) {
    // reducedMotion: the shell's dialogIn animation is disabled in that media
    // query, so the panel is measured at its settled geometry.
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce' })

    // ── leg 1: the stylesheets as they are on disk (the fix) ─────────────────
    const page = await context.newPage()
    await page.goto(`file://${fixedPath}`)
    await page.waitForSelector('.dialog-actions.wizard-actions')
    let m = await measureAt(page, viewport, 'fixed, scrollTop 0')

    check('the fixture overflows the panel (the defect scenario, not a vacuous pass)', m.overflow >= 40, `panel overflow ${m.overflow}px`)
    check('the action row is sticky to the scrollport bottom', m.row.cssPosition === 'sticky' && m.row.cssBottom === '0px', `position:${m.row.cssPosition} bottom:${m.row.cssBottom}`)
    check('the action row bottom is inside the viewport at scrollTop 0 (the bug leg)', m.row.bottom <= viewport.height, `row.bottom ${m.row.bottom} vs viewport ${viewport.height}`)
    check('the action row bottom is inside the panel at scrollTop 0', m.row.bottom <= m.panel.bottom + 0.5, `row.bottom ${m.row.bottom} vs panel.bottom ${m.panel.bottom}`)
    check('the Next button bottom is inside the viewport at scrollTop 0', m.next.bottom <= viewport.height, `Next.bottom ${m.next.bottom} vs viewport ${viewport.height}`)
    check('the whole row is below the panel top (not clipped away upward)', m.row.top >= m.panel.top, `row.top ${m.row.top} vs panel.top ${m.panel.top}`)
    check('the pinned row keeps a visible gap to the panel inner bottom edge', m.gapUnderButtons >= 8, `gap ${m.gapUnderButtons}px`)

    await page.evaluate(() => {
      const panel = document.querySelector('.dlg-panel')
      panel.scrollTop = panel.scrollHeight
    })
    m = await measureAt(page, viewport, 'fixed, scrolled to the end')
    check('the panel is the element that scrolled', m.panel.scrollTop > 0, `panel.scrollTop ${m.panel.scrollTop}`)
    check('scrolling the panel did not scroll the page behind it', m.pageScrollTop === 0, `document.scrollingElement.scrollTop ${m.pageScrollTop}`)
    check('the action row is still visible after scrolling to the end', m.row.bottom <= m.panel.bottom + 0.5 && m.row.top >= m.panel.top - 0.5, `row ${m.row.top}..${m.row.bottom} vs panel ${m.panel.top}..${m.panel.bottom}`)
    check('the action row is still inside the viewport after scrolling to the end', m.row.bottom <= viewport.height, `row.bottom ${m.row.bottom} vs viewport ${viewport.height}`)
    check('the Next button is still inside the viewport after scrolling to the end', m.next.bottom <= viewport.height, `Next.bottom ${m.next.bottom} vs viewport ${viewport.height}`)
    check('the inner pane keeps no height cap and no overflow (panel is the single scroll owner)', m.body.maxHeight === 'none' && m.body.overflowY === 'visible' && m.body.scrollHeight === m.body.clientHeight, `max-height ${m.body.maxHeight}, overflow-y ${m.body.overflowY}, body ${m.body.scrollHeight}/${m.body.clientHeight}`)
    check('the panel still carries overflow-y: auto', m.panel.overflowY === 'auto', `overflow-y ${m.panel.overflowY}`)

    await page.evaluate(() => {
      const panel = document.querySelector('.dlg-panel')
      panel.scrollTop = Math.floor((panel.scrollHeight - panel.clientHeight) / 2)
    })
    m = await measureAt(page, viewport, 'fixed, mid scroll')
    check('mid scroll: the action row stays inside the viewport', m.row.bottom <= viewport.height, `row.bottom ${m.row.bottom} vs viewport ${viewport.height}`)
    await page.close()

    // ── leg 2: the same fixture without the sticky rule (the pre-fix control) ─
    const control = await context.newPage()
    await control.goto(`file://${controlPath}`)
    await control.waitForSelector('.dialog-actions.wizard-actions')
    const c = await measureAt(control, viewport, 'control (rule removed), scrollTop 0')
    check('control: the fixture still overflows the panel', c.overflow >= 40, `panel overflow ${c.overflow}px`)
    check('control: the row is static again (the pre-fix shape)', c.row.cssPosition === 'static', `position:${c.row.cssPosition}`)
    check('control: the row sits below the viewport (the defect this fix removes)', c.row.bottom > viewport.height, `row.bottom ${c.row.bottom} vs viewport ${viewport.height}`)
    check('control: the Next button sits below the viewport', c.next.bottom > viewport.height, `Next.bottom ${c.next.bottom} vs viewport ${viewport.height}`)
    await control.close()

    await context.close()
  }
} finally {
  await browser.close()
}

console.log(`\n${checks - failures.length}/${checks} checks passed (viewports ${VIEWPORTS_LABEL})`)
if (failures.length) {
  console.log('\nFAILED:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log('create-table wizard action row: sticky footer holds at every probed viewport')
