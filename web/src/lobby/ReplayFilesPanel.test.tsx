import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import ReplayFilesPanel from './ReplayFilesPanel'
import * as commands from '../net/commands'
import { getState, setState } from '../state/store'
import { switchLanguage, t } from '../i18n'
import type { MatchView } from '../net/types'
import type { ReplayFileEntry, ReplayFilesResult } from '../net/commands'

vi.mock('../net/commands', () => ({
  getFinishedMatches: vi.fn(),
  getReplayFiles: vi.fn(),
  replayGame: vi.fn(),
}))

const matches: MatchView[] = [
  {
    tableId: 't1',
    matchName: 'Standard Bo3 Match',
    gameType: 'Two Player Duel',
    deckType: 'Constructed - Standard',
    games: ['g1', 'g2'],
    result: 'Alice [2-1], Bob [1-2]',
    players: 'Alice, Bob',
    startTime: Date.UTC(2026, 0, 1, 10, 0),
    endTime: Date.UTC(2026, 0, 1, 11, 0),
    rated: true,
    replayAvailable: true,
  },
]

const fileEntries: ReplayFileEntry[] = [
  // Same game as the match above: must dedupe to ONE row (the match row wins).
  { gameId: 'g1', bytes: 2048, savedAtMs: Date.UTC(2026, 0, 1, 11, 5) },
  {
    gameId: 'g3',
    bytes: 4096,
    savedAtMs: Date.UTC(2026, 0, 2, 9, 30),
    meta: {
      tableName: 'Commander Pod',
      gameType: 'Commander',
      deckType: 'Constructed - Commander',
      winner: 'Bea is the winner',
      players: [
        { name: 'Ari', wins: 0, deck: 'Atraxa' },
        { name: 'Bea', wins: 2, deck: 'Krenko' },
      ],
      endTime: '2026-01-02T09:30:00Z',
    },
  },
  // No sidecar → legacy.
  { gameId: 'g4', bytes: 512, savedAtMs: Date.UTC(2026, 0, 3, 8, 0) },
]

const filesResult: ReplayFilesResult = {
  directory: '/srv/xmage/saved',
  exists: true,
  files: fileEntries,
}

beforeEach(async () => {
  await switchLanguage('es')
  setState({
    error: null,
    capabilities: { llm: true, p1: false, replayScrubber: true, replaySidecar: true, serverVersion: '1.4.62-V1', playerTypes: [] },
  })
  vi.mocked(commands.getFinishedMatches).mockResolvedValue(matches)
  vi.mocked(commands.getReplayFiles).mockResolvedValue(filesResult)
  vi.mocked(commands.replayGame).mockResolvedValue({ ok: true } as never)
})

afterEach(() => cleanup())

