import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  renderNewsMarkdown,
  loadNewsCache,
  isNewsCacheFresh,
  hasUnseenNews,
  markNewsSeen,
  loadSeenNews,
  getNews,
  refreshNews,
  NEWS_TTL_MS,
  type NewsRelease,
} from './news'

const mk = (repo: 'nexus' | 'xmage', tag: string): NewsRelease => ({
  repo,
  tag,
  name: tag,
  body: 'body',
  url: `https://github.com/x/${tag}`,
  publishedAt: null,
})

describe('renderNewsMarkdown', () => {
  it('escapes HTML then renders bold, code, links and lists', () => {
    const html = renderNewsMarkdown('<script>alert(1)</script>\n**bold** and `code`\n- a\n- b\n[link](https://example.com)')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<code>code</code>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<a href="https://example.com" target="_blank"')
  })

  it('cannot break out of an href attribute with quotes', () => {
    const md = renderNewsMarkdown('[x](https://a.com/"onmouseover="alert(1))\nsee https://a.com/"autofocus onfocus="alert(1)\n[y](https://a.com/\'onclick=\'x)')
    const root = document.createElement('div')
    root.innerHTML = md
    const anchors = Array.from(root.querySelectorAll('a'))
    expect(anchors.length).toBe(3)
    for (const a of anchors) {
      expect(a.getAttributeNames().sort()).toEqual(['href', 'rel', 'target'])
    }
  })

  it('renders headings without allowing raw HTML injection', () => {
    const html = renderNewsMarkdown('## Title <img src=x>')
    expect(html).toContain('<h3>Title &lt;img src=x&gt;</h3>')
  })

  it('renders ATX headings and dash lists that end in CRLF', () => {
    const html = renderNewsMarkdown('## Title\r\n\r\n- one\r\n- two\r\n')
    expect(html).toContain('<h3>Title</h3>')
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>')
    expect(html).not.toContain('#')
    expect(html).not.toContain('\r')
  })

  it('normalises lone CR line endings too', () => {
    const html = renderNewsMarkdown('# A\r# B')
    expect(html).toContain('<h2>A</h2>')
    expect(html).toContain('<h2>B</h2>')
  })

  it('renders a pipe table instead of leaking its delimiters', () => {
    const html = renderNewsMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |\n')
    expect(html).toContain('<table><thead><tr><th>a</th><th>b</th></tr></thead>')
    expect(html).toContain('<tbody><tr><td>1</td><td>2</td></tr></tbody></table>')
    expect(html).not.toContain('|')
  })
})

// Excerpt of the REAL v0.4.6 release body (api.github.com/repos/Adamychen/xmage-nexus/releases).
// GitHub serves it with CRLF line endings, which is what defeated the `$`-anchored
// heading/list regexes before the renderer normalised them.
const REAL_V046_EXCERPT = [
  '## Download: pick ONE file, the one for your system',
  '',
  '| Your system | File | Size | Then |',
  '| --- | --- | --- | --- |',
  '| Windows 10/11 | `XMage Nexus_0.4.6_x64-setup.exe` | 9 MB | run the installer |',
  '| Linux (no install) | `XMage Nexus_0.4.6_amd64.AppImage` | 87 MB | chmod +x, then run it |',
  '',
  'You do not need to clone anything or run any command to play.',
  '',
  '**The other 21 files (742 MB) are not for you.** The `nexus-jre-*` tarballs are fetched automatically by the launcher on first run.',
  '',
  '<details><summary>What changed in v0.4.6</summary>',
  '',
  'Fix: Commander decks with a saved sideboard were rejected as having many commanders.',
  '',
  '</details>',
].join('\r\n')

describe('renderNewsMarkdown — real v0.4.6 release body (About → News regression)', () => {
  const html = renderNewsMarkdown(REAL_V046_EXCERPT)

  it('never lets markdown block syntax reach the DOM', () => {
    expect(html).not.toContain('##')
    expect(html).not.toContain('|')
    expect(html).not.toContain('\r')
  })

  it('renders the heading and the download table', () => {
    expect(html).toContain('<h3>Download: pick ONE file, the one for your system</h3>')
    expect(html).toContain('<th>Your system</th><th>File</th><th>Size</th><th>Then</th>')
    expect(html).toContain('<td><code>XMage Nexus_0.4.6_x64-setup.exe</code></td>')
    expect(html).toContain('<td>run the installer</td>')
  })

  it('renders inline emphasis and the details block', () => {
    expect(html).toContain('<strong>The other 21 files (742 MB) are not for you.</strong>')
    expect(html).toContain('<details><summary>What changed in v0.4.6</summary>')
    expect(html).toContain('</details>')
  })
})

describe('news cache and seen markers', () => {
  const mockStorage: Record<string, string> = {}

  beforeEach(() => {
    for (const k of Object.keys(mockStorage)) delete mockStorage[k]
    vi.unstubAllGlobals()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, value: string) => {
        mockStorage[key] = value
      },
      removeItem: (key: string) => {
        delete mockStorage[key]
      },
    })
  })

  it('fresh cache is served without network', async () => {
    const releases = [mk('nexus', 'v1')]
    mockStorage['mage-web-news-cache'] = JSON.stringify({ fetchedAt: Date.now(), releases })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { releases: out, offline } = await getNews()
    expect(out).toEqual(releases)
    expect(offline).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('stale cache triggers refresh and falls back offline', async () => {
    const releases = [mk('nexus', 'v1')]
    mockStorage['mage-web-news-cache'] = JSON.stringify({
      fetchedAt: Date.now() - NEWS_TTL_MS - 1,
      releases,
    })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const { releases: out, offline } = await getNews()
    expect(out).toEqual(releases)
    expect(offline).toBe(true)
  })

  it('refreshNews maps the GitHub API and truncates long bodies', async () => {
    const body = 'x'.repeat(5000)
    const json = (repo: string) =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve([
            { tag_name: 'v2', name: 'Two', body, html_url: `https://github.com/${repo}/r/v2`, published_at: '2026-09-01' },
          ]),
      })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => json(url.includes('xmage-nexus') ? 'nexus' : 'xmage')),
    )
    const out = await refreshNews()
    expect(out).toHaveLength(2)
    expect(out[0].body).toHaveLength(2000)
    expect(loadNewsCache()?.releases).toHaveLength(2)
  })

  it('tracks unseen releases per repo', () => {
    const releases = [mk('nexus', 'v2'), mk('xmage', 'xmage_1.4.62V1')]
    expect(hasUnseenNews(releases)).toBe(true)
    markNewsSeen(releases)
    expect(loadSeenNews()).toEqual({ nexus: 'v2', xmage: 'xmage_1.4.62V1' })
    expect(hasUnseenNews(releases)).toBe(false)
    expect(hasUnseenNews([mk('nexus', 'v3'), mk('xmage', 'xmage_1.4.62V1')])).toBe(true)
  })

  it('isNewsCacheFresh respects the 24h TTL', () => {
    expect(isNewsCacheFresh(null)).toBe(false)
    expect(isNewsCacheFresh({ fetchedAt: Date.now(), releases: [] })).toBe(true)
    expect(isNewsCacheFresh({ fetchedAt: Date.now() - NEWS_TTL_MS, releases: [] })).toBe(false)
  })
})
