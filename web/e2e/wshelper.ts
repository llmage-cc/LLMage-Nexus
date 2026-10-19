// Human helper for the E2E specs: a direct WS connection to the proxy (the same
// server session as the page). It plays development lands (one per turn),
// answers discards and asks, and passes priority with a timed fallback — WITHOUT
// touching the spell/mana dialogs (the test exercises those through the UI).
// It removes the canvas races and the land-development hangs: the match
// advances on its own and the test acts only when the action under test comes up.

import type { Page } from '@playwright/test'
import { FAKE_MODE } from './dual'
import { getFakePort } from './support/fake-port'

const HOST = FAKE_MODE ? 'localhost' : process.env.E2E_SERVER_HOST || 'beta.xmage.today'
const PORT = Number(process.env.E2E_SERVER_PORT || '17171')

const BASIC_LANDS = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes']

/** localStorage key where the page persists its per-browser uuid
 *  (web/src/net/browserId.ts STORAGE_KEY). */
export const BROWSER_ID_STORAGE_KEY = 'mage-web-browser-id'

/** Rebuilds the exact connect-time browserId `web:<username>:<uuid>` the page
 *  sends, from the uuid the page persisted (web/src/net/browserId.ts:getBrowserId).
 *  '' when the page has no id yet — the helper then connects without one, it never
 *  invents an identity. */
export function composeBrowserId(username: string, storedId: string | null | undefined): string {
  return storedId ? `web:${username}:${storedId}` : ''
}

/** Reads the page's persisted browser uuid (the SAME key the page's own connect
 *  uses) and returns the identical `web:<username>:<uuid>`. Without it the proxy's
 *  anon guard sees the helper as a DIFFERENT browser and refuses the attach to the
 *  page's live session (typed connect_error + close 4401). */
export async function readPageBrowserId(page: Page, username: string): Promise<string> {
  try {
    const stored = await page.evaluate((key: string) => window.localStorage.getItem(key), BROWSER_ID_STORAGE_KEY)
    return composeBrowserId(username, stored)
  } catch {
    return ''
  }
}

/** Args of a proxy `connect` frame. Pure so its shape (browserId included) is
 *  unit-testable without a browser or a socket. */
export function connectArgs(
  host: string,
  port: number,
  username: string,
  password: string,
  browserId: string,
): Record<string, unknown> {
  return { host, port, username, password, browserId }
}

interface HandCard {
  name?: string
  displayName?: string
}

interface GameViewLike {
  turn?: number
  phase?: string
  step?: string
  players?: Array<{ playerId?: string; controlled?: boolean; hasPriority?: boolean; isActive?: boolean }>
  myHand?: Record<string, HandCard>
  stack?: Record<string, unknown>
}

interface EventDataLike {
  gameView?: GameViewLike
  message?: string
  question?: string
  targets?: string[] | Record<string, unknown>
  cardsView1?: Record<string, unknown>
  options?: {
    possibleAttackers?: unknown[]
    possibleBlockers?: unknown[]
    /** ids already chosen (the server's AUTHORITATIVE state on every re-ask) */
    chosenTargets?: unknown
    /** legal ids for the choice (the target's real filter) */
    possibleTargets?: unknown
  }
}

/** Progress of a multi-select GAME_TARGET: "… (selected 2 of 5, min 1)"
 *  (same shape as web/src/game/feedback/progress.ts; the helper does not import
 *  from src to stay self-contained). */
const SELECTED_PROGRESS_RE = /\s*\(selected\s+(\d+)(?:\s+of\s+(\d+))?(?:,\s*min\s+(\d+))?\)/i

/** Ids of a wire field that arrives as an array or an object map. */
function idListOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (value && typeof value === 'object') return Object.keys(value as Record<string, unknown>)
  return []
}

/** The helper's decision for a discard prompt (GAME_TARGET … discard …).
 *  The server's selection is a TOGGLE per sendPlayerUUID: resending an id
 *  already chosen DESELECTS it (2510 sends of the SAME uuid and the match never
 *  left "selected N of 2, min 2"). Rules:
 *  - fewer cards than the minimum → pick the NEXT candidate NOT yet chosen;
 *  - minimum met below the maximum → confirm (sendPlayerBoolean
 *    false, the dialog's "Done");
 *  - maximum reached → send nothing: the engine AUTOCOMPLETES
 *    (TargetImpl.isChoiceCompleted returns true with size >= max) and an extra
 *    boolean would land as "pass priority" in the main window.
 *  Returns null when there is no useful action (e.g. candidates exhausted:
 *  resending any of them would be the toggle again). */
