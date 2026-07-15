import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildCompiledHtml, type BuildRequest } from '../src/build'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixturesDir = path.join(here, 'fixtures')
const require = createRequire(import.meta.url)

const CSS_MARKER = '/* paperify-build-test-css */'

// Offline CSL style for tests; the real builder downloads (and caches) the
// CLI's default Zotero style instead.
const cslStyles = require('@citation-js/plugin-csl/lib/styles.json') as Record<
  string,
  string
>
const stubFetchCslXml = () => Promise.resolve(cslStyles.apa)

function build(markdown: string, overrides: Partial<BuildRequest> = {}) {
  return buildCompiledHtml({
    markdown,
    inputDir: fixturesDir,
    css: CSS_MARKER,
    fetchCslXml: stubFetchCslXml,
    ...overrides
  })
}

const doc = (body: string): string =>
  ['---', 'paperify: true', 'title: Build Test', '---', '', body, ''].join('\n')

const CITED_BODY = 'As shown in [@knuth1984texbook], typesetting matters.'
const BIBTEX_BLOCK = [
  '```bibtex',
  '@book{knuth1984texbook,',
  '  author    = {Knuth, Donald E.},',
  '  title     = {The TeXbook},',
  '  publisher = {Addison-Wesley},',
  '  year      = {1984}',
  '}',
  '```'
].join('\n')

describe('buildCompiledHtml', () => {
  it('produces a plain standalone document without webview-specific layers', async () => {
    const { html, warnings } = await build(doc('# Introduction\n\nMath: $E = mc^2$'))

    expect(warnings).toEqual([])
    expect(html).toContain('<h1 class="paper-title">Build Test</h1>')
    expect(html).toContain(CSS_MARKER)
    // KaTeX CSS and fonts are compiled in, exactly like the CLI.
    expect(html).toContain('class="katex"')
    expect(html).not.toContain('cdn.jsdelivr.net')
    // Webview-only processing must not leak into the shared pipeline.
    expect(html).not.toContain('Content-Security-Policy')
    expect(html).not.toContain('vscode-webview reset')
    expect(html).not.toContain('vscode-webview://')
    expect(html).not.toContain('<script')
  })

  it('surfaces frontmatter metadata for PDF header/footer templates', async () => {
    const markdown = [
      '---',
      'paperify: true',
      'title: Meta Test',
      'headerTemplate: "<div>header</div>"',
      'footerTemplate: "<div>footer</div>"',
      '---',
      '',
      'Body.',
      ''
    ].join('\n')

    const { meta } = await build(markdown)

    expect(meta.title).toBe('Meta Test')
    expect(meta.headerTemplate).toBe('<div>header</div>')
    expect(meta.footerTemplate).toBe('<div>footer</div>')
  })

  it('processes a terminal bibtex block through citeproc like the CLI', async () => {
    const { html, warnings } = await build(doc(`${CITED_BODY}\n\n${BIBTEX_BLOCK}`))

    expect(warnings).toEqual([])
    expect(html).toContain('class="citation"')
    expect(html).toContain('id="references"')
  })

  describe('lenient mode (preview)', () => {
    it('degrades citations without a bibliography to a warning', async () => {
      const { html, warnings } = await build(doc(CITED_BODY))

      expect(html).toContain('[@knuth1984texbook]')
      expect(warnings.some((w) => w.includes('no bibliography'))).toBe(true)
    })

    it('degrades a missing bibliography file to a warning', async () => {
      const markdown = [
        '---',
        'paperify: true',
        'bibliography: does-not-exist.bib',
        '---',
        '',
        CITED_BODY,
        ''
      ].join('\n')

      const { warnings } = await build(markdown, {
        documentPath: path.join(fixturesDir, 'paper.md')
      })

      expect(warnings.some((w) => w.includes('BibTeX file not found'))).toBe(true)
    })
  })

  describe('strict mode (PDF export)', () => {
    it('fails when citations have no bibliography', async () => {
      await expect(
        build(doc(CITED_BODY), { strictCitations: true })
      ).rejects.toThrow(/no bibliography/)
    })

    it('fails when the bibliography file is missing', async () => {
      const markdown = [
        '---',
        'paperify: true',
        'bibliography: does-not-exist.bib',
        '---',
        '',
        CITED_BODY,
        ''
      ].join('\n')

      await expect(
        build(markdown, {
          strictCitations: true,
          documentPath: path.join(fixturesDir, 'paper.md')
        })
      ).rejects.toThrow(/BibTeX file not found/)
    })

    it('fails when the citation style cannot be loaded', async () => {
      await expect(
        build(doc(`${CITED_BODY}\n\n${BIBTEX_BLOCK}`), {
          strictCitations: true,
          fetchCslXml: () => Promise.reject(new Error('offline'))
        })
      ).rejects.toThrow(/citation style could not be loaded/)
    })

    it('still resolves a valid sibling bibliography', async () => {
      const markdown = [
        '---',
        'paperify: true',
        'bibliography: refs.bib',
        '---',
        '',
        CITED_BODY,
        ''
      ].join('\n')

      const { html, warnings } = await build(markdown, {
        strictCitations: true,
        documentPath: path.join(fixturesDir, 'paper.md')
      })

      expect(warnings).toEqual([])
      expect(html).toContain('class="citation"')
    })
  })
})
