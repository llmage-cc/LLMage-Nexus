#!/usr/bin/env node
/**
 * Regenerate the bundled built-in deck corpus asset.
 *
 *   node web/scripts/build-bundled-decks.mjs
 *   BUILTIN_DECKS_SRC=/path/to/builtin.json node web/scripts/build-bundled-decks.mjs
 *   node web/scripts/build-bundled-decks.mjs /path/to/builtin.json   # positional also works
 *
 * Source (the already-validated 5,013-deck corpus our own webui ships):
 *   xmage/Mage.WebProxy/web/frontend/decks/builtin.json
 *   = counts {majors: 3841, sample: 1172}, groups Legacy/Modern/Pioneer/Vintage/
 *     cEDH/… (mtgtop8 majors corpus + the XMage sample decks). Every deck was
 *     validated against the version-matched card DB by builtin-decks.sh, so the
 *     transform here needs no card DB and is purely textual.
 *
 * Output: web/src/data/bundledDecks.generated.json — a `Deck`-shaped asset the
 * webui lazy-loads via Vite `?url` (see src/decks/bundledDecks.ts). Re-run this
 * and commit the result whenever the source corpus changes.
 *
 * The transform is the shared `parseBuiltinDeckList` (src/decks/builtinDecklist.ts),
 * so the generator and the tests/app cannot drift. Node >= 23 strips the TS on
 * import — no build step needed.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildBundledDecksFile } from '../src/decks/builtinDecklist.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const src = process.env.BUILTIN_DECKS_SRC || process.argv[2]
if (!src) {
  console.error('Set BUILTIN_DECKS_SRC or pass the path to the source builtin.json')
  process.exit(1)
}
const out = resolve(HERE, '../src/data/bundledDecks.generated.json')

const corpus = JSON.parse(readFileSync(src, 'utf8'))
const file = buildBundledDecksFile(corpus)

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(file))

const bytes = Buffer.byteLength(JSON.stringify(file))
const formats = Object.entries(file.manifest.byFormat)
  .sort((a, b) => b[1] - a[1])
  .map(([f, n]) => `${f}:${n}`)
  .join(' ')
console.log(`bundled decks: ${file.manifest.decks} ` +
  `(majors ${file.manifest.majors}, sample ${file.manifest.sample}) -> ${out}`)
console.log(`asset size: ${(bytes / 1e6).toFixed(2)} MB`)
console.log(`by format:  ${formats}`)
