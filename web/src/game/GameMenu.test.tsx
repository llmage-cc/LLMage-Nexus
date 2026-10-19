import { render, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import GameMenu from './GameMenu'
import { reset } from '../state/store'
import { setState } from '../state/state'
import { setLanguage } from '../i18n'
import { makeGameView, makePlayer } from '../__fixtures__/gameViews'

function openMenu(container: HTMLElement) {
  const btn = container.querySelector('[data-testid="game-menu-btn"]')
  expect(btn).not.toBeNull()
  fireEvent.click(btn!)
  return container.querySelector('[data-testid="game-menu"]')
}

describe('GameMenu', () => {
  beforeEach(() => {
    reset()
    setLanguage('es')
  })

  it('renders closed with only the ⋯ button', () => {
    const { container } = render(<GameMenu />)
    expect(container.querySelector('[data-testid="game-menu-btn"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="game-menu"]')).toBeNull()
  })

  it('opens a menu with leave, settings, help and fullscreen (no stops/views/appearance/about)', () => {
    const { container } = render(<GameMenu />)
    const menu = openMenu(container)
    expect(menu).not.toBeNull()
    expect(menu!.querySelector('.leave-match-btn')).not.toBeNull()
    expect(menu!.querySelector('[data-testid="game-menu-settings"]')).not.toBeNull()
    expect(menu!.querySelector('[data-testid="game-menu-help"]')).not.toBeNull()
    expect(menu!.querySelector('[data-testid="game-menu-fullscreen"]')).not.toBeNull()
    expect(menu!.querySelector('[data-testid="game-menu-phase-stops"]')).toBeNull()
    expect(menu!.querySelector('[data-testid="game-menu-layout-standard"]')).toBeNull()
    expect(menu!.querySelector('[data-testid="game-menu-appearance"]')).toBeNull()
    expect(menu!.querySelector('[data-testid="game-menu-about"]')).toBeNull()
  })

  it('shows no concede or rollback without a controlled player', () => {
    const { container } = render(<GameMenu />)
    const menu = openMenu(container)
    expect(menu!.querySelector('.leave-game-btn')).toBeNull()
    expect(menu!.querySelector('.rollback-game-btn')).toBeNull()
  })

  it('shows concede and rollback for a player when rollbacks are allowed', () => {
    setState({
      game: makeGameView({
        rollbackTurnsAllowed: true,
        players: [
          makePlayer({ playerId: 'p1', name: 'Alice', controlled: true }),
          makePlayer({ playerId: 'p2', name: 'Bob' }),
        ],
      }),
    })
    const { container } = render(<GameMenu />)
    const menu = openMenu(container)
    expect(menu!.querySelector('.leave-game-btn')).not.toBeNull()
    expect(menu!.querySelector('.rollback-game-btn')).not.toBeNull()
  })

  it('opens the full settings modal on the gameplay section', () => {
    const { container } = render(<GameMenu />)
    const menu = openMenu(container)
    fireEvent.click(menu!.querySelector('[data-testid="game-menu-settings"]')!)
    expect(container.querySelector('[data-testid="game-menu"]')).toBeNull()
    expect(container.querySelector('[data-testid="settings-modal"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="settings-phase-stops"]')).not.toBeNull()
  })
})

/* jsdom has no layout engine: like GameDrawer.test.tsx, the sizing contract of
   the panel is pinned against its source CSS (createTableScroll precedent). */
const menuCss = readFileSync(join(__dirname, 'GameMenu.css'), 'utf8')

function squeezedRule(selector: string, css: string): string {
  const at = css.indexOf(`${selector} {`)
  expect(at, `missing rule ${selector} in GameMenu.css`).toBeGreaterThanOrEqual(0)
  const open = css.indexOf('{', at)
  const close = css.indexOf('}', open)
  return [...css.slice(open + 1, close)].filter((c) => c.charCodeAt(0) >= 33).join('')
}

describe('GameMenu — panel capped by the visible viewport height', () => {
  it('the max height is min(strip budget, viewport) so a short window can never cut the panel', () => {
    const panel = squeezedRule('.game-menu-panel', menuCss)
    expect(panel).toContain('max-height:min(var(--dd-max,420px),calc(100dvh-var(--sp-4h)))')
    expect(panel, 'clipped content must scroll inside the panel').toContain('overflow-y:auto')
  })
})
