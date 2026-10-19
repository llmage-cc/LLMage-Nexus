/**
 * E2E — saved-replay FILE BROWSER.
 *
 * Fake mode (default): drives the real UI against a locally started
 * FixtureServer running `llmageScenario({ replayFiles })`. The fake
 * `connect` result carries `capabilities.llm:true`, which is what unlocks the
 * fork-only "Saved replays" tab/panel (`MatchesSection`/`ReplayFilesPanel`).
 *
 * Covers:
 *   - the panel lists the proxy's saved `.game` files (getReplayFiles) merged
 *     with finished matches (getFinishedMatches);
 *   - a save with no sidecar `meta` still renders and carries the legacy chip;
 *   - the date + byte size of a row render;
 *   - the all/match/file filter and the search box narrow the list;
 *   - a row's Play button issues `replayGame` for that row's gameId;
 *   - a gameId present in BOTH sources dedupes to ONE row (the match row wins);
 *   - `exists:false` (missing replay dir) renders a clear empty state, no errors.
 *
 * Real mode (E2E_BACKEND=real): the scripted-fixture tests skip (they depend on
 * the deterministic FixtureServer script). One real-only branch is kept to
 * assert the panel against the live proxy; it needs the merged proxy started
 * with `--replayDir` (parent runs the real suite at merge time).
 */

import { test, expect } from '@playwright/test'
import { FakeServer } from '../fixtures/fake'
import { llmageScenario, type LlmageScenarioOptions } from '../fixtures/scenarios/llmageGate'
import { makeGameView, makePlayer } from '../src/__fixtures__/gameViews'
import type { GameView } from '../src/net/types'
import type { ReplayFileEntry } from '../../src/net/commands'
import type { MatchView } from '../../src/net/types'
import { FAKE_MODE } from './dual'
import { getFakePort, setFakePort } from './support/fake-port'
import { installCapture, login, type CaptureBuffers } from './support/start-game'
import { parseSent, sentOf } from './support/frames'
import { installProxyConfigStub, DEFAULT_FAKE_PROXY_CONFIG } from './support/proxy-config'

const FAKE_ONLY =
  'fake-only: drives the deterministic FixtureServer scenario (no real proxy/replayDir here).'
const REAL_ONLY =
  'real-only: needs the merged proxy started with --replayDir (parent runs the real suite).'

/** The legacy save id the panel should mark with the legacy chip. */
const LEGACY_ID = 'replay-legacy-0002'

/** Spin up a FixtureServer with the LLMage scenario and point the page at it. */
async function withLlmageServer(
  opts: LlmageScenarioOptions,
  run: (server: FakeServer) => Promise<void>,
): Promise<void> {
  const server = await FakeServer.start(0, () => llmageScenario(opts))
  const previousPort = getFakePort()
  setFakePort(server.port)
  try {
    await run(server)
  } finally {
    try {
      await server.stop()
    } finally {
      setFakePort(previousPort)
    }
  }
}

/** Connect a fresh session and open the History tab's "Saved replays" panel. */
async function openReplayPanel(page: import('@playwright/test').Page, username: string): Promise<CaptureBuffers> {
  const buffers: CaptureBuffers = { frames: [], sent: [], pageErrors: [] }
  installCapture(page, buffers)
  await installProxyConfigStub(page, DEFAULT_FAKE_PROXY_CONFIG)
  await login(page, username)
  await page.getByRole('button', { name: /^Historial$/ }).first().click()
  await page.getByRole('tab', { name: /Repeticiones guardadas/ }).click()
  await expect(page.locator('.replay-files-panel')).toBeVisible({ timeout: 10_000 })
  return buffers
}

