// Live P1-flow probe against a running proxy (WS 8921) and game server (127.0.0.1:17181).
// Reproduces the webui path headlessly: connect -> getP1Decks -> createTable(2x COMPUTER_P1)
// -> joinTable(each with a real training-deck TEXT) -> startMatch -> watch a few turns.
// Run: NODE_PATH=<web>/node_modules node probe-p1-flow.cjs
const WebSocket = require('ws')

const WS_URL = process.env.P1_WS || 'ws://127.0.0.1:8921'
const HOST = process.env.P1_HOST || '127.0.0.1'
const PORT = Number(process.env.P1_PORT || 17181)
const RUN_SECS = Number(process.env.P1_RUN_SECS || 150)

let reqId = 0
const pending = new Map()
const events = []      // {method, ...}
const results = []     // {action, ok, data?, errorCode?, error?}

const ws = new WebSocket(WS_URL)
function send(action, args, timeoutMs = 45000) {
  const requestId = String(++reqId)
  ws.send(JSON.stringify({ requestId, action, args: args || {} }))
  return new Promise((resolve) => {
    pending.set(requestId, { action, resolve })
    setTimeout(() => { if (pending.delete(requestId)) resolve({ action, timeout: true }) }, timeoutMs)
  })
}
function log(...a) { console.log(...a) }

function parseDeckText(name, text) {
  const cards = [], sideboard = []
  let inSide = false
  for (const raw of String(text).split(/\r?\n/)) {
    let line = raw.trim()
    if (!line) continue
    if (/^SB:/i.test(line)) { inSide = true; line = line.replace(/^SB:\s*/i, '') }
    else if (/^sideboard$/i.test(line)) { inSide = true; continue }
    else if (/^deck$/i.test(line)) { inSide = false; continue }
    const m = line.match(/^(\d+)\s+(.+?)\s*$/)
    if (!m) continue
    const e = { cardName: m[2].replace(/\s+\[[^\]]*\]$/, '').trim(), amount: Number(m[1]) }
    ;(inSide ? sideboard : cards).push(e)
  }
  return { name, cards, sideboard }
}

ws.on('open', () => log('[probe] ws open', WS_URL))
ws.on('error', (e) => { log('[probe] ws error', e.message); process.exit(3) })
ws.on('message', (raw) => {
  let msg
  try { msg = JSON.parse(String(raw)) } catch { return }
  if (msg.type === 'result') {
    const p = msg.requestId && pending.get(msg.requestId)
    if (p) { pending.delete(msg.requestId); p.resolve(msg) }
    results.push({ action: msg.action, ok: msg.ok, errorCode: msg.errorCode, error: msg.error, hasData: !!msg.data })
    if (['connect', 'getP1Decks', 'createTable', 'joinTable', 'startMatch', 'watchTable'].includes(msg.action)) {
      log(`[probe] result ${msg.action} ok=${msg.ok}${msg.errorCode ? ' code=' + msg.errorCode : ''}${msg.error ? ' err=' + msg.error : ''}`)
    }
  } else if (msg.type === 'event') {
    events.push({ method: msg.method, t: Date.now() })
    if (['START_GAME', 'GAME_INIT', 'GAME_OVER', 'JOINED_TABLE', 'WATCHGAME'].includes(msg.method)) log('[probe] event', msg.method)
    if (msg.method === 'GAME_UPDATE' && events.filter((e) => e.method === 'GAME_UPDATE').length % 25 === 0) {
      log(`[probe] GAME_UPDATE count=${events.filter((e) => e.method === 'GAME_UPDATE').length}`)
    }
  } else if (msg.type === 'connect_error') {
    log('[probe] connect_error', msg.message)
  }
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  await new Promise((r) => ws.on('open', r))
  await sleep(300)

  const conn = await send('connect', { host: HOST, port: PORT, username: 'p1probe' })
  const caps = conn && conn.data && conn.data.capabilities
  log('[probe] capabilities =', JSON.stringify(caps))
  if (!conn || !conn.ok) { log('[probe] FATAL connect failed'); process.exit(4) }
  if (!caps || caps.p1 !== true) log('[probe] WARN capabilities.p1 is not true')

  const decks = await send('getP1Decks', {})
  const list = (decks && decks.data && decks.data.decks) || []
  log(`[probe] getP1Decks: ok=${decks.ok} count=${list.length} default=${decks.data && decks.data.default}`)
  if (list.length === 0) { log('[probe] FATAL no P1 decks'); process.exit(5) }

  const p1Deck = parseDeckText(list[0].name, list[0].deck)
  log(`[probe] seat deck "${list[0].name}" -> cards=${p1Deck.cards.length} side=${p1Deck.sideboard.length} firstCard=${JSON.stringify(p1Deck.cards[0])}`)

  const create = await send('createTable', {
    name: 'P1-probe ' + Date.now(),
    gameType: 'Two Player Duel',
    deckType: 'Constructed - Modern',
    winsNeeded: 1,
    playerTypes: ['COMPUTER_P1', 'COMPUTER_P1'],
  })
  const tableId = create && create.data && (create.data.tableId || create.data.TableId)
  log(`[probe] createTable ok=${create.ok} tableId=${tableId}`)
  if (!create.ok || !tableId) { log('[probe] create failed:', JSON.stringify(create)); process.exit(6) }

  for (let i = 0; i < 2; i++) {
    const j = await send('joinTable', {
      tableId,
      playerName: i === 0 ? 'Computer' : 'Computer 2',
      playerType: 'COMPUTER_P1',
      skill: 2,
      deck: p1Deck,
      deckType: 'Constructed - Modern',
      gameType: 'Two Player Duel',
    })
    log(`[probe] joinTable[${i}] ok=${j.ok}${j.errorCode ? ' code=' + j.errorCode : ''}${j.error ? ' err=' + j.error : ''}`)
  }

  const start = await send('startMatch', { tableId })
  log(`[probe] startMatch ok=${start.ok}${start.error ? ' err=' + start.error : ''}`)
  await send('watchTable', { tableId }).catch(() => {})

  log(`[probe] watching ${RUN_SECS}s…`)
  await sleep(RUN_SECS * 1000)
  const byMethod = {}
  for (const e of events) byMethod[e.method] = (byMethod[e.method] || 0) + 1
  log('[probe] event summary', JSON.stringify(byMethod))
  require('fs').writeFileSync(process.env.P1_OUT || '/tmp/p1-probe-out.json', JSON.stringify({
    caps, deckCount: list.length, deckDefault: decks.data && decks.data.default,
    tableId, results, eventSummary: byMethod,
  }, null, 2))
  log('[probe] done')
  process.exit(0)
})().catch((e) => { console.error('[probe] fatal', e); process.exit(9) })
