import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TableCard from './TableCard'
import { setLanguage } from '../i18n'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function tableOf(over: Record<string, unknown> = {}) {
  return {
    tableId: 't-1',
    tableName: 'Mesa test',
    gameType: 'Two Player Duel',
    deckType: 'Freeform',
    controllerName: '',
    tableState: 'WAITING',
    tableStateText: 'En espera',
    seatsInfo: '0/2',
    seats: [],
    games: [],
    isTournament: false,
    rated: true,
    passworded: false,
    spectatorsAllowed: true,
    createTime: Date.now(),
    skillLevel: 0,
    ...over,
  } as never
}

const handlers = {
  onJoinHuman: () => {},
  onJoinAi: () => {},
  onStart: () => {},
  onWatch: () => {},
  onResume: () => {},
  onOpenBracket: () => {},
  onSelectUser: () => {},
}

describe('TableCard badges (C.13 nit: densos solo-icono)', () => {
  it('el badge rated solo-icono expone nombre accesible con el dato', () => {
    const { container } = render(
      <TableCard tTable={tableOf({ rated: true })} users={[]} stagingTableId={null} busyTable={null} {...handlers} />,
    )
    const badge = container.querySelector('.table-tag-rated') as HTMLElement
    expect(badge).not.toBeNull()
    expect(badge.getAttribute('role')).toBe('img')
    expect(badge.getAttribute('aria-label')).toBeTruthy()
  })

  it('el badge de espectadores expone etiqueta con el dato', () => {
    const { container } = render(
      <TableCard tTable={tableOf({ spectatorsAllowed: true })} users={[]} stagingTableId={null} busyTable={null} {...handlers} />,
    )
    const badge = container.querySelector('.table-tag-spectate') as HTMLElement
    expect(badge).not.toBeNull()
    expect(badge.getAttribute('aria-label')).toBeTruthy()
  })
})

describe('TableCard estado de mesa (i18n)', () => {
  it('traduce WAITING/DUELING/FINISHED en es y en', () => {
    const cases = [
      ['WAITING', 'En espera', 'Waiting'],
      ['DUELING', 'En partida', 'Dueling'],
      ['FINISHED', 'Finalizada', 'Finished'],
    ] as const
    for (const [tableState, esText, enText] of cases) {
      setLanguage('es')
      const esView = render(
        <TableCard tTable={tableOf({ tableState, tableStateText: 'Waiting for players' })} users={[]} stagingTableId={null} busyTable={null} {...handlers} />,
      )
      expect(esView.container.querySelector('.table-state-badge')?.textContent, `${tableState} es`).toBe(esText)
      esView.unmount()
      setLanguage('en')
      const enView = render(
        <TableCard tTable={tableOf({ tableState, tableStateText: 'Waiting for players' })} users={[]} stagingTableId={null} busyTable={null} {...handlers} />,
      )
      expect(enView.container.querySelector('.table-state-badge')?.textContent, `${tableState} en`).toBe(enText)
      enView.unmount()
    }
    setLanguage('es')
  })

  it('usa tableStateText como fallback para estados desconocidos', () => {
    const { container } = render(
      <TableCard tTable={tableOf({ tableState: 'MYSTERY', tableStateText: 'Custom state' })} users={[]} stagingTableId={null} busyTable={null} {...handlers} />,
    )
    expect(container.querySelector('.table-state-badge')?.textContent).toBe('Custom state')
  })
})

describe('TableCard info strip (localized server payload)', () => {
  it('does not show "Wins:"/"Score:"/", SP" in German: it replaces them with the local segments', async () => {
    const { switchLanguage } = await import('../i18n')
    await switchLanguage('de')
    const { container } = render(
      <TableCard
        tTable={tableOf({
          additionalInfoShort: 'Wins:1 Score: -0-0, SP',
          additionalInfoFull: 'Wins required:1 (Best of 1)<br>Seats: 2<br>Spectators allowed (SP)<br>Game type: Two Player Duel',
        })}
        users={[]} stagingTableId={null} busyTable={null} {...handlers}
      />
    )
    const strip = container.querySelector('.table-info-strip') as HTMLElement
    const text = strip.querySelector('.info-strip-text')?.textContent ?? ''
    expect(text).toBe('Match-Siege: 1 Punktestand: -0-0')
    expect(text).not.toMatch(/Wins|Score|SP/)
    expect(strip.getAttribute('title')).toBe(
      'Match-Siege:1 (Best of 1)<br>Seats: 2<br>Zuschauer<br>Game type: Two Player Duel',
    )
    await switchLanguage('es')
  })

  it('deja el texto del servidor desconocido intacto', () => {
    const { container } = render(
      <TableCard tTable={tableOf({ additionalInfoShort: 'Casual EDH fun', additionalInfoFull: '' })} users={[]} stagingTableId={null} busyTable={null} {...handlers} />,
    )
    const text = container.querySelector('.table-info-strip .info-strip-text')?.textContent ?? ''
    expect(text).toBe('Casual EDH fun')
  })
})