export function planDiscardAnswer(
  message: string,
  chosen: readonly string[],
  candidates: readonly string[],
): { action: 'pick'; id: string } | { action: 'done' } | null {
  // the message can wrap the progress in <font>: the counter inside
  // parentheses is plain text, so stripping the tags is enough
  const text = message.replace(/<[^>]*>/g, '')
  const m = SELECTED_PROGRESS_RE.exec(text)
  const selected = Math.max(chosen.length, m?.[1] ? Number(m[1]) : 0)
  const min = m?.[3] ? Number(m[3]) : 1
  const max = m?.[2] ? Number(m[2]) : null
  if (selected >= min) {
    if (max !== null && selected >= max) return null
    return { action: 'done' }
  }
  const id = candidates.find((c) => !chosen.includes(c))
  return id ? { action: 'pick', id } : null
}

export class HumanHelper {
  private ws: WebSocket | null = null
  private seq = 0
  private pending = new Map<string, (ok: boolean) => void>()
  private gameId: string | null = null
  private lastLandTurn = -1
  private mainWindow: string | null = null
  /** Do not pass priority while the human is paying mana (GAME_PLAY_MANA):
   *  passing with an incomplete payment cancels the spell. */
  private payingUntil = 0
  /** Do not touch DECLARE_ATTACKERS/DECLARE_BLOCKERS windows (the human
   *  exercises them through the UI in combat tests): passing there would confirm
   *  the combat step without declaring anything. */
  private skipCombat: boolean
  private skipAsks: boolean
  /** Freeze the helper's WHOLE auto-pilot (priority passes, lands, asks):
   *  the test takes control window by window. Explicit `send` calls (raw/
   *  playCard/passPriority) keep working. */
  private pausedPassing = false
  /** The same `web:<user>:<uuid>` the page persists and sends in its connect:
   *  the proxy's anon-name guard uses it to attach the helper to the page's live
   *  session. Empty = connect without identity (old behaviour), which the guard
   *  rejects when the page session is the same. */
  private browserId = ''
  /** Backup ledger of ids sent to the current discard prompt: consulted only
   *  when a GAME_TARGET carries no options.chosenTargets (the authoritative
   *  state). It syncs with chosenTargets when that arrives and is cleared when
   *  any other window opens (a new prompt must not inherit ids). */
  private discardSent = new Set<string>()

  constructor(
    private readonly username: string,
    private readonly password: string,
    opts: { skipCombat?: boolean; skipAsks?: boolean } = {},
  ) {
    this.skipCombat = opts.skipCombat ?? false
    this.skipAsks = opts.skipAsks ?? false
  }

  /** Suspend/resume the auto-pilot (see pausedPassing). */
  set paused(value: boolean) {
    this.pausedPassing = value
  }

  get isStarted(): boolean {
    return this.ws !== null
  }

