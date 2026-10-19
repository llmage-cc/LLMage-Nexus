// Structural guard for the committed offline Scryfall image index
// (scryfall-cards / scryfall-printings / scryfall-token-arts.generated.json,
// built by scripts/build-scryfall-image-index.mjs at the repo root).
//
// The JSON files are read via fs + JSON.parse instead of `import`: the
// printings file is ~8 MB and a static import would make tsc/vitest parse it
// as a typed module on every build. Assertions stay sampled and structural —
// this guards shapes and key resolutions, it is not a data dump.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

function resolveDataDir(): string {
  const candidates = [HERE, path.join(process.cwd(), 'src', 'data'), path.join(process.cwd(), 'web', 'src', 'data')]
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'scryfall-cards.generated.json'))) return dir
  }
  throw new Error(`scryfall-*.generated.json not found; looked in ${candidates.join(', ')}`)
}

const DATA_DIR = resolveDataDir()

function loadGenerated<T>(fileName: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, fileName), 'utf8')) as T
}

interface CardsIndex {
  generatedAt: string
  cards: Record<string, string>
  backs: string[]
}
interface PrintingsIndex {
  generatedAt: string
  printings: Record<string, [string, string]>
}
interface TokenArt {
  id: string
  set: string
  num: string | null
  released: string | null
}
interface TokensIndex {
  generatedAt: string
  tokens: Record<string, TokenArt[]>
}

const UUID_RE = /^[0-9a-f-]{36}$/
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/

const cardsIndex = loadGenerated<CardsIndex>('scryfall-cards.generated.json')
const printingsIndex = loadGenerated<PrintingsIndex>('scryfall-printings.generated.json')
const tokensIndex = loadGenerated<TokensIndex>('scryfall-token-arts.generated.json')

describe('scryfall image index (generated)', () => {
  it('all three files parse and carry an ISO generatedAt timestamp', () => {
    for (const index of [cardsIndex, printingsIndex, tokensIndex]) {
      expect(index.generatedAt).toMatch(ISO_RE)
      expect(Number.isFinite(Date.parse(index.generatedAt))).toBe(true)
    }
  })

  it('cards: name -> uuid map with accent folding and a backs list', () => {
    const { cards, backs } = cardsIndex
    expect(Object.keys(cards).length).toBeGreaterThan(30_000)
    expect(cards['Lightning Bolt']).toMatch(UUID_RE)
    // XMage knows front-face names only.
    expect(cards['Delver of Secrets']).toMatch(UUID_RE)
    expect(backs).toContain('Delver of Secrets')
    // XMage names are accent-folded (Adéwalé -> Adewale).
    expect(cards['Adewale, Breaker of Chains']).toMatch(UUID_RE)
    expect(backs.every((name) => typeof name === 'string' && name.length > 0)).toBe(true)
  })

  it('printings: lowercased set/number -> [uuid, front name]', () => {
    const { printings } = printingsIndex
    const bolt = printings['m10/146']
    expect(bolt).toHaveLength(2)
    expect(bolt[0]).toMatch(UUID_RE)
    expect(bolt[1]).toBe('Lightning Bolt')
    // A modern-set printing resolves too.
    expect(printings['blb/120']).toHaveLength(2)
    expect(printings['blb/120'][0]).toMatch(UUID_RE)
    // Sampled sweep: every sampled value is [uuid, non-empty name] and keys
    // are fully lowercased (set codes + collector numbers).
    const keys = Object.keys(printings)
    const sampled = keys.filter((_, i) => i % 7919 === 0)
    expect(sampled.length).toBeGreaterThan(10)
    for (const key of sampled) {
      expect(key, `${key} lowercase`).toBe(key.toLowerCase())
      const value = printings[key]
      expect(value, key).toHaveLength(2)
      expect(value[0], `${key} uuid`).toMatch(UUID_RE)
      expect(typeof value[1] === 'string' && value[1].length > 0, `${key} name`).toBe(true)
    }
  })

  it('tokens: token name -> non-empty art list with CDN-resolvable uuids', () => {
    const { tokens } = tokensIndex
    for (const name of ['Soldier', 'Treasure', 'Wolf']) {
      const arts = tokens[name]
      expect(Array.isArray(arts), name).toBe(true)
      expect(arts.length, name).toBeGreaterThanOrEqual(1)
      for (const art of arts) {
        expect(art.id, `${name} art id`).toMatch(UUID_RE)
        expect(typeof art.set === 'string' && art.set.length > 0, `${name} art set`).toBe(true)
      }
    }
    // Every engine token name the UI can ask for comes from the keys of
    // tokenImages.generated.json (`SET/Name[/N]` and `SET/Name#back` -> Name);
    // at least one must resolve to art, and the common ones must.
    const tokenImages = loadGenerated<Record<string, string>>('tokenImages.generated.json')
    const engineNames = new Set<string>()
    for (const key of Object.keys(tokenImages)) {
      const slash = key.indexOf('/')
      if (slash < 0) continue
      engineNames.add(key.slice(slash + 1).replace(/#back$/, '').replace(/\/\d+$/, ''))
    }
    const resolved = [...engineNames].filter((name) => (tokens[name]?.length ?? 0) > 0)
    expect(resolved.length).toBeGreaterThan(0)
    expect(resolved).toContain('Soldier')
  })
})