test('replay browser: lists saved files, marks the legacy row, renders date/size @replayfiles', async ({ page }) => {
  test.skip(!FAKE_MODE, FAKE_ONLY)
  await withLlmageServer({}, async () => {
    const { pageErrors } = await openReplayPanel(page, 'repl-list')

    const items = page.locator('.replay-files-item')
    await expect(items).toHaveCount(3, { timeout: 10_000 })

    // Every saved game id is visible (a full-sidecar row shows its table name;
    // a legacy row falls back to the id prefix).
    await expect(page.locator('.replay-files-list')).toContainText('Ranked Modern')
    await expect(page.locator('.replay-files-list')).toContainText('Commander Night')

    // The legacy save (no sidecar) still loads and carries the legacy chip.
    const legacyRow = items.filter({ hasText: 'heredada' })
    await expect(legacyRow).toHaveCount(1)
    await expect(legacyRow).toContainText(LEGACY_ID.slice(0, 8))

    // Date + byte size render (bytes are locale-independent).
    const fullRow = items.filter({ hasText: 'Ranked Modern' })
    await expect(fullRow.locator('.replay-date-abs')).toHaveText(/^2023-/)
    await expect(fullRow.locator('.replay-cell-size')).toHaveText('24.0 KB')
    await expect(legacyRow.locator('.replay-cell-size')).toHaveText('8.0 KB')

    expect(pageErrors, `pageerrors: ${pageErrors.map(String).join(' | ')}`).toEqual([])
  })
})

test('replay browser: the all/match/file filter and the search box narrow the list @replayfiles', async ({ page }) => {
  test.skip(!FAKE_MODE, FAKE_ONLY)
  await withLlmageServer({}, async () => {
    const { pageErrors } = await openReplayPanel(page, 'repl-filter')
    const items = page.locator('.replay-files-item')
    const panel = page.locator('.replay-files-panel')
    await expect(items).toHaveCount(3)

    // Source filter: "Matches" has no finished matches in this scenario → 0 rows;
    // "Files" restores the 3 saved files → narrowing proven both ways.
    await panel.getByRole('button', { name: /^Partidas$/ }).click()
    await expect(items).toHaveCount(0)
    await panel.getByRole('button', { name: /^Archivos$/ }).click()
    await expect(items).toHaveCount(3)

    // Back to "Todos ({count})" (3), then the search box.
    await panel.getByRole('button', { name: /^Todos/ }).click()
    await expect(items).toHaveCount(3)

    const search = panel.locator('.replay-files-search-input')
    await search.fill('Bob')
    await expect(items).toHaveCount(1)
    await expect(items.first()).toContainText('Ranked Modern')

    await search.fill('Commander')
    await expect(items).toHaveCount(1)
    await expect(items.first()).toContainText('Commander Night')

    // Clearing the box restores every row.
    await panel.locator('.replay-files-search-clear').click()
    await expect(items).toHaveCount(3)

    expect(pageErrors, `pageerrors: ${pageErrors.map(String).join(' | ')}`).toEqual([])
  })
})

test('replay browser: the Download button fetches the save from the proxy route @replayfiles', async ({ page }) => {
  test.skip(!FAKE_MODE, FAKE_ONLY)
  // The FixtureServer speaks WS only: the HTTP route is the real proxy's job.
  // The download route is intercepted here so the spec can prove the CONTRACT
  // (a dead click — no navigation, no file — is this list's known failure mode):
  // the anchor navigates to /replay-file/<uuid>.game and the BROWSER receives a
  // real attachment. Real mode's byte-level check is the proxy's own unit
  // (ReplayFileDownloadTest).
  const ROUTE_BYTES = 'fake-route-bytes'
  await page.route('**/replay-file/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/octet-stream',
      headers: { 'Content-Disposition': 'attachment; filename="replay-download-e2e.game"' },
      body: ROUTE_BYTES,
    }),
  )
  await withLlmageServer({}, async () => {
    const { pageErrors } = await openReplayPanel(page, 'repl-dl')

    const row = page.locator('.replay-files-item').filter({ hasText: 'Ranked Modern' })
    const link = row.getByTestId(/replay-download-/)
    const expectedName = (await link.getAttribute('download'))!
    expect(expectedName).toMatch(/\.game$/)
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      link.click(),
    ])
    // The anchor's download attribute names the file (<uuid>.game — the same
    // name the real route's Content-Disposition carries for a save).
    expect(download.suggestedFilename()).toBe(expectedName)
    expect(pageErrors, `pageerrors: ${pageErrors.map(String).join(' | ')}`).toEqual([])
  })
})

