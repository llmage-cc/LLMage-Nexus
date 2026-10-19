#!/usr/bin/env node
// ---------------------------------------------------------------------------
// build-scryfall-image-index.mjs — build the nexus web client's OFFLINE
// Scryfall image index (name -> uuid maps + token art lists).
//
// WHY OFFLINE (do not replace this with live api.scryfall.com calls):
//   The web client used to resolve every card/token image through live
//   api.scryfall.com lookups (/cards/named?exact, /cards/named?fuzzy, ...).
//   Scryfall rate-limits those endpoints (~2 req/s documented), and a full
//   game board is a 30-60 request burst, so real users hit "image never
//   loads" failures. Scryfall's own docs say heavy image resolution must use
//   the bulk data files. The CDN that api.scryfall.com 302s to —
//   cards.scryfall.io — is NOT rate-limited, and its URLs are derivable from
//   a card uuid alone:
//
//     https://cards.scryfall.io/{size}/{front|back}/{id[0]}/{id[1]}/{id}.jpg
//
//   so the client resolves a card/token name (or a set/number) to a uuid from
//   these committed JSON files and builds the CDN URL itself, never touching
//   the API.
//
// WHAT REGENERATES IT:
//   Scryfall re-rolls the bulk files roughly every 12h. This script streams
//   the three relevant ones and re-emits the committed JSON into
//   web/src/data/. Regeneration cadence: after every new set release, or when
//   art/token picks look stale — NOT on every bulk roll. The maps are
//   name->uuid and uuids are stable; `generatedAt` in the files is the build
//   date and WILL show up in git diffs — that is intentional provenance.
//
// TRAPS (all measured against live data — do not "simplify" them away):
//   1. `layout: "art_series"` entries are EXCLUDED from the card map. Their
//      `//`-combined names collide with real cards and appear FIRST in the
//      stream; a naive map maps "Lightning Bolt" to a Strixhaven art-series
//      card.
//   2. XMage names are accent-folded (Adewale vs Scryfall Adéwalé): both the
//      name map and the token map ALSO index the NFD-stripped form of every
//      name (NFD + strip Mn/combining marks).
//   3. XMage knows FRONT-FACE names only ("Delver of Secrets"); oracle
//      entries are `//`-combined and carry card_faces[]. Every face name is
//      indexed to the entry's uuid, and `backs` lists the FRONT names of
//      layouts whose back face carries its own image (transform, modal_dfc,
//      double_faced_token, reversible_card, battle) so the client can build
//      the /back/ CDN URL. Both the combined name and the front-face name
//      are listed (XMage compares against what it knows).
//   4. Token art comes from unique-artwork, NOT oracle-cards: oracle has ~1
//      art per token name, but the picker needs them all (Soldier: 42 vs 13).
//      Each token art stores the scryfall uuid directly (plus set/number for
//      the picker's engine-set default matching). NO illustration dedupe:
//      unique-artwork is already one entry per distinct artwork, and the
//      engine-set default match needs every SET that printed a distinct art.
//   5. Engine token names come from the KEYS of the committed
//      web/src/data/tokenImages.generated.json (`SET/Name[/N]` and
//      `SET/Name#back` -> `Name`). Those are the names the engine will
//      actually ask for; every Scryfall unique-artwork token name is included
//      too, plus folded aliases of both.
//
// USAGE (run from the repo root; Node stdlib only, no deps):
//   node scripts/build-scryfall-image-index.mjs --bulk-dir <dir>
//     Streams <dir>/{oracle-cards,default-cards,unique-artwork}.jsonl.gz and
//     writes web/src/data/scryfall-{cards,printings,token-arts}.generated.json.
//     Missing bulk files are downloaded into <dir> first.
//   node scripts/build-scryfall-image-index.mjs
//     No args: downloads the bulk files into a temp dir (--out-tmp <dir>, or
//     the OS temp dir), then builds.
//   Optional: --out <dir> overrides the output dir (default web/src/data).
//
// A self-check block at the end asserts sample resolutions, prints counts +
// gzip -9 sizes of the three emitted files, and exits nonzero on any failure.
// ---------------------------------------------------------------------------

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import readline from 'node:readline'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { StringDecoder } from 'node:string_decoder'
import { fileURLToPath } from 'node:url'

