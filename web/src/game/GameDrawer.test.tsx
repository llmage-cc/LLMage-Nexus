import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import GameDrawer, { DrawerToggles, type DrawerTab } from './GameDrawer'
import { setState } from '../state/store'
import { makeGameView, makePlayer } from '../__fixtures__/gameViews'
import { useState } from 'react'

function Harness({ commanders = false, mechanics = false, stackCount = 0 }: { commanders?: boolean; mechanics?: boolean; stackCount?: number }) {
  const [tab, setTab] = useState<DrawerTab | null>(null)
  return (
    <>
      <DrawerToggles
        active={tab}
        stackCount={stackCount}
        onToggle={(next) => setTab((cur) => (cur === next ? null : next))}
        hasCommanders={commanders}
        hasActiveMechanics={mechanics}
      />
      {tab && <GameDrawer tab={tab} stackCount={stackCount} stack={<div data-testid="stack-content" />} onClose={() => setTab(null)} />}
    </>
  )
}

const chat = (id: number, text = 'hola') => ({ id, time: 0, from: 'Bob', text, channel: 'chat' as const })

describe('GameDrawer', () => {
  beforeEach(() => {
    setState({ log: [], game: null })
  })

  afterEach(() => {
    cleanup()
  })

  it('arranca cerrado y alterna al pulsar el mismo botón', () => {
    const { getByTestId, queryByTestId } = render(<Harness />)
    expect(queryByTestId('game-drawer')).toBeNull()
    fireEvent.click(getByTestId('drawer-tab-log'))
    expect(getByTestId('game-drawer').getAttribute('data-tab')).toBe('log')
    expect(getByTestId('drawer-tab-log').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(getByTestId('drawer-tab-log'))
    expect(queryByTestId('game-drawer')).toBeNull()
  })

  it('cambia de pestaña sin cerrar y el botón de cierre lo oculta', () => {
    const { getByTestId, queryByTestId, getByRole } = render(<Harness />)
    fireEvent.click(getByTestId('drawer-tab-log'))
    fireEvent.click(getByTestId('drawer-tab-chat'))
    expect(getByTestId('game-drawer').getAttribute('data-tab')).toBe('chat')
    fireEvent.click(getByRole('button', { name: /close|cerrar/i }))
    expect(queryByTestId('game-drawer')).toBeNull()
  })

  it('el botón de comandante solo existe con comandantes en la partida', () => {
    const without = render(<Harness />)
    expect(without.queryByTestId('drawer-tab-commander')).toBeNull()
    without.unmount()
    const withCommanders = render(<Harness commanders />)
    expect(withCommanders.queryByTestId('drawer-tab-commander')).not.toBeNull()
  })

  it('el icono de la pila muestra el contador y abre su contenido', () => {
    const empty = render(<Harness />)
    expect(empty.queryByTestId('stack-count')).toBeNull()
    empty.unmount()
    const { getByTestId } = render(<Harness stackCount={3} />)
    expect(getByTestId('stack-count').textContent).toBe('3')
    fireEvent.click(getByTestId('drawer-tab-stack'))
    expect(getByTestId('game-drawer').getAttribute('data-tab')).toBe('stack')
    expect(getByTestId('stack-content')).toBeDefined()
    expect(getByTestId('game-drawer').textContent).toContain('(3)')
  })

  it('marca las mecánicas activas con una estrella', () => {
    const { getByTestId } = render(<Harness mechanics />)
    expect(getByTestId('drawer-tab-mechanics').querySelector('.active-mechanics')).not.toBeNull()
  })

  it('cuenta los mensajes de chat no leídos y los limpia al abrir el chat', () => {
    const { getByTestId, queryByTestId } = render(<Harness />)
    expect(queryByTestId('chat-unread')).toBeNull()
    act(() => setState({ log: [chat(1), chat(2)] }))
    expect(getByTestId('chat-unread').textContent).toBe('2')
    fireEvent.click(getByTestId('drawer-tab-chat'))
    expect(queryByTestId('chat-unread')).toBeNull()
    act(() => setState({ log: [chat(1), chat(2), chat(3)] }))
    expect(queryByTestId('chat-unread')).toBeNull()
  })

  it('las líneas del sistema no cuentan como chat no leído', () => {
    const { queryByTestId } = render(<Harness />)
    act(() => setState({ log: [{ id: 1, time: 0, from: 'partida', text: 'Turno 3', channel: 'game' as const }] }))
    expect(queryByTestId('chat-unread')).toBeNull()
  })

  it('la pestaña LLM solo existe con capabilities.llm y jugadores LLM', () => {
    const noLlm = render(<Harness />)
    expect(noLlm.queryByTestId('drawer-tab-llm')).toBeNull()
    noLlm.unmount()

    const caps = { llm: true, p1: false, replayScrubber: true, replaySidecar: true, serverVersion: 'x', playerTypes: [] }
    act(() => setState({ capabilities: caps, game: null, replay: null }))
    const noPlayers = render(<Harness />)
    expect(noPlayers.queryByTestId('drawer-tab-llm')).toBeNull()
    noPlayers.unmount()

    const gv = makeGameView({
      players: [makePlayer({ playerId: 'me', name: 'Me', controlled: true })],
      myPlayerId: 'me',
      llmDebug: [
        { playerName: 'Me', modelName: 'm', exchangeCount: 1, totalContextChars: 0, modelContextWindow: 0, streaming: false, streamingStartedAt: 0, messages: [] },
      ],
    })
    act(() => setState({ capabilities: caps, game: gv, replay: null }))
    const withLlm = render(<Harness />)
    expect(withLlm.getByTestId('drawer-tab-llm')).not.toBeNull()
    act(() => setState({ capabilities: null, game: null }))
  })

  it('el conmutador LLM abre su panel', () => {
    const caps = { llm: true, p1: false, replayScrubber: true, replaySidecar: true, serverVersion: 'x', playerTypes: [] }
    const gv = makeGameView({
      players: [makePlayer({ playerId: 'me', name: 'Me', controlled: true })],
      myPlayerId: 'me',
      llmDebug: [
        { playerName: 'Me', modelName: 'm', exchangeCount: 1, totalContextChars: 0, modelContextWindow: 0, streaming: false, streamingStartedAt: 0, messages: [] },
      ],
    })
    act(() => setState({ capabilities: caps, game: gv, replay: null }))
    const { getByTestId } = render(<Harness />)
    fireEvent.click(getByTestId('drawer-tab-llm'))
    expect(getByTestId('game-drawer').getAttribute('data-tab')).toBe('llm')
  })
})

/* jsdom no tiene motor de maquetación: el contrato del cajón se fija sobre su CSS
   de origen (mismo criterio que CreateTable/createTableScroll.test.ts). */
const drawerCss = readFileSync(join(__dirname, 'GameDrawer.css'), 'utf8')

function squeezedRule(selector: string, css: string): string {
  const at = css.indexOf(`${selector} {`)
  expect(at, `falta la regla ${selector} en el css de origen`).toBeGreaterThanOrEqual(0)
  const open = css.indexOf('{', at)
  const close = css.indexOf('}', open)
  return [...css.slice(open + 1, close)].filter((c) => c.charCodeAt(0) >= 33).join('')
}

describe('GameDrawer — cajón acotado al alto visible y con el borde inferior como clip duro', () => {
  it('el alto sale de la franja pero nunca rebasa el viewport visible', () => {
    const drawer = squeezedRule('.game-drawer', drawerCss)
    expect(drawer).toContain('--dd-cap:min(var(--dd-max,420px),calc(100dvh-var(--sp-4h)))')
    expect(drawer).toContain('height:var(--dd-cap)')
    expect(drawer, 'un hijo no puede pintar fuera del borde inferior, o el clic cae al tablero')
      .toContain('overflow:hidden')
  })

  it('la pestaña de la pila comparte el mismo tope', () => {
    expect(squeezedRule(".game-drawer[data-tab='stack']", drawerCss)).toContain('max-height:var(--dd-cap)')
  })

  it('la zona de contenido no desborda: recorta en el borde del cajón', () => {
    const content = squeezedRule('.game-drawer-content', drawerCss)
    expect(content).toContain('overflow:hidden')
    expect(content).toContain('min-height:0')
  })
})
