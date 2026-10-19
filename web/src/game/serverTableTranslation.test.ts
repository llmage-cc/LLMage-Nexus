import { describe, expect, it } from 'vitest'
import { localizeServerTableInfo } from './serverTableTranslation'
import { de } from '../i18n/locales/de'

function tOf(dict: Record<string, Record<string, string>>) {
  return (ns: string, key: string): string => {
    const val = (dict as unknown as Record<string, Record<string, string>>)[ns]?.[key]
    if (typeof val !== 'string') throw new Error(`missing ${ns}.${key} in test dictionary`)
    return val
  }
}

describe('localizeServerTableInfo', () => {
  it('localizes the match-table strip labels without touching counts', () => {
    const t = tOf({ game: { match_wins: 'Match Wins', score: 'Score:' }, lobby: { tag_spectators: 'Spectators' } })
    expect(localizeServerTableInfo('Wins:1 Score: -3-2, SP', t)).toBe('Match Wins: 1 Score: -3-2')
    expect(localizeServerTableInfo('Custom host note', t)).toBe('Custom host note')
  })

  it('renders the DE server payload fully in German (no "Wins:"/"Score:" leak)', () => {
    const t = tOf({ game: { match_wins: de.game.match_wins, score: de.game.score }, lobby: { tag_spectators: de.lobby.tag_spectators } })
    const out = localizeServerTableInfo('Wins:1 Score: -0-0, SP', t)
    expect(out).toBe('Match-Siege: 1 Punktestand: -0-0')
    expect(out).not.toMatch(/Wins/i)
  })

  it('localizes the full tooltip labels and keeps the rest verbatim', () => {
    const t = tOf({ game: { match_wins: de.game.match_wins, score: de.game.score }, lobby: { tag_spectators: de.lobby.tag_spectators } })
    const out = localizeServerTableInfo(
      'Wins required:1 (Best of 1)<br>Seats: 2<br>Spectators allowed (SP)<br>Game type: Two Player Duel',
      t,
    )
    expect(out).toBe(
      'Match-Siege:1 (Best of 1)<br>Seats: 2<br>Zuschauer<br>Game type: Two Player Duel',
    )
  })

  it('leaves unknown server text verbatim and tolerates null', () => {
    const t = tOf({ game: { match_wins: 'Match Wins', score: 'Score:' }, lobby: { tag_spectators: 'Spectators' } })
    expect(localizeServerTableInfo('Custom host note: 12', t)).toBe('Custom host note: 12')
    expect(localizeServerTableInfo(null, t)).toBe('')
    expect(localizeServerTableInfo('', t)).toBe('')
  })
})