const USER_AGENT = 'xmage-nexus-image-index-builder/1.0'
const BULK_INDEX_URL = 'https://api.scryfall.com/bulk-data'

// Layouts whose back face carries its own image (so the client can build the
// cards.scryfall.io /back/ URL for them).
const BACK_FACE_LAYOUTS = new Set([
  'transform',
  'modal_dfc',
  'double_faced_token',
  'reversible_card',
  'battle',
])

const UUID_RE = /^[0-9a-f-]{36}$/

// Scryfall bulk type -> local file name (matches the preseeded download dir).
const BULK_FILES = [
  ['oracle-cards', 'oracle-cards.jsonl.gz'],
  ['default-cards', 'default-cards.jsonl.gz'],
  ['unique-artwork', 'unique-artwork.jsonl.gz'],
]

const CARDS_OUT = 'scryfall-cards.generated.json'
const PRINTINGS_OUT = 'scryfall-printings.generated.json'
const TOKENS_OUT = 'scryfall-token-arts.generated.json'

const TOKEN_IMAGES_FILE = path.join('web', 'src', 'data', 'tokenImages.generated.json')

// ── small helpers ─────────────────────────────────────────────────────────

const byKey = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/** Accent fold: NFD + strip combining marks (Adéwalé -> Adewale). */
function foldName(name) {
  return name.normalize('NFD').replace(/\p{Mn}/gu, '')
}

function toSortedObject(map) {
  const out = {}
  for (const key of [...map.keys()].sort(byKey)) out[key] = map.get(key)
  return out
}

function fail(msg) {
  throw new Error(msg)
}

// ── bulk fetching ─────────────────────────────────────────────────────────

