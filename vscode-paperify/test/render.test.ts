import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  renderPreviewErrorHtml,
  renderPreviewHtml,
  type PreviewRenderResult
} from '../src/render'
import type { MermaidRenderer } from 'paperify/api'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixturesDir = path.join(here, 'fixtures')
const require = createRequire(import.meta.url)

const CSS_MARKER = '/* paperify-preview-test-css */'
const CSP_SOURCE = 'mock-csp-source'

// Offline CSL style for tests; the real renderer downloads (and caches) the
// CLI's default Zotero style instead.
const cslStyles = require('@citation-js/plugin-csl/lib/styles.json') as Record<
  string,
  string
>
const stubFetchCslXml = () => Promise.resolve(cslStyles.apa)

interface RenderOverrides {
  documentPath?: string
  fetchCslXml?: (styleId: string) => Promise<string>
  mermaidRenderer?: MermaidRenderer
}

function render(
  markdown: string,
  overrides: RenderOverrides = {}
): Promise<PreviewRenderResult> {
  return renderPreviewHtml({
    markdown,
    inputDir: fixturesDir,
    css: CSS_MARKER,
    cspSource: CSP_SOURCE,
    resolveResource: (absolutePath) => `vscode-webview://mock${absolutePath}`,
    fetchCslXml: stubFetchCslXml,
    ...overrides
  })
}

const doc = (body: string): string =>
  ['---', 'paperify: true', 'title: Preview Test', 'lang: ja', '---', '', body, ''].join('\n')

describe('preview rendering', () => {
  it('produces Paperify HTML with embedded CSS and frontmatter metadata', async () => {
    const { html } = await render(doc('# Introduction\n\n本文です。'))

    expect(html).toContain('<h1 class="paper-title">Preview Test</h1>')
    expect(html).toContain('<html lang="ja">')
    expect(html).toContain(CSS_MARKER)
    expect(html).toContain('<h1 id="introduction">Introduction</h1>')
    // The opt-in flag itself must never surface in the output.
    expect(html).not.toContain('paperify: true')
  })

  it('injects a strict CSP that forbids scripts', async () => {
    const { html } = await render(doc('Body.'))

    expect(html).toContain('http-equiv="Content-Security-Policy"')
    expect(html).toContain("default-src 'none'")
    expect(html).toContain("script-src 'none'")
    expect(html).toContain(`media-src ${CSP_SOURCE}`)
  })

  it('renders math as static KaTeX HTML with inlined CSS and fonts', async () => {
    const { html } = await render(doc('Math: $E = mc^2$'))

    expect(html).toContain('class="katex"')
    expect(html).toContain('data:font/woff2;base64,')
    expect(html).not.toContain('cdn.jsdelivr.net')
  })

  it('keeps GFM tables and static code highlighting', async () => {
    const body = [
      '| a | b |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      '```js',
      'const x = 1',
      '```'
    ].join('\n')
    const { html } = await render(doc(body))

    expect(html).toContain('<table>')
    expect(html).toContain('hljs')
    expect(html).not.toContain('<script')
  })

  it('keeps Mermaid diagrams static under the script-free CSP', async () => {
    const mermaidRenderer: MermaidRenderer = async () => [
      {
        ok: true,
        value: {
          svg: '<svg xmlns="http://www.w3.org/2000/svg"><desc>Preview diagram</desc></svg>',
          description: 'Preview diagram'
        }
      }
    ]
    const { html, warnings } = await render(
      doc('```mermaid\ngraph TD\nA-->B\n```'),
      { mermaidRenderer }
    )

    expect(warnings).toEqual([])
    expect(html).toContain('class="image-figure mermaid-figure"')
    expect(html).toContain('src="data:image/svg+xml;base64,')
    expect(html).toContain("script-src 'none'")
    expect(html).not.toContain('<script')
  })

  it('inlines local images and video posters as data URIs', async () => {
    const body = [
      '![A figure](media/figure.svg)',
      '',
      '::video{src="media/demo.mp4" poster="media/poster.svg" caption="Demo"}'
    ].join('\n')
    const { html, warnings } = await render(doc(body))

    expect(warnings).toEqual([])
    expect(html).toContain('src="data:image/svg+xml;base64,')
    expect(html).toContain('poster="data:image/svg+xml;base64,')
  })

  it('rewrites local video sources to webview resource URIs', async () => {
    const { html } = await render(doc('::video{src="media/demo.mp4"}'))

    const expected = `vscode-webview://mock${path.join(fixturesDir, 'media', 'demo.mp4')}`
    expect(html).toContain(`src="${expected}"`)
    expect(html).not.toContain('src="media/demo.mp4"')
  })

  it('treats missing assets as warnings, not failures', async () => {
    const body = [
      '![Missing](media/nope.png)',
      '',
      '::video{src="media/nope.mp4"}'
    ].join('\n')
    const { html, warnings } = await render(doc(body))

    expect(html).toContain('src="media/nope.png"')
    expect(html).toContain('src="media/nope.mp4"')
    expect(warnings.some((w) => w.includes('media/nope.png'))).toBe(true)
    expect(warnings.some((w) => w.includes('media/nope.mp4'))).toBe(true)
  })

  it('drops raw HTML by default', async () => {
    const body = [
      'Before.',
      '',
      '<script>alert(1)</script>',
      '',
      '<img src="x" onerror="alert(2)">',
      '',
      'After.'
    ].join('\n')
    const { html } = await render(doc(body))

    expect(html).not.toContain('<script')
    expect(html).not.toContain('onerror')
    expect(html).toContain('Before.')
    expect(html).toContain('After.')
  })

  it('rejects on invalid frontmatter YAML', async () => {
    await expect(
      render('---\npaperify: true\ntitle: [unclosed\n---\nbody\n')
    ).rejects.toThrow()
  })

  it('reverts VS Code webview default styles ahead of the Paperify stylesheet', async () => {
    const { html } = await render(doc('> A quote.\n\nAnd `code`.'))

    expect(html).toContain('vscode-webview reset')
    expect(html).toContain('blockquote { background: revert; border-color: revert; }')
    // The reset must come first so paperify.css keeps the final word.
    expect(html.indexOf('vscode-webview reset')).toBeLessThan(
      html.indexOf(CSS_MARKER)
    )
  })
})