test('replay browser: a row Play issues replayGame for that gameId @replayfiles', async ({ page }) => {
  test.skip(!FAKE_MODE, FAKE_ONLY)
  await withLlmageServer({}, async () => {
    const { pageErrors } = await openReplayPanel(page, 'repl-play')
    const legacyRow = page.locator('.replay-files-item').filter({ hasText: 'heredada' })
    await expect(legacyRow).toHaveCount(1)

    await legacyRow.getByRole('button', { name: /Ver Repetición/ }).click()

    await expect
      .poll(() => parseSent(sentOf(page)).some((f) => f.action === 'replayGame' && f.args?.gameId === LEGACY_ID), {
        timeout: 10_000,
      })
      .toBe(true)

    // And only the clicked row's gameId went out for replayGame.
    const replayCalls = parseSent(sentOf(page)).filter((f) => f.action === 'replayGame')
    expect(replayCalls.map((f) => f.args?.gameId)).toEqual([LEGACY_ID])

    expect(pageErrors, `pageerrors: ${pageErrors.map(String).join(' | ')}`).toEqual([])
  })
})

test('replay browser: a file whose gameId is also a finished match dedupes to one row @replayfiles', async ({ page }) => {
  test.skip(!FAKE_MODE, FAKE_ONLY)
  // One finished match whose game ALSO exists as a saved file: the match row must win.
  const dedupeMatch: MatchView = {
    tableId: 'dedupe-table',
    matchId: 'dedupe-match',
    matchName: 'Dedupe Match',
    gameType: 'Two Player Duel',
    deckType: 'Constructed - Modern',
    games: ['replay-full-0001'],
    result: 'Alice [2-0], Bob [0-2]',
    players: 'Alice, Bob',
    startTime: Date.UTC(2024, 0, 1, 10, 0),
    endTime: Date.UTC(2024, 0, 1, 10, 30),
    replayAvailable: true,
  }
  const opts: LlmageScenarioOptions = {
    onVerb: (conn, action, _args, requestId) => {
      if (action === 'getFinishedMatches') {
        conn.ok(requestId, action, [dedupeMatch])
        return true
      }
      return false
    },
  }

  await withLlmageServer(opts, async () => {
    const { pageErrors } = await openReplayPanel(page, 'repl-dedupe')
    const items = page.locator('.replay-files-item')

    // 3 rows total: the deduped game appears ONCE (as the match), plus the other
    // two files. Without dedupe it would be 4 (3 files + 1 match).
    await expect(items).toHaveCount(3, { timeout: 10_000 })
    await expect(items.filter({ hasText: 'Dedupe Match' })).toHaveCount(1)
    // The file-only row for that gameId is gone: its table name must not appear.
    await expect(page.locator('.replay-files-list')).not.toContainText('Ranked Modern')

    // "Matches" filter shows just the deduped match row.
    await page.locator('.replay-files-panel').getByRole('button', { name: /^Partidas$/ }).click()
    await expect(items).toHaveCount(1)
    await expect(items.first()).toContainText('Dedupe Match')

    expect(pageErrors, `pageerrors: ${pageErrors.map(String).join(' | ')}`).toEqual([])
  })
})

