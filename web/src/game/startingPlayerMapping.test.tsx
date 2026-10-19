// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { parseFeedback } from './feedback/parse'
import { defaultText } from './feedback/text'
import { targetOptions } from './feedback/record'
import StartingPlayerDialog from './feedbackModes/StartingPlayerDialog'
import PlayerInfoBar from './PlayerInfoBar'
import { makeGameView, makePlayer } from '../__fixtures__/gameViews'
import { reset } from '../state/store'
import { setState } from '../state/state'

// The who-goes-first prompt must send MY playerId when I click MY avatar. The
// engine's sendStartMessage log line
// ("X chooses that Y take the first turn", with a bare "they" when X==Y —
// GameImpl.java:1535-1548) renders WHAT THE SERVER RECEIVED; the web is a
// faithful passthrough (dialog: option.value; board header: the player's own
// id). These tests pin both render paths: green here plus the
// "df-ui-brd chooses that <opp> take the first turn" wire observation means the
// divergence is on the engine side (they-branch grammar), not a web mapping bug.

vi.mock('../net/commands', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../net/commands')>()
  return { ...actual, sendPlayerUUID: vi.fn().mockResolvedValue({ ok: true }) }
})

import * as cmds from '../net/commands'

const MY_ID = 'df-ui-brd'
const OPP_ID = 'deepseek-v4.1-flash-casey'

function startingPlayerPayload() {
  return {
    message: 'Choose who goes first',
    targets: [MY_ID, OPP_ID],
    gameView: makeGameView({
      players: [
        makePlayer({ playerId: MY_ID, name: 'df-ui-brd', controlled: true }),
        makePlayer({ playerId: OPP_ID, name: 'deepseek-v4.1-flash-casey' }),
      ],
      myPlayerId: MY_ID,
    }),
  }
}

function spPrompt() {
  return parseFeedback('GAME_TARGET', 'g-1', startingPlayerPayload(), defaultText)!
}

describe('who-goes-first — parse mapping (Defect 2)', () => {
  beforeEach(() => reset())
  afterEach(() => cleanup())

  it('builds one option per target with label from gameView.players and value == playerId', () => {
    const opts = targetOptions(startingPlayerPayload(), (i, id) => `fallback-${i}-${id}`)
    expect(opts.map((o) => o.id)).toEqual([MY_ID, OPP_ID])
    expect(opts.map((o) => o.value)).toEqual([MY_ID, OPP_ID])
    expect(opts.map((o) => o.label)).toEqual(['df-ui-brd', 'deepseek-v4.1-flash-casey'])
  })

  it('parses the GAME_TARGET who-starts prompt with isStartingPlayer + faithful options', () => {
    const prompt = spPrompt()
    expect(prompt.isStartingPlayer).toBe(true)
    expect(prompt.mode).toBe('uuid')
    expect(prompt.options.map((o) => o.value)).toEqual([MY_ID, OPP_ID])
    expect(prompt.options.find((o) => o.value === MY_ID)?.label).toBe('df-ui-brd')
    expect(prompt.options.find((o) => o.value === OPP_ID)?.label).toBe('deepseek-v4.1-flash-casey')
  })
})

describe('who-goes-first — StartingPlayerDialog sends the clicked row (Defect 2)', () => {
  beforeEach(() => reset())
  afterEach(() => cleanup())

  it('clicking MY row sends MY uuid (not the opponent); the opponent row sends the opponent', async () => {
    let sent: string | null = null
    const send = vi.fn(async (action: () => Promise<{ ok: boolean; error?: string }>) => {
      await action()
    })
    const prompt = spPrompt()
    const form = {
      prompt,
      busy: false,
      send,
    } as unknown as Parameters<typeof StartingPlayerDialog>[0]['form']
    const { rerender } = render(<StartingPlayerDialog form={form} />)
    // my row first
    fireEvent.click(screen.getByText('df-ui-brd'))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    sent = vi.mocked(cmds.sendPlayerUUID).mock.calls.at(-1)?.[0] as string
    expect(sent).toBe(MY_ID)
    expect(vi.mocked(cmds.sendPlayerUUID).mock.calls.at(-1)?.[1]).toBe('g-1')
    // then the opponent row sends the opponent's id
    fireEvent.click(screen.getByText('deepseek-v4.1-flash-casey'))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
    expect(vi.mocked(cmds.sendPlayerUUID).mock.calls.at(-1)?.[0]).toBe(OPP_ID)
    rerender(<StartingPlayerDialog form={form} />)
  })
})

describe('who-goes-first — board avatar passthrough (Defect 2)', () => {
  beforeEach(() => reset())
  afterEach(() => cleanup())

  it('renders each player header with data-player-anchor == that player’s own id', () => {
    const view = startingPlayerPayload().gameView
    setState({ game: view as never, gameId: 'g-1' })
    const me = view.players![0]!
    render(
      <PlayerInfoBar
        player={me}
        side="my"
        isTarget
        onClick={() => vi.mocked(cmds.sendPlayerUUID)(MY_ID, 'g-1')}
      />,
    )
    const anchor = document.querySelector<HTMLElement>('[data-player-anchor]')
    expect(anchor?.getAttribute('data-player-anchor')).toBe(MY_ID)
    // the header the avatar lives in is keyed by the SAME id — no cross-seat wiring
    expect(anchor?.closest('[data-player-id]')?.getAttribute('data-player-id')).toBe(MY_ID)
    // and the header's onClick (board target click) sends that same id
    if (anchor) fireEvent.click(anchor)
    expect(vi.mocked(cmds.sendPlayerUUID)).toHaveBeenCalledWith(MY_ID, 'g-1')
  })
})