  /** Open the proxy WS and send `connect`. With the spec's `page`, inherit its
   *  persisted browserId (same key/shape as web/src/net/browserId.ts) so the
   *  proxy's anon-name guard attaches the helper to the SAME session as the page
   *  instead of rejecting it as "another browser". */
  async start(page?: Page): Promise<void> {
    if (page) this.browserId = await readPageBrowserId(page, this.username)
    let lastErr: string | null = null
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        await this.connectOnce()
        return
      } catch (e) {
        lastErr = (e as Error).message
        await new Promise((r) => setTimeout(r, 2500))
      }
    }
    throw new Error(lastErr ?? 'helper: could not connect')
  }

  private async connectOnce(): Promise<void> {
    const wsUrl = `ws://127.0.0.1:${FAKE_MODE ? getFakePort() : 8787}`
    this.ws = new WebSocket(wsUrl)
    await new Promise<void>((resolve, reject) => {
      const ws = this.ws
      if (!ws) return reject(new Error('helper: no websocket'))
      ws.onopen = () => resolve()
      ws.onerror = () => reject(new Error('helper: could not open the proxy websocket'))
    })
    // onmessage must be active BEFORE connect: the reply arrives through it
    this.ws.onmessage = (ev) => this.onMessage(String((ev as MessageEvent).data))
    const ok = await this.send('connect', connectArgs(HOST, PORT, this.username, this.password, this.browserId))
    if (!ok) throw new Error('helper: the proxy did not authorise the connection (same user as the page)')
  }

  async stop(): Promise<void> {
    const ws = this.ws
    this.ws = null
    this.pending.clear()
    ws?.close()
  }

  /** Wait until the helper has seen the match start. */
  async waitGameId(timeoutMs = 20_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (this.gameId) return
      await new Promise((r) => setTimeout(r, 100))
    }
    throw new Error('helper: the match did not start in time')
  }

  /** Play/cast the hand card over WS (deterministic; the server's dialogs are
   *  verified through the page UI). */
  async playCard(cardId: string): Promise<boolean> {
    if (!this.gameId) return false
    return this.send('sendPlayerUUID', { gameId: this.gameId, value: cardId })
  }

  /** Pass the human's priority (sendPlayerBoolean false) for windows the test
   *  does not exercise through the UI (e.g. main after casting the combat
   *  creature: the internal fallback dies if it coincides with a mana payment). */
  async passPriority(): Promise<boolean> {
    if (!this.gameId) return false
    return this.send('sendPlayerBoolean', { gameId: this.gameId, value: false })
  }

  /** Send a generic PlayerAction (skips F4/F9/..., HOLD, ...) and resolve with
   *  the proxy's ok: proves the proxy→server passthrough without the UI. */
  async sendPlayerAction(action: string): Promise<boolean> {
    if (!this.gameId) return false
    return this.send('sendPlayerAction', { gameId: this.gameId, action })
  }

  /** Arbitrary proxy gateway action (e.g. cheatSetup on test-mode servers):
   *  the same WS path as the page, without going through the UI. */
  async raw(action: string, args: Record<string, unknown>): Promise<boolean> {
    return this.send(action, args)
  }

  // ============================ protocol ============================

  private send(action: string, args: Record<string, unknown>): Promise<boolean> {
    if (process.env.E2E_DEBUG === '1') console.log(`[helper] ${Date.now()} >> ${action} ${JSON.stringify(args)}`)
    return new Promise((resolve) => {
      const requestId = `h${++this.seq}`
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        resolve(false)
      }, 8000)
      this.pending.set(requestId, (ok) => {
        clearTimeout(timer)
        resolve(ok)
      })
      try {
        this.ws?.send(JSON.stringify({ requestId, action, args }))
      } catch {
        clearTimeout(timer)
        this.pending.delete(requestId)
        resolve(false)
      }
    })
  }

  private onMessage(raw: string) {
    let m: Record<string, unknown>
    try {
      m = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return
    }
    if (process.env.E2E_DEBUG === '1' && m.type === 'event') {
      const d = (m.data ?? {}) as EventDataLike
      const gv = d.gameView
      const me = gv?.players?.find((p) => p.controlled)
      console.log(`[helper] ${Date.now()} ev ${String(m.method)} pri=${me?.hasPriority} act=${me?.isActive} t=${gv?.turn} ph=${gv?.phase} stack=${Object.keys(gv?.stack ?? {}).length} msg="${String(d.message ?? d.question ?? '').slice(0, 50)}"`)
    }
    if (m.type === 'result') {
      const cb = this.pending.get(String(m.requestId))
      if (cb) {
        this.pending.delete(String(m.requestId))
        cb(m.ok === true)
      }
      return
    }
    if (m.type !== 'event') return
    const method = String(m.method ?? '')
    const data = (m.data ?? {}) as EventDataLike
    // the gameId comes in the objectId of game events (START_GAME, GAME_INIT,
    // GAME_SELECT, GAME_UPDATE...). NOTE: CHATMESSAGE/JOINED_TABLE also carry
    // an objectId (chat/table) and must NOT touch the gameId.
    if (m.objectId && (method === 'START_GAME' || method.startsWith('GAME_'))) {
      this.gameId = String(m.objectId)
    }
    if (method === 'GAME_PLAY_MANA') {
      this.payingUntil = Date.now() + 3000
    }
    // the test is casting a spell (X/mode/targets dialogs): the main-window
    // fallback (1.5s) would pass priority mid-cast and the server CANCELS the
    // spell (stack back to 0, GAME_PLAY_MANA never arrives). Invalidate the
    // current window's fallback (it re-arms with the next GAME_SELECT) and cover
    // the gap until the first mana ask with payingUntil.
    if (
      method === 'GAME_GET_AMOUNT' ||
      method === 'GAME_SELECT_AMOUNT' ||
      method === 'GAME_CHOOSE_ABILITY' ||
      method === 'GAME_ASK' ||
      (method === 'GAME_TARGET' && !/discard/i.test(String(data.message ?? '')))
    ) {
      // GAME_ASK included: an armed fallback that fires with a pending ask is
      // NOT lost — the server consumes it as the answer to the ask (e.g. the
      // learn YES/NO stayed on "No" because of the delayed main-window pass).
      this.mainWindow = null
      this.payingUntil = Date.now() + 3000
    }
    try {
      // the discard ledger lives only for THAT prompt: it is cleared when another
      // interactive window opens (select/ask/other target); intermediate updates
      // (GAME_UPDATE and friends) do NOT touch it.
      if (method === 'GAME_SELECT' || method === 'GAME_ASK' || (method === 'GAME_TARGET' && !/discard/i.test(String(data.message ?? '')))) {
        this.discardSent.clear()
      }
      if (method === 'GAME_SELECT') this.handleSelect(data)
      else if (method === 'GAME_TARGET') this.handleTarget(data)
      else if (method === 'GAME_ASK') this.handleAsk(data)
    } catch {
      // the helper must never break the test
    }
  }

  // ============================ development bot ============================

  private handleSelect(data: EventDataLike) {
    if (this.pausedPassing) return
    const gv = data.gameView
    if (!gv || !this.gameId) return
    // Combat phase (attack/block): ALWAYS invalidate the previous main-window
    // fallback, even when this select gives us no priority (the human has it
    // false during the opponent's block and the return below would be skipped).
    // If the fallback survives, it fires a sendPlayerBoolean at ~1.5s that the
    // engine reads as "confirm blocks" and closes the window before the test's
    // click (race surfaced by slow fullPage screenshots).
    if (gv.phase === 'COMBAT') this.mainWindow = null
    const me = gv.players?.find((p) => p.controlled)
    if (!me) return
    if (me.hasPriority !== true) return
    // combat windows where the HUMAN declares: my attack (active with
    // possibleAttackers) and my block (defending with possibleBlockers). The test
    // exercises them through the UI; passing here would close the step without
    // declaring anything. NOTE: PRIORITY selects in combat steps (no creatures to
    // declare, "Play instants...") ARE passed — they are instant windows.
    const options = (data.options ?? {}) as { possibleAttackers?: unknown; possibleBlockers?: unknown }
    const hasCombatSelect =
      (Array.isArray(options.possibleAttackers) && options.possibleAttackers.length > 0) ||
      (Array.isArray(options.possibleBlockers) && options.possibleBlockers.length > 0)
    if (hasCombatSelect) {
      // the test exercises the combat window through the UI: invalidate the armed
      // main window so the pending fallback (1.5s) does not fire an extra
      // sendPlayerBoolean the engine reads as "end of the combat step" and
      // closes the window before the test's click
      this.mainWindow = null
      if (this.skipCombat) return
    }
    const myMain = me.isActive === true && gv.phase === 'PRECOMBAT_MAIN'
    if (myMain) {
      // the fallback clock measures the CURRENT window (turn+phase): re-selects of
      // the same window (e.g. after playing a land) do NOT restart it
      const winKey = `${gv.turn}:${gv.phase}`
      if (winKey !== this.mainWindow) {
        this.mainWindow = winKey
        this.armFallback()
      }
      // 1. development: play one land per turn (NEVER during mana payment:
      //    playing a land mid-payment aborts the spell)
      if (gv.turn !== this.lastLandTurn && Date.now() > this.payingUntil) {
        const land = firstBasicLand(gv.myHand)
        if (land) {
          this.lastLandTurn = gv.turn ?? -1
          void this.send('sendPlayerUUID', { gameId: this.gameId, value: land })
          return
        }
      }
      // 2. something on the stack: the test's action has already been played —
      //    pass so it resolves. A GAME_SELECT with stack>0 arrives AFTER the cost
      //    payment completes (the server gives no priority between asks of the
      //    same cost), so passing here never cancels the spell; waiting for
      //    payingUntil froze the game (the spell sat on the stack with nobody
      //    passing).
      const stackCount = Object.keys((gv.stack ?? {}) as Record<string, unknown>).length
      if (stackCount > 0) {
        void this.send('sendPlayerBoolean', { gameId: this.gameId, value: false })
        return
      }
      // 3. main window with no action: the armed fallback (1.5s) passes if the test
      //    does not cast; the test's cast goes over WS (instantaneous) and acts first.
      return
    }
    // opponent turns / phases with nothing playable for the test: pass to advance
    void this.send('sendPlayerBoolean', { gameId: this.gameId, value: false })
  }

  /** Passes the current main window if it is still open ~1.5s after it opened.
   *  NEVER during a mana payment: when the fallback lands on an ongoing payment
   *  (payingUntil active) it RETRIES in a loop until the payment ends and the
   *  window is passed (a single-shot fallback died after the payment and left
   *  the main window open forever, hanging the game). The loop also honours
   *  `pausedPassing`: a fallback armed before the pause would still fire at 1.5s,
   *  and the test would then time the helper's round trip, not its own click. */
  private armFallback() {
    const winKey = this.mainWindow
    const check = () => {
      if (this.pausedPassing) return
      if (this.mainWindow !== winKey || !this.gameId) return
      if (Date.now() > this.payingUntil) {
        void this.send('sendPlayerBoolean', { gameId: this.gameId, value: false })
        return
      }
      setTimeout(check, 300)
    }
    setTimeout(check, 1500)
  }

  private handleTarget(data: EventDataLike) {
    if (!this.gameId || !/discard/i.test(String(data.message ?? ''))) return
    const message = String(data.message ?? '')
    const options = (data.options ?? {}) as { chosenTargets?: unknown; possibleTargets?: unknown }
    // AUTHORITATIVE chosen state: options.chosenTargets (the same field the UI's
    // CardGrid paints). The server's toggle asks again after every send, so each
    // re-ask arrives with the selection already updated.
    const chosen = idListOf(options.chosenTargets)
    if (chosen.length > 0) {
      // server-authoritative state: replaces the local backup ledger (used only
      // when a frame carries no chosenTargets: without it we would resend an id
      // already chosen and the server's toggle would remove it — another ping-pong).
      this.discardSent = new Set(chosen)
    }
    const chosenIds = chosen.length > 0 ? chosen : [...this.discardSent]
    const possible = idListOf(options.possibleTargets)
    // candidates in preference order: from the grid's cards (filtered to the
    // legal ones if the server declares them) a basic LAND first (previous
    // behaviour), then the rest; last hand and targets.
    const candidates: string[] = []
    const push = (id: string | null | undefined) => {
      if (id && !candidates.includes(id)) candidates.push(id)
    }
    const cards = data.cardsView1
    if (cards) {
      const entries = Object
        .entries(cards as Record<string, { name?: string; displayName?: string }>)
        .filter(([id]) => possible.length === 0 || possible.includes(id))
      const land = entries.find(([, c]) => BASIC_LANDS.includes(c.name ?? '') || BASIC_LANDS.includes(c.displayName ?? ''))
      if (land) push(land[0])
      for (const [id] of entries) push(id)
    }
    for (const id of possible) push(id)
    push(firstBasicLand(data.gameView?.myHand))
    if (data.gameView?.myHand) for (const id of Object.keys(data.gameView.myHand)) push(id)
    for (const id of idListOf(data.targets)) push(id)
    const plan = planDiscardAnswer(message, chosenIds, candidates)
    if (plan?.action === 'pick') {
      this.discardSent.add(plan.id) // backup ledger: never resend an id already sent
      void this.send('sendPlayerUUID', { gameId: this.gameId, value: plan.id })
    } else if (plan?.action === 'done') {
      void this.send('sendPlayerBoolean', { gameId: this.gameId, value: false })
    }
  }

  private handleAsk(data: EventDataLike) {
    if (!this.gameId || this.skipAsks || this.pausedPassing) return
    const question = String(data.question ?? data.message ?? '')
    // XMage: false = keep the hand at mulligan; true = accept the rest.
    // The web's auto-keep already answers the mulligan: answering it here too
    // (the helper is connected from the start) would send a SECOND false the
    // server treats as "pass priority" and would break the test's window.
    if (/mulligan|keep your hand|keep hand/i.test(question)) return
    void this.send('sendPlayerBoolean', { gameId: this.gameId, value: true })
  }
}

function firstBasicLand(hand: Record<string, HandCard> | undefined): string | null {
  if (!hand) return null
  for (const [id, card] of Object.entries(hand)) {
    const name = card.name ?? card.displayName ?? ''
    if (BASIC_LANDS.includes(name)) return id
  }
  return null
}