describe('citations', () => {
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

  it('processes a terminal bibtex block through citeproc like the CLI', async () => {
    const { html, warnings } = await render(doc(`${CITED_BODY}\n\n${BIBTEX_BLOCK}`))

    expect(warnings).toEqual([])
    expect(html).toContain('class="citation"')
    expect(html).toContain('id="references"')
    expect(html).toContain('paper-references')
    expect(html).toContain('Knuth')
    // The bibtex source block must be consumed, not shown as code.
    expect(html).not.toContain('language-bibtex')
    expect(html).not.toContain('@book{')
  })

  it('resolves a frontmatter bibliography path relative to the document', async () => {
    const markdown = [
      '---',
      'paperify: true',
      'title: Bib Test',
      'bibliography: refs.bib',
      '---',
      '',
      CITED_BODY,
      ''
    ].join('\n')
    const { html, warnings } = await render(markdown, {
      documentPath: path.join(fixturesDir, 'paper.md')
    })

    expect(warnings).toEqual([])
    expect(html).toContain('class="citation"')
    expect(html).toContain('id="references"')
  })

  it('warns instead of failing when citations have no bibliography', async () => {
    const { html, warnings } = await render(doc(CITED_BODY))

    expect(html).toContain('[@knuth1984texbook]')
    expect(warnings.some((w) => w.includes('no bibliography'))).toBe(true)
  })

  it('warns instead of failing when a frontmatter bibliography file is missing', async () => {
    const markdown = [
      '---',
      'paperify: true',
      'bibliography: does-not-exist.bib',
      '---',
      '',
      CITED_BODY,
      ''
    ].join('\n')
    const { html, warnings } = await render(markdown, {
      documentPath: path.join(fixturesDir, 'paper.md')
    })

    expect(html).toContain('[@knuth1984texbook]')
    expect(warnings.some((w) => w.includes('BibTeX file not found'))).toBe(true)
  })

  it('degrades to a warning when the CSL style cannot be downloaded', async () => {
    const { html, warnings } = await render(doc(`${CITED_BODY}\n\n${BIBTEX_BLOCK}`), {
      fetchCslXml: () => Promise.reject(new Error('offline'))
    })

    expect(html).toContain('Preview Test')
    expect(warnings.some((w) => w.includes('citations disabled'))).toBe(true)
  })
})

describe('preview error screen', () => {
  it('shows the message without a stack trace and keeps the CSP', () => {
    const html = renderPreviewErrorHtml(
      'YAML parse error: <unexpected token>',
      CSP_SOURCE
    )

    expect(html).toContain('Paperify could not render this document')
    expect(html).toContain('YAML parse error: &lt;unexpected token&gt;')
    expect(html).toContain("script-src 'none'")
    expect(html).not.toContain('at Object.')
  })
})
