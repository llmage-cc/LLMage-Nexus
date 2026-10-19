// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import QuickReactions from './QuickReactions'
import * as cmds from '../net/commands'
import { setState } from '../state/state'
import { reset } from '../state/store'
import { setLanguage } from '../i18n'

// Los siete glifos que viajan por el cable, por puntos de código (nunca como
// caracteres literales): el botón los pinta como SVG, pero el chat tiene que
// seguir recibiendo exactamente el mismo emoji que antes.
const WIRE_EMOJI = [
  '\u{1F44D}', // pulgar arriba
  '\u{1F44F}', // manos aplaudiendo
  '\u{23F3}', // reloj de arena
  '\u{2753}', // interrogación
  '\u{2714}\u{FE0F}', // check
  '\u{274C}', // cruz
  '\u{1F389}', // confeti
]

const LABELS = ['Agree', 'Applause', 'Waiting', 'Question', 'Yes', 'No', 'Celebrate']

// Pictograph/emoji ranges. The variation selector (U+FE0F) and the zero-width
// joiner are checked separately: a combining code point inside a character
// class reads as a misleading character class to the linter. If a button paints
// one of these again, the tofu can come back.
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{23E9}-\u{23FA}]/u
const hasEmojiCodePoint = (text: string): boolean =>
  EMOJI.test(text) || text.includes('\uFE0F') || text.includes('\u200D')

function renderRow() {
  const { container } = render(<QuickReactions />)
  return {
    row: container.querySelector('.quick-reactions'),
    buttons: [...container.querySelectorAll<HTMLButtonElement>('.quick-reaction-btn')],
  }
}

const sendSpy = () =>
  vi.spyOn(cmds, 'sendChatMessage').mockResolvedValue({ type: 'result', ok: true, action: 'sendChatMessage' })

describe('QuickReactions', () => {
  beforeEach(() => {
    reset()
    setLanguage('en')
    setState({ roomChatId: 'chat-123' })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('pinta cada reacción con un SVG y sin ningún punto de código emoji', () => {
    const { buttons } = renderRow()
    expect(buttons).toHaveLength(WIRE_EMOJI.length)
    for (const button of buttons) {
      const name = button.getAttribute('aria-label') ?? '?'
      expect(button.querySelector('svg'), `${name} sin SVG`).not.toBeNull()
      expect(hasEmojiCodePoint(button.textContent ?? ''), `texto emoji en ${name}`).toBe(false)
      expect(button.textContent, `texto visible en ${name}`).toBe('')
      expect(hasEmojiCodePoint(button.outerHTML), `emoji en el marcado de ${name}`).toBe(false)
    }
  })

  it('manda el mismo emoji de siempre al pulsar cada botón', () => {
    const send = sendSpy()
    const { buttons } = renderRow()
    for (const [i, button] of buttons.entries()) {
      fireEvent.click(button)
      expect(send, `botón ${i}`).toHaveBeenNthCalledWith(i + 1, 'chat-123', WIRE_EMOJI[i])
    }
  })

  it('nombra cada botón en el idioma activo (aria-label y title)', () => {
    const { row, buttons } = renderRow()
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(LABELS)
    for (const button of buttons) {
      expect(button.getAttribute('title')).toBe(button.getAttribute('aria-label'))
    }
    expect(row?.getAttribute('aria-label')).toBe('Send reaction')
  })

  it('no manda nada cuando todavía no hay sala de chat', () => {
    setState({ roomChatId: null })
    const send = sendSpy()
    const { buttons } = renderRow()
    expect(buttons.every((button) => button.disabled)).toBe(true)
    for (const button of buttons) fireEvent.click(button)
    expect(send).not.toHaveBeenCalled()
  })
})