describe('ReplayFilesPanel', () => {
  it('lists file rows merged with the finished matches and shows the directory', async () => {
    render(<ReplayFilesPanel />)

    await waitFor(() => {
      expect(screen.getAllByText(/Commander Pod/i).length).toBeGreaterThan(0)
    })

    // Merged + deduped: g1 (match) g2 (match) g3 (file) g4 (file) = 4 rows.
    expect(document.querySelectorAll('.replay-files-item')).toHaveLength(4)
    // The raw server path must NOT leak to a player-facing client; a
    // neutral label is shown instead (es locale in this suite).
    expect(screen.queryByText('/srv/xmage/saved')).toBeNull()
    expect(screen.getAllByText('Repeticiones guardadas').length).toBeGreaterThan(0)
    // File-row metadata.
    expect(screen.getAllByText('Bea is the winner').length).toBeGreaterThan(0)
    expect(screen.getAllByText('4.0 KB').length).toBeGreaterThan(0)
  })

  it('hides the raw server replay path behind the admin build flag', async () => {
    render(<ReplayFilesPanel />)
    await waitFor(() => expect(document.querySelectorAll('.replay-files-item')).toHaveLength(4))

    const dirPath = document.querySelector('.replay-files-dir-path') as HTMLElement
    // Default (player-facing) build: the absolute path never reaches the DOM.
    expect(dirPath.textContent).not.toContain('/srv/xmage/saved')
    expect(dirPath.textContent).toContain('Repeticiones guardadas')
  })

  it('marks a save with no sidecar as legacy', async () => {
    render(<ReplayFilesPanel />)
    await waitFor(() => expect(document.querySelectorAll('.replay-files-item')).toHaveLength(4))

    expect(screen.getAllByText(new RegExp(t('lobby', 'replay_files_legacy'), 'i')).length).toBeGreaterThan(0)
  })

  it('offers a Download button on rows with a save on disk, pointing at the route', async () => {
    render(<ReplayFilesPanel />)
    await waitFor(() => expect(document.querySelectorAll('.replay-files-item')).toHaveLength(4))

    // Both saved files carry an anchor (g1 is deduped into the match row and the
    // match row itself gains the download; g3/g4 are file-sourced rows).
    for (const gid of ['g1', 'g3', 'g4']) {
      const anchor = screen.getByTestId(`replay-download-${gid}`) as HTMLAnchorElement
      expect(anchor.getAttribute('href')).toBe(`${window.location.origin}/replay-file/${gid}.game`)
      expect(anchor.getAttribute('download')).toBe(`${gid}.game`)
    }
    // g2 has no save in this fixture: no anchor.
    expect(screen.queryByTestId('replay-download-g2')).toBeNull()
  })

  it('offers Download on a match row once its save appears in the file list', async () => {
    vi.mocked(commands.getReplayFiles).mockResolvedValue({
      directory: '/srv/xmage/saved',
      exists: true,
      files: [...fileEntries, { gameId: 'g1', bytes: 2048, savedAtMs: Date.UTC(2026, 0, 1, 11, 5) }],
    })
    render(<ReplayFilesPanel />)
    await waitFor(() => expect(document.querySelectorAll('.replay-files-item')).toHaveLength(4))

    // g1 renders ONCE (match row wins the dedupe) and gains the Download anchor.
    expect(document.querySelectorAll('[data-testid="replay-download-g1"]')).toHaveLength(1)
    const anchor = document.querySelector('[data-testid="replay-download-g1"]') as HTMLAnchorElement
    expect(anchor.getAttribute('href')).toBe(`${window.location.origin}/replay-file/g1.game`)
  })

  it('filters the rows by the search query', async () => {
    render(<ReplayFilesPanel />)
    await waitFor(() => expect(document.querySelectorAll('.replay-files-item')).toHaveLength(4))

    fireEvent.change(screen.getByPlaceholderText(/Buscar/i), { target: { value: 'Commander Pod' } })

    await waitFor(() => expect(document.querySelectorAll('.replay-files-item')).toHaveLength(1))
    expect(screen.queryByText('Standard Bo3 Match')).toBeNull()
  })

  it('shows a clear empty state (not an empty table) when the directory is missing', async () => {
    vi.mocked(commands.getReplayFiles).mockResolvedValue({ directory: '/srv/xmage/saved', exists: false, files: [] })
    vi.mocked(commands.getFinishedMatches).mockResolvedValue([])
    render(<ReplayFilesPanel />)

    await waitFor(() => expect(screen.getAllByText(new RegExp(t('lobby', 'replay_files_dir_missing'), 'i')).length).toBeGreaterThan(0))
    expect(document.querySelector('.replay-files-list')).toBeNull()
    expect(document.querySelector('.ui-empty')).toBeTruthy()
  })

  it('surfaces a refusal from replayGame as a store error', async () => {
    vi.mocked(commands.replayGame).mockResolvedValue({ ok: false, error: 'replay not available' } as never)
    render(<ReplayFilesPanel />)

    await waitFor(() => expect(document.querySelectorAll('.replay-files-item')).toHaveLength(4))

    fireEvent.click(screen.getAllByText(new RegExp(t('lobby', 'match_replay_single'), 'i'))[0])

    await waitFor(() => expect(commands.replayGame).toHaveBeenCalled())
    await waitFor(() => expect(getState().error).toBe('replay not available'))
  })

  it('shows a refused load on the clicked row too, not only on the page banner', async () => {
    vi.mocked(commands.replayGame).mockResolvedValue({ ok: false, error: 'ERR_FAILED' } as never)
    render(<ReplayFilesPanel />)

    await waitFor(() => expect(document.querySelectorAll('.replay-files-item')).toHaveLength(4))

    fireEvent.click(screen.getAllByText(new RegExp(t('lobby', 'match_replay_single'), 'i'))[0])

    await waitFor(() => expect(document.querySelectorAll('.replay-row-error')).toHaveLength(1))
    // The banner sits inside the row whose button was clicked — and nowhere else.
    const rows = document.querySelectorAll('.replay-files-item')
    expect(rows[0].querySelector('.replay-row-error')).toBeTruthy()
    expect(rows[1].querySelector('.replay-row-error')).toBeNull()
    // A bare proxy code is not copy: the row shows the replay-load message.
    expect(rows[0].querySelector('.replay-row-error')!.textContent).toContain(t('lobby', 'replay_files_load_failed'))
    expect(getState().error).toBe(t('lobby', 'replay_files_load_failed'))
  })

  it('clears the previous failure when a replay load succeeds', async () => {
    vi.mocked(commands.replayGame).mockResolvedValue({ ok: true } as never)
    setState({ error: 'A replay is loaded — player actions are not available until the replay is stopped' })
    render(<ReplayFilesPanel />)

    await waitFor(() => expect(document.querySelectorAll('.replay-files-item')).toHaveLength(4))
    fireEvent.click(screen.getAllByText(new RegExp(t('lobby', 'match_replay_single'), 'i'))[0])

    await waitFor(() => expect(getState().error).toBeNull())
    expect(document.querySelectorAll('.replay-row-error')).toHaveLength(0)
  })

  it('renders nothing without the llm capability (fork-only persistence)', () => {
    setState({ capabilities: { llm: false, p1: false, replayScrubber: false, replaySidecar: false, serverVersion: '1.4.62-V1', playerTypes: [] } })
    const { container } = render(<ReplayFilesPanel />)
    expect(container.querySelector('.replay-files-panel')).toBeNull()
  })

  it('renders nothing when capabilities are unknown (null)', () => {
    setState({ capabilities: null })
    const { container } = render(<ReplayFilesPanel />)
    expect(container.querySelector('.replay-files-panel')).toBeNull()
  })
})