async function fetchBulkIndex() {
  const headers = { 'User-Agent': USER_AGENT, Accept: 'application/json' }
  let res = await fetch(BULK_INDEX_URL, { headers, signal: AbortSignal.timeout(120_000) })
  if (res.status === 400) {
    // Scryfall answers a bare 400 when the User-Agent is missing an Accept
    // pair it trusts — retry once with both (same quirk as the python script).
    res = await fetch(BULK_INDEX_URL, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json;q=0.9,*/*;q=0.8' },
      signal: AbortSignal.timeout(120_000),
    })
  }
  if (!res.ok) fail(`bulk-data index: HTTP ${res.status} ${res.statusText}`)
  const index = await res.json()
  const uris = {}
  for (const entry of index?.data ?? []) {
    const type = String(entry?.type ?? '').replace(/_/g, '-')
    const uri = entry?.jsonl_download_uri || entry?.download_uri
    if (type && uri) uris[type] = uri
  }
  for (const [type] of BULK_FILES) {
    if (!uris[type]) fail(`bulk-data index has no download uri for ${type}`)
  }
  return uris
}

async function downloadFile(url, dest) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(900_000) })
  if (!res.ok || !res.body) fail(`download ${url}: HTTP ${res.status} ${res.statusText}`)
  const tmp = `${dest}.tmp`
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp))
  await fs.promises.rename(tmp, dest)
  const { size } = await fs.promises.stat(dest)
  console.log(`  -> ${dest} (${size.toLocaleString('en-US')} B)`)
}

/** Make sure the three bulk files exist in bulkDir, downloading what's missing. */
async function ensureBulkFiles(bulkDir) {
  await fs.promises.mkdir(bulkDir, { recursive: true })
  const missing = []
  for (const [type, file] of BULK_FILES) {
    const p = path.join(bulkDir, file)
    let size = 0
    try {
      size = (await fs.promises.stat(p)).size
    } catch {
      size = 0
    }
    if (size > 1_000_000) console.log(`bulk: using ${p} (${size.toLocaleString('en-US')} B)`)
    else missing.push([type, file, p])
  }
  if (!missing.length) return
  console.log('fetching bulk-data index …')
  const uris = await fetchBulkIndex()
  for (const [type, , dest] of missing) {
    console.log(`downloading ${type} …`)
    await downloadFile(uris[type], dest)
  }
}

// ── streaming readers ─────────────────────────────────────────────────────

/** Open a bulk file; gunzip when it carries the gzip magic (else raw). */
async function openBulkStream(file) {
  const fh = await fs.promises.open(file, 'r')
  let gz = false
  try {
    const magic = Buffer.alloc(2)
    await fh.read(magic, 0, 2, 0)
    gz = magic[0] === 0x1f && magic[1] === 0x8b
  } finally {
    await fh.close()
  }
  const src = fs.createReadStream(file)
  if (!gz) return src
  const gunzip = zlib.createGunzip()
  src.on('error', (err) => gunzip.destroy(err))
  return src.pipe(gunzip)
}

/** Decode byte chunks to strings with correct UTF-8 handling across splits. */
async function* decodedChunks(source) {
  const decoder = new StringDecoder('utf8')
  for await (const chunk of source) {
    const s = typeof chunk === 'string' ? chunk : decoder.write(chunk)
    if (s) yield s
  }
  const tail = decoder.end()
  if (tail) yield tail
}

/** First non-whitespace ASCII char of a buffer (skips a UTF-8 BOM). */
function firstJsonChar(buf) {
  let i = 0
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) i = 3
  for (; i < buf.length; i++) {
    const c = buf[i]
    if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) continue
    return String.fromCharCode(c)
  }
  return ''
}

/**
 * Fallback reader for the (older) JSON-array bulk format: scans the stream for
 * top-level `{...}` objects with string/escape-aware brace counting.
 */
async function* scanJsonArray(source, file) {
  const name = path.basename(file)
  let parts = []
  let start = -1
  let depth = 0
  let inStr = false
  let esc = false
  for await (const chunk of source) {
    let i = 0
    while (i < chunk.length) {
      if (start === -1) {
        const b = chunk.indexOf('{', i)
        if (b === -1) break
        start = b
        depth = 1
        inStr = false
        esc = false
        i = b + 1
        continue
      }
      const c = chunk.charCodeAt(i)
      if (inStr) {
        if (esc) esc = false
        else if (c === 0x5c) esc = true
        else if (c === 0x22) inStr = false
      } else if (c === 0x22) {
        inStr = true
      } else if (c === 0x7b) {
        depth++
      } else if (c === 0x7d) {
        depth--
        if (depth === 0) {
          parts.push(chunk.slice(start, i + 1))
          let obj
          try {
            obj = JSON.parse(parts.join(''))
          } catch (err) {
            fail(`${name}: invalid JSON object in array stream: ${err.message}`)
          }
          parts = []
          start = -1
          i++
          yield obj
          continue
        }
      }
      i++
    }
    if (start !== -1) {
      parts.push(chunk.slice(start))
      start = 0
    }
  }
  if (start !== -1 || parts.length) fail(`${name}: truncated JSON array`)
}

/**
 * Stream one bulk file as a sequence of parsed entries. Streams the gunzip and
 * parses line by line (JSONL is the current Scryfall bulk format); falls back
 * to an object scanner when a file is the older single JSON array. Never
 * buffers the whole file (default-cards decompresses to ~500 MB).
 */
async function* readBulkRecords(file) {
  const raw = await openBulkStream(file)
  const it = raw[Symbol.asyncIterator]()
  const first = await it.next()
  const firstChunk = first.done ? Buffer.alloc(0) : Buffer.isBuffer(first.value) ? first.value : Buffer.from(first.value)
  const firstChar = firstJsonChar(firstChunk)
  const combined = Readable.from(
    (async function* () {
      if (firstChunk.length) yield firstChunk
      if (!first.done) yield* it
    })(),
  )
  // readline needs an EventEmitter-style stream (not a bare async generator).
  const text = Readable.from(decodedChunks(combined))

  if (firstChar === '[') {
    yield* scanJsonArray(text, file)
    return
  }

  const rl = readline.createInterface({ input: text, crlfDelay: Infinity })
  let lineNo = 0
  for await (let line of rl) {
    lineNo++
    if (lineNo === 1 && line.charCodeAt(0) === 0xfeff) line = line.slice(1)
    if (!line.trim()) continue
    try {
      yield JSON.parse(line)
    } catch (err) {
      fail(`${path.basename(file)}: invalid JSON on line ${lineNo}: ${err.message}`)
    }
  }
}

// ── the three builds ──────────────────────────────────────────────────────

/** cards: name (combined + every face name + folded variants) -> uuid; backs: DFC front names. */
async function buildCards(oracleFile) {
  const cards = new Map()
  const backs = new Set()
  const stats = { entries: 0, art_series: 0, token_entries: 0, skipped_no_faces: 0 }
  for await (const e of readBulkRecords(oracleFile)) {
    stats.entries++
    const layout = e?.layout
    if (layout === 'art_series') {
      stats.art_series++
      continue
    }
    const id = e?.id
    const name = e?.name
    if (!id || !name) {
      stats.skipped_no_faces++
      continue
    }
    // Every name this entry can be looked up by: combined name + each face.
    const names = [name]
    if (Array.isArray(e.card_faces)) {
      for (const face of e.card_faces) if (face?.name) names.push(face.name)
    }
    if (layout === 'token') stats.token_entries++
    for (const n of names) {
      if (!cards.has(n)) cards.set(n, id)
      const folded = foldName(n)
      if (folded !== n && !cards.has(folded)) cards.set(folded, id)
    }
    if (BACK_FACE_LAYOUTS.has(layout)) {
      backs.add(name)
      if (Array.isArray(e.card_faces) && e.card_faces[0]?.name) backs.add(e.card_faces[0].name)
    }
  }
  return { cards, backs, stats }
}

/** printings: lowercased "set/num" -> [uuid, front face name] (first wins). */
async function buildPrintings(defaultFile) {
  const printings = new Map()
  const stats = { entries: 0, skipped: 0, dupes: 0 }
  for await (const e of readBulkRecords(defaultFile)) {
    stats.entries++
    const id = e?.id
    const set = e?.set
    const num = e?.collector_number
    if (!id || !set || !num) {
      stats.skipped++
      continue
    }
    const key = `${set}/${num}`.toLowerCase()
    if (printings.has(key)) {
      stats.dupes++
      continue
    }
    const name = typeof e.name === 'string' ? e.name : ''
    printings.set(key, [id, name.split(' // ')[0]])
  }
  return { printings, stats }
}

/** tokens: token name -> [{id,set,num,released}] from unique-artwork (layout token). */
async function buildTokenArts(uaFile) {
  const artsByName = new Map()
  const stats = { entries: 0, art_series: 0, token_entries: 0, no_image: 0, skipped: 0 }
  for await (const e of readBulkRecords(uaFile)) {
    stats.entries++
    if (e?.layout === 'art_series') {
      stats.art_series++
      continue
    }
    if (e?.layout !== 'token') continue
    stats.token_entries++
    const id = e?.id
    const name = e?.name
    if (!id || !name) {
      stats.skipped++
      continue
    }
    // Strip the full " (Token)" suffix (8 chars) per the frozen contract; the
    // python's `name[:-7]` equivalent would leave a trailing space (dormant:
    // no live name carries the suffix).
    const scryName = name.endsWith(' (Token)') ? name.slice(0, -8) : name
    // Face-less / double-faced token entries carry no usable image.
    if (!e.image_uris && !e.card_faces) {
      stats.no_image++
      continue
    }
    const arts = artsByName.get(scryName) ?? []
    arts.push({ id, set: e.set ?? null, num: e.collector_number ?? null, released: e.released_at ?? null })
    artsByName.set(scryName, arts)
  }
  return { artsByName, stats }
}

/** Engine token names from the keys of tokenImages.generated.json: SET/Name[/N] and SET/Name#back -> Name. */
function engineTokenNames(tokenImages) {
  const names = new Set()
  for (const key of Object.keys(tokenImages)) {
    const slash = key.indexOf('/')
    if (slash < 0) continue
    names.add(key.slice(slash + 1).replace(/#back$/, '').replace(/\/\d+$/, ''))
  }
  return names
}

/** Merge Scryfall token arts with engine names (same contract as the python script). */
function mergeTokens(artsByName, engineNames) {
  const tokens = new Map()
  for (const ename of [...engineNames].sort(byKey)) {
    for (const candidate of [ename, foldName(ename)]) {
      const arts = artsByName.get(candidate)
      if (arts) {
        tokens.set(ename, arts)
        break
      }
    }
  }
  for (const [sname, arts] of [...artsByName.entries()].sort((a, b) => byKey(a[0], b[0]))) {
    if (!tokens.has(sname) && !engineNames.has(foldName(sname)) && !engineNames.has(sname)) {
      tokens.set(sname, arts)
    }
  }
  // Folded aliases for names with accents (same contract as the card map).
  for (const [sname, arts] of [...tokens.entries()]) {
    const folded = foldName(sname)
    if (folded !== sname && !tokens.has(folded)) tokens.set(folded, arts)
  }
  return tokens
}

// ── main ──────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { bulkDir: null, outDir: null, outTmp: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--bulk-dir' || a === '--out' || a === '--out-tmp') {
      const v = argv[++i]
      if (!v) fail(`missing value for ${a}`)
      if (a === '--bulk-dir') opts.bulkDir = v
      else if (a === '--out') opts.outDir = v
      else opts.outTmp = v
    } else if (a === '--help' || a === '-h') {
      console.log('usage: node scripts/build-scryfall-image-index.mjs [--bulk-dir <dir>] [--out <dir>] [--out-tmp <dir>]')
      process.exit(0)
    } else {
      fail(`unknown argument: ${a} (try --help)`)
    }
  }
  return opts
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const outDir = opts.outDir ? path.resolve(opts.outDir) : path.join(repoRoot, 'web', 'src', 'data')
  const bulkDir = opts.bulkDir
    ? path.resolve(opts.bulkDir)
    : opts.outTmp
      ? path.resolve(opts.outTmp)
      : path.join(os.tmpdir(), 'scryfall-image-index-bulk')

  console.log(`bulk dir : ${bulkDir}`)
  console.log(`out dir  : ${outDir}`)
  await ensureBulkFiles(bulkDir)

  const oracleFile = path.join(bulkDir, 'oracle-cards.jsonl.gz')
  const defaultFile = path.join(bulkDir, 'default-cards.jsonl.gz')
  const uaFile = path.join(bulkDir, 'unique-artwork.jsonl.gz')

  // ── Card map from oracle-cards ──────────────────────────────────────
  console.log('streaming oracle-cards …')
  const { cards, backs, stats: cardStats } = await buildCards(oracleFile)
  console.log(`oracle-cards: ${cardStats.entries.toLocaleString('en-US')} entries`)

  // ── Printings map from default-cards ────────────────────────────────
  console.log('streaming default-cards …')
  const { printings, stats: printingStats } = await buildPrintings(defaultFile)
  console.log(`default-cards: ${printingStats.entries.toLocaleString('en-US')} entries`)

  // ── Token arts from unique-artwork ──────────────────────────────────
  console.log('streaming unique-artwork …')
  const { artsByName, stats: tokStats } = await buildTokenArts(uaFile)
  console.log(`unique-artwork: ${tokStats.entries.toLocaleString('en-US')} entries`)

  const tokenImagesPath = path.join(repoRoot, TOKEN_IMAGES_FILE)
  let tokenImages
  try {
    tokenImages = JSON.parse(await fs.promises.readFile(tokenImagesPath, 'utf8'))
  } catch (err) {
    fail(`${tokenImagesPath} not found or invalid — it ships in the repo (${err.message})`)
  }
  const engineNames = engineTokenNames(tokenImages)
  const tokens = mergeTokens(artsByName, engineNames)

  // ── Emit ────────────────────────────────────────────────────────────
  const generatedAt = new Date().toISOString()
  await fs.promises.mkdir(outDir, { recursive: true })

  const cardsText = JSON.stringify({ generatedAt, cards: toSortedObject(cards), backs: [...backs].sort(byKey) })
  const printingsText = JSON.stringify({ generatedAt, printings: toSortedObject(printings) })
  const tokensText = JSON.stringify({ generatedAt, tokens: toSortedObject(tokens) })

  const writeJson = async (fileName, text) => {
    const p = path.join(outDir, fileName)
    const buf = Buffer.from(text, 'utf8')
    await fs.promises.writeFile(p, buf)
    return { p, raw: buf.length, gz: zlib.gzipSync(buf, { level: 9 }).length }
  }

  const cardsOut = await writeJson(CARDS_OUT, cardsText)
  const printingsOut = await writeJson(PRINTINGS_OUT, printingsText)
  const tokensOut = await writeJson(TOKENS_OUT, tokensText)

  // ── Self-check ──────────────────────────────────────────────────────
  const fails = []
  const check = (cond, label) => {
    console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}`)
    if (!cond) fails.push(label)
  }

  check(UUID_RE.test(cards.get('Lightning Bolt') ?? ''), "'Lightning Bolt' maps to a uuid (art_series excluded)")
  check(cards.get('Adéwalé, Breaker of Chains') !== undefined, "'Adéwalé, Breaker of Chains' resolves (accented form)")
  check(cards.get('Adewale, Breaker of Chains') !== undefined, "'Adewale, Breaker of Chains' (accent-fold) resolves")
  check(UUID_RE.test(cards.get('Delver of Secrets') ?? ''), "'Delver of Secrets' resolves")
  check(backs.has('Delver of Secrets'), "'Delver of Secrets' is a DFC (in backs)")
  const boltPrinting = printings.get('m10/146')
  check(
    Array.isArray(boltPrinting) && boltPrinting.length === 2 && UUID_RE.test(boltPrinting[0] ?? ''),
    "printings['m10/146'] exists with a 36-char uuid",
  )
  const soldier = tokens.get('Soldier')
  check(Array.isArray(soldier) && soldier.length > 1, `'Soldier' has multiple arts (${soldier ? soldier.length : 0})`)
  check((soldier ?? []).slice(0, 5).every((a) => UUID_RE.test(a.id)), 'token arts carry scryfall uuids')
  check((soldier ?? []).slice(0, 5).every((a) => Boolean(a.set)), 'token arts carry set codes')
  check(cardStats.art_series > 2000, `art_series entries were excluded (${cardStats.art_series})`)

  const fmt = (n) => n.toLocaleString('en-US')
  console.log(`\ncards     : ${fmt(cards.size)} keys (+${fmt(backs.size)} back-face names), raw ${fmt(cardsOut.raw)} B, gz ${fmt(cardsOut.gz)} B`)
  console.log(`printings : ${fmt(printings.size)} keys, raw ${fmt(printingsOut.raw)} B, gz ${fmt(printingsOut.gz)} B`)
  console.log(`token arts: ${fmt(tokens.size)} names (${fmt([...tokens.values()].reduce((n, v) => n + v.length, 0))} arts), raw ${fmt(tokensOut.raw)} B, gz ${fmt(tokensOut.gz)} B`)
  console.log(`oracle    : ${JSON.stringify(cardStats)}`)
  console.log(`printings : ${JSON.stringify(printingStats)}`)
  console.log(`unique-artwork tokens: ${JSON.stringify(tokStats)}`)

  if (fails.length) {
    console.error(`\nSELF-CHECK FAILED: ${fails.join(' | ')}`)
    process.exitCode = 1
    return
  }
  console.log('self-check: all ok')
}

main().catch((err) => {
  console.error(`FATAL: ${err?.message ?? err}`)
  process.exitCode = 1
})
