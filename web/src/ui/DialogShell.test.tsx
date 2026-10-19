import { render, fireEvent, cleanup } from '@testing-library/react'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import DialogShell from './DialogShell'

function renderShell(props: { onClose?: () => void; onEscape?: () => void; topRight?: boolean }) {
  const { onClose, onEscape, topRight } = props
  return render(
    <DialogShell
      labelledBy="t"
      titleId="t"
      kickerIcon="settings"
      kickerLabel="Kicker"
      title="Title"
      onClose={onClose}
      onEscape={onEscape}
      topRight={topRight ? <button type="button">Cerrar</button> : undefined}
    >
      <span>body</span>
    </DialogShell>,
  )
}

describe('DialogShell escape', () => {
  afterEach(() => {
    cleanup()
  })

  it('closes with Escape through onClose', () => {
    const onClose = vi.fn()
    renderShell({ onClose })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes with Escape through onEscape when the caller draws its own ✕ (no onClose)', () => {
    const onEscape = vi.fn()
    renderShell({ onEscape, topRight: true })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onEscape).toHaveBeenCalledTimes(1)
  })

  it('does not steal Escape when it has no close path', () => {
    renderShell({})
    const ev = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    window.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(false)
  })
})

/* jsdom has no layout engine, so the scroll contract of the dialog is pinned on the
   source CSS — same approach as CreateTable/createTableScroll.test.ts. */
const shellCss = readFileSync(join(__dirname, 'DialogShell.css'), 'utf8')
const globalCss = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8')

const squeeze = (s: string) => [...s].filter((c) => c.charCodeAt(0) >= 33).join('')

function ruleBody(selector: string, css: string): string {
  const at = css.indexOf(`${selector} {`)
  expect(at, `a ${selector} rule must exist in the source css`).toBeGreaterThanOrEqual(0)
  const open = css.indexOf('{', at)
  const close = css.indexOf('}', open)
  return squeeze(css.slice(open + 1, close))
}

describe('DialogShell — single, viewport-bounded scroll owner', () => {
  it('the panel is a real scroll container whose chain stops at its own edge', () => {
    const panel = ruleBody('.dlg-panel', shellCss)
    expect(panel).toContain('overflow-y:auto')
    expect(panel).toContain('scrollbar-gutter:stable')
    expect(panel, 'a wheel at the end must not scroll the board behind the dialog')
      .toContain('overscroll-behavior:contain')
  })

  it('the lg cap is derived from the visible viewport, not a blind 90vh', () => {
    const lg = ruleBody('.dlg-lg', shellCss)
    const at = lg.indexOf('max-height:')
    const value = lg.slice(at + 'max-height:'.length, lg.indexOf(';', at))
    expect(value, 'a pixel cap would re-clip the wizard tabs').not.toContain('px')
    expect(value).toMatch(/dvh/)
    expect(value).toContain('var(--dlg-viewport-gutter)')
  })

  it('every shared dialog cap is bounded by the visible viewport too', () => {
    expect(squeeze(globalCss))
      .toContain('--dlg-max-h:min(780px,90vh,calc(100dvh-var(--dlg-viewport-gutter)))')
    expect(squeeze(globalCss)).toContain('--dlg-viewport-gutter:24px')
  })
})