test('replay browser: exists:false (missing dir) renders a clear empty state, no errors @replayfiles', async ({ page }) => {
  test.skip(!FAKE_MODE, FAKE_ONLY)
  const missing = {
    directory: '/var/lib/xmage/replays-does-not-exist',
    exists: false,
    files: [] as ReplayFileEntry[],
  }
  await withLlmageServer({ replayFiles: missing }, async () => {
    const { pageErrors } = await openReplayPanel(page, 'repl-missing')

    await expect(page.locator('.replay-files-panel')).toBeVisible()
    await expect(page.locator('.replay-files-dir.missing')).toBeVisible()
    await expect(page.locator('.replay-files-panel .ui-empty-title')).toContainText(
      'No se encontró el directorio de repeticiones en el servidor',
    )
    await expect(page.locator('.replay-files-item')).toHaveCount(0)

    expect(pageErrors, `pageerrors: ${pageErrors.map(String).join(' | ')}`).toEqual([])
  })
})

test('replay browser (real): the panel lists the live proxy replay dir @replayfiles', async ({ page }) => {
  test.skip(FAKE_MODE, REAL_ONLY)
  // Runs only against the real stack (E2E_BACKEND=real, proxy 8787 + vite 5173).
  // NOT verified in this unit (fake-only) — the parent runs the real suite once.
  await login(page, `repl-${String(Date.now()).slice(-8)}`)
  await page.getByRole('button', { name: /^Historial$/ }).first().click()
  await page.getByRole('tab', { name: /Repeticiones guardadas/ }).click()
  await expect(page.locator('.replay-files-panel')).toBeVisible({ timeout: 20_000 })
})

/**
 * A replay GameView carries NO `controlled` seat (the proxy watches the replay
 * session), so the board used to fall into the spectator layout and show no
 * "you" side. Drive the viewer the way the app does — REPLAY_GAME opens it and
 * the first REPLAY_INIT frame paints the board — through the app's own exported
 * handler, then assert the bottom seat renders a PLAYER (own side), not just an
 * arbitrary opponent.
 */
test('replay browser: opening a replay shows a player perspective (own side) @replayfiles', async ({ page }) => {
  test.skip(!FAKE_MODE, FAKE_ONLY)
  await withLlmageServer({}, async () => {
    const { pageErrors } = await openReplayPanel(page, 'repl-persp')

    const replayView: GameView = makeGameView({
      players: [
        makePlayer({ playerId: 'p1', name: 'Alice', life: 20 }),
        makePlayer({ playerId: 'p2', name: 'Bob', life: 18 }),
      ],
      activePlayerId: 'p2',
      activePlayerName: 'Bob',
      turn: 3,
    })

    await page.evaluate((view) => {
      const store = (window as unknown as { __mageStore?: { handleMessage: (m: unknown) => void } }).__mageStore
      if (!store) throw new Error('no __mageStore (dev hook missing)')
      // REPLAY_GAME opens the viewer (the proxy then starts the replay)…
      store.handleMessage({ type: 'event', method: 'REPLAY_GAME', messageId: 1, objectId: 'replay-legacy-0002', data: null })
      // …and the first REPLAY_INIT frame paints the board.
      store.handleMessage({
        type: 'event',
        method: 'REPLAY_INIT',
        messageId: 2,
        objectId: 'replay-legacy-0002',
        data: { gameView: view, replayStateIndex: 0, replayStateCount: 5 },
      })
    }, replayView as unknown as Record<string, unknown>)

    // The bottom (own) seat renders a real player name, not the spectator layout.
    // The concrete board (standard/pod/arena) depends on the seat count and the
    // chrome revision; the stable contract is the shell's own zone, which every
    // layout mounts as a direct child.
    const bottom = page.locator('.board-shell > .player-zone').first()
    await expect(bottom).toBeVisible({ timeout: 10_000 })
    await expect(bottom).toHaveAttribute('data-role', 'player')
    await expect(bottom).toHaveAttribute('data-player-name', 'Alice')
    // The other seat is the opponent, so both are on opposite sides.
    await expect(page.locator('.board-shell .opponent-zone').first()).toHaveAttribute('data-player-name', 'Bob')

    expect(pageErrors, `pageerrors: ${pageErrors.map(String).join(' | ')}`).toEqual([])
  })
})
