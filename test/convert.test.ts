import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { convert } from '../src/convert.js'
import { parseFrontmatter } from '../src/frontmatter.js'
import { inferVideoType } from '../src/transforms/videoDirective.js'
import type { MermaidRenderer } from '../src/mermaid.js'
import { BrowserLaunchError } from '../src/pdf.js'
import { renderDocument } from '../src/template.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const fixture = (name: string): string =>
  fs.readFileSync(path.join(here, 'fixtures', name), 'utf8')
const css = fs.readFileSync(
  path.join(here, '..', 'styles', 'paperify.css'),
  'utf8'
)
const cslStyles = require('@citation-js/plugin-csl/lib/styles.json') as Record<
  string,
  string
>
const apaCsl = cslStyles.apa

describe('frontmatter parsing', () => {
  it('parses and normalizes all standard fields', () => {
    const { meta, content } = parseFrontmatter(fixture('minimal.md'))
    expect(meta.title).toBe('Minimal Paper')
    expect(meta.authors).toEqual([
      {
        name: 'Test Author',
        affiliation: 'Test University',
        email: 'test@example.edu'
      }
    ])
    expect(meta.date).toBe('2026-07-04')
    expect(meta.abstract).toContain('A short abstract')
    expect(meta.keywords).toEqual(['testing', 'markdown'])
    expect(content).not.toContain('title:')
    expect(content).toContain('# Section One')
  })

  it('handles missing frontmatter gracefully', () => {
    const { meta, content } = parseFrontmatter('# Just a heading\n\nBody.\n')
    expect(meta.title).toBeUndefined()
    expect(meta.authors).toEqual([])
    expect(meta.keywords).toEqual([])
    expect(content).toContain('# Just a heading')
  })

  it('keeps a leading thematic break without a closing YAML delimiter', () => {
    const source = '---\n\n# A paper\n'
    expect(parseFrontmatter(source).content).toBe(source)
  })

  it('accepts only YAML frontmatter, including with a BOM and CRLF', () => {
    const json = '---json\n{"paperify": true}\n---\nBody'
    expect(parseFrontmatter(json).content).toBe(json)
    expect(parseFrontmatter(json).meta.paperify).toBeUndefined()
    const yaml = parseFrontmatter(
      '\uFEFF---  YML  \r\npaperify: true\r\n---draft: yes\r\n---  \r\nBody'
    )
    expect(yaml.meta.paperify).toBe(true)
    expect(yaml.content).toBe('Body')
  })

  it('consistently rejects malformed YAML on repeated preview builds', () => {
    const source = '---\ntitle: [incomplete\n---\nBody'
    for (let i = 0; i < 2; i++) {
      expect(() => parseFrontmatter(source)).toThrow()
    }
  })

  it('normalizes string authors and comma-separated keywords', () => {
    const src = '---\nauthors: "Solo Author"\nkeywords: "a, b, c"\n---\ntext\n'
    const { meta } = parseFrontmatter(src)
    expect(meta.authors).toEqual([{ name: 'Solo Author' }])
    expect(meta.keywords).toEqual(['a', 'b', 'c'])
  })

  it('normalizes YAML date objects to YYYY-MM-DD', () => {
    const src = '---\ntitle: T\ndate: 2026-07-04\n---\ntext\n'
    const { meta } = parseFrontmatter(src)
    expect(meta.date).toBe('2026-07-04')
  })

  it('preserves PDF header and footer templates', () => {
    const src = [
      '---',
      'headerTemplate: |',
      '  <div style="font-size:8px"><span class="title"></span></div>',
      'footerTemplate: |',
      '  <div style="font-size:8px">',
      '    <span class="pageNumber"></span>/<span class="totalPages"></span>',
      '  </div>',
      '---',
      'text'
    ].join('\n')
    const { meta } = parseFrontmatter(src)
    expect(meta.headerTemplate).toBe(
      '<div style="font-size:8px"><span class="title"></span></div>'
    )
    expect(meta.footerTemplate).toContain('class="pageNumber"')
    expect(meta.footerTemplate).toContain('class="totalPages"')
  })

  it('normalizes language metadata aliases', () => {
    const direct = parseFrontmatter('---\nlang: ja\n---\ntext\n')
    const alias = parseFrontmatter('---\nlanguage: ja-JP\n---\ntext\n')

    expect(direct.meta.lang).toBe('ja')
    expect(alias.meta.lang).toBe('ja-JP')
  })

  it('normalizes the bibliography metadata field', () => {
    const { meta } = parseFrontmatter(
      '---\nbibliography: references/paper.bib\n---\ntext\n'
    )

    expect(meta.bibliography).toBe('references/paper.bib')
  })

  it.each([
    ['8.5', '8.5pt'],
    ['9', '9pt'],
    ['" 8.50pt "', '8.5pt'],
    ['".5pt"', '0.5pt']
  ])('normalizes print math size %s to an absolute point size', (value, expected) => {
    const { meta } = parseFrontmatter(`---\nprintMathSize: ${value}\n---\nbody\n`)
    expect(meta.printMathSize).toBe(expected)
  })

  it.each([
    '0', '-1', '.inf', '.nan', 'false', 'null', '[]', '{}',
    '"8.5"', '"8.5em"', '"8.5vw"', '"-8.5pt"', '"0pt"',
    '"NaNpt"', '"Infinitypt"', '"1e999pt"',
    '"8pt; color: red"',
    '"8pt; } }</style><script>alert(1)</script>"'
  ])('ignores invalid print math size %s', (value) => {
    const { meta } = parseFrontmatter(`---\nprintMathSize: ${value}\n---\nbody\n`)
    expect(meta.printMathSize).toBeUndefined()
  })

  it('accepts only the YAML boolean true for the paperify flag', () => {
    const flagged = parseFrontmatter('---\npaperify: true\n---\ntext\n')
    expect(flagged.meta.paperify).toBe(true)

    const disabled = parseFrontmatter('---\npaperify: false\n---\ntext\n')
    expect(disabled.meta.paperify).toBeUndefined()

    const stringValue = parseFrontmatter('---\npaperify: "true"\n---\ntext\n')
    expect(stringValue.meta.paperify).toBeUndefined()

    const absent = parseFrontmatter('---\ntitle: T\n---\ntext\n')
    expect(absent.meta.paperify).toBeUndefined()
  })

  it('never renders the paperify flag into the generated HTML', async () => {
    const { html } = await convert(
      '---\npaperify: true\ntitle: Flagged\n---\n\nBody.\n'
    )
    expect(html).toContain('<h1 class="paper-title">Flagged</h1>')
    expect(html).not.toContain('paperify: true')
  })
})

describe('basic Markdown conversion', () => {
  it('converts headings, emphasis, code, and links', async () => {
    const { contentHtml } = await convert(fixture('minimal.md'))
    expect(contentHtml).toContain('<h1 id="section-one">Section One</h1>')
    expect(contentHtml).toContain('<h2 id="section-two">Section Two</h2>')
    expect(contentHtml).toContain('<strong>bold</strong>')
    expect(contentHtml).toContain('<em>italic</em>')
    expect(contentHtml).toContain('<code>inline code</code>')
    expect(contentHtml).toContain('href="https://example.com"')
  })

  it('generates stable heading IDs', async () => {
    const a = await convert('## Repeatable Heading\n')
    const b = await convert('## Repeatable Heading\n')
    expect(a.contentHtml).toContain('id="repeatable-heading"')
    expect(a.contentHtml).toBe(b.contentHtml)
  })

  it('supports GFM tables and footnotes', async () => {
    const md = '| a | b |\n| - | - |\n| 1 | 2 |\n\ntext[^1]\n\n[^1]: note\n'
    const { contentHtml } = await convert(md)
    expect(contentHtml).toContain('<table>')
    expect(contentHtml).toContain('<th>a</th>')
    expect(contentHtml).toContain('class="footnotes"')
    expect(contentHtml).toContain('data-footnote-ref')
  })

  it('highlights fenced code blocks from their language tag', async () => {
    const highlighted = await convert('```ts\nconst answer: number = 42\n```\n')
    expect(highlighted.contentHtml).toContain(
      '<code class="hljs language-ts">'
    )
    expect(highlighted.contentHtml).toContain('hljs-keyword')
    expect(highlighted.contentHtml).toContain('hljs-number')

    const plain = await convert('```\nconst answer = 42\n```\n')
    expect(plain.contentHtml).toContain('<pre><code>const answer = 42')
    expect(plain.contentHtml).not.toContain('hljs')
  })
})

describe('Mermaid diagrams', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40">' +
    '<title>System flow</title><desc>Request flows from A to B</desc>' +
    '<path d="M0 20h100"/></svg>'

  it('renders a Mermaid fence as a static semantic image figure', async () => {
    const renderer: MermaidRenderer = async (definitions) => {
      expect(definitions).toEqual(['graph TD\n  A-->B'])
      return [
        {
          ok: true,
          value: {
            svg,
            title: 'System flow',
            description: 'Request flows from A to B'
          }
        }
      ]
    }

    const { contentHtml, html, assets, warnings } = await convert(
      '```mermaid\ngraph TD\n  A-->B\n```\n',
      { mermaid: { renderer } }
    )

    expect(warnings).toEqual([])
    expect(contentHtml).toContain(
      '<figure class="image-figure mermaid-figure">'
    )
    expect(contentHtml).toContain('src="data:image/svg+xml;base64,')
    expect(contentHtml).toContain('alt="Request flows from A to B"')
    expect(contentHtml).toContain('title="System flow"')
    expect(contentHtml).not.toContain('language-mermaid')
    expect(contentHtml).not.toContain('graph TD')
    expect(html).not.toContain('<script')
    expect(assets).toEqual([])
  })

  it('batches multiple Mermaid fences in source order', async () => {
    const calls: string[][] = []
    const renderer: MermaidRenderer = async (definitions) => {
      calls.push([...definitions])
      return definitions.map((definition) => ({
        ok: true,
        value: { svg: svg.replace('System flow', definition) }
      }))
    }

    const result = await convert(
      '```mermaid\ngraph LR\nA-->B\n```\n\n```mermaid\nsequenceDiagram\nA->>B: Hi\n```\n',
      { mermaid: { renderer } }
    )

    expect(calls).toEqual([
      ['graph LR\nA-->B', 'sequenceDiagram\nA->>B: Hi']
    ])
    expect(result.contentHtml.match(/class="image-figure mermaid-figure"/g)).toHaveLength(2)
  })

  it('preserves generated Mermaid SVGs when raw HTML is sanitized', async () => {
    const renderer: MermaidRenderer = async () => [{ ok: true, value: { svg } }]
    const { contentHtml } = await convert(
      '```mermaid\ngraph TD\nA-->B\n```\n\n<img src="data:text/plain,raw" alt="raw">',
      { mermaid: { renderer }, unsafeHtml: true }
    )
    expect(contentHtml).toContain('src="data:image/svg+xml;base64,')
    expect(contentHtml).toContain('<img alt="raw">')
  })

  it('keeps mixed preformatted HTML with a Mermaid code child intact', async () => {
    const { contentHtml } = await convert(
      '<pre><code class="language-mermaid">graph TD</code><em>annotation</em></pre>',
      { mermaid: { renderer: async () => [] }, unsafeHtml: true }
    )
    expect(contentHtml).toContain('<em>annotation</em></pre>')
  })

  it('keeps source code and warns when no renderer is provided', async () => {
    const { contentHtml, warnings } = await convert(
      '```mermaid\ngraph TD\nA-->B\n```\n'
    )

    expect(contentHtml).toContain('class="hljs language-mermaid"')
    expect(contentHtml).toContain('graph TD')
    expect(warnings.join(' ')).toContain('no Mermaid renderer')
  })

  it('keeps source code in warn mode when Mermaid syntax is invalid', async () => {
    const renderer: MermaidRenderer = async () => [
      { ok: false, error: 'Parse error on line 1' }
    ]
    const { contentHtml, warnings } = await convert(
      '```mermaid\nnot a diagram\n```\n',
      { mermaid: { renderer, failureMode: 'warn' } }
    )

    expect(contentHtml).toContain('not a diagram')
    expect(warnings.join(' ')).toContain('Parse error on line 1')
  })

  it('fails strict builds when Mermaid syntax is invalid', async () => {
    const renderer: MermaidRenderer = async () => [
      { ok: false, error: 'Parse error on line 1' }
    ]

    await expect(
      convert('```mermaid\nnot a diagram\n```\n', {
        mermaid: { renderer, failureMode: 'error' }
      })
    ).rejects.toThrow(/Parse error on line 1/)
  })

  it('preserves browser launch errors for host-specific recovery', async () => {
    const launchError = new BrowserLaunchError('Could not find Chrome')
    const renderer: MermaidRenderer = async () => {
      throw launchError
    }

    await expect(
      convert('```mermaid\ngraph TD\nA-->B\n```\n', {
        mermaid: { renderer, failureMode: 'error' }
      })
    ).rejects.toBe(launchError)
  })
})

describe('math rendering', () => {
  it('renders inline and display math statically with KaTeX', async () => {
    const { contentHtml, html } = await convert(fixture('math.md'))
    // Inline math
    expect(contentHtml).toContain('class="katex"')
    // Display math
    expect(contentHtml).toContain('katex-display')
    // No leftover unprocessed math markers
    expect(contentHtml).not.toContain('math-inline')
    expect(contentHtml).not.toContain('$$')
    // Static rendering: KaTeX CSS is referenced, no scripts required
    expect(html).toContain('katex.min.css')
    expect(html).not.toContain('<script')
  })

  it('omits the KaTeX stylesheet when the document has no math', async () => {
    const { html } = await convert('# No math here\n')
    expect(html).not.toContain('katex.min.css')
  })

  it.each(['link', 'embed'] as const)(
    'applies one print-only math size after the %s stylesheet',
    async (mode) => {
      const { html, contentHtml, meta } = await convert(
        '---\nprintMathSize: 8\n---\nInline $x$ math.\n\n$$\ny = x^2\n$$\n',
        { css: mode === 'link' ? { mode, href: 'paperify.css' } : { mode, content: css } }
      )
      const override = '@media print { :root { --print-math-size: 8pt; } }'
      const stylesheet = mode === 'link' ? 'href="paperify.css"' : css
      expect(meta.printMathSize).toBe('8pt')
      expect(html).toContain(override)
      expect(html.indexOf(override)).toBeGreaterThan(html.indexOf(stylesheet))
      expect(contentHtml).toContain('class="katex"')
      expect(contentHtml).toContain('class="katex-display"')
      expect(html).not.toContain('<script')
    }
  )

  it('omits a document math size override when no size is supplied', async () => {
    const { html } = await convert('Inline $x$ math.\n')
    expect(html).not.toContain('--print-math-size')
  })

  it('rejects CSS and HTML injection from frontmatter and direct template callers', async () => {
    const maliciousSize = '8pt; } }</style><script>alert(1)</script>'
    const { html } = await convert(
      `---\nprintMathSize: "${maliciousSize}"\n---\n$x$\n`
    )
    const directHtml = renderDocument({
      meta: { authors: [], keywords: [], printMathSize: maliciousSize },
      contentHtml: '<p>Body</p>',
      lang: 'en',
      css: { mode: 'link', href: 'paperify.css' },
      hasMath: false
    })
    for (const document of [html, directHtml]) {
      expect(document).not.toContain('--print-math-size')
      expect(document).not.toContain('<script')
      expect(document).not.toContain(maliciousSize)
    }
  })
})

describe('citations', () => {
  const bibtex = [
    '@book{knuth1984texbook,',
    '  author = {Knuth, Donald E.},',
    '  title = {The TeXbook},',
    '  publisher = {Addison-Wesley},',
    '  year = {1984}',
    '}',
    '',
    '@book{lamport1994latex,',
    '  author = {Lamport, Leslie},',
    '  title = {LaTeX: A Document Preparation System},',
    '  publisher = {Addison-Wesley},',
    '  year = {1994}',
    '}'
  ].join('\n')

  it('resolves BibTeX citation keys and appends a bibliography', async () => {
    const { contentHtml } = await convert('See [@knuth1984texbook].\n', {
      citations: { bibtex, cslXml: apaCsl }
    })

    expect(contentHtml).toContain(
      '<a class="citation" data-cites="knuth1984texbook" href="#ref-knuth1984texbook">'
    )
    expect(contentHtml).toContain('(Knuth, 1984)')
    expect(contentHtml).toContain('<section class="paper-references" id="references">')
    expect(contentHtml).toContain('id="ref-knuth1984texbook" class="csl-entry"')
    expect(contentHtml).toContain('The TeXbook')
  })

  it('supports multiple keys in one citation cluster', async () => {
    const { contentHtml } = await convert(
      'Compare [@knuth1984texbook; @lamport1994latex].\n',
      { citations: { bibtex, cslXml: apaCsl } }
    )

    expect(contentHtml).toContain(
      'data-cites="knuth1984texbook lamport1994latex"'
    )
    expect(contentHtml).toContain('href="#ref-knuth1984texbook"')
    expect(contentHtml).toContain('id="ref-lamport1994latex" class="csl-entry"')
    expect(contentHtml).toContain('Knuth, 1984')
    expect(contentHtml).toContain('Lamport, 1994')
  })

  it.each([false, true])('keeps citation markup out of link destinations and heading IDs (unsafeHtml=%s)', async (unsafeHtml) => {
    const literal = 'PAPERIFY_CITATION_PLACEHOLDER_1_'
    const markdown = [
      '# Findings [@knuth1984texbook]',
      `[See *work [@knuth1984texbook]*](report/${literal})`,
      literal
    ].join('\n\n')
    const { contentHtml } = await convert(markdown, {
      citations: { bibtex, cslXml: apaCsl }, unsafeHtml
    })

    expect(contentHtml).toContain('<h1 id="findings-knuth-1984">Findings <a class="citation"')
    expect(contentHtml).toContain(
      `<a href="report/${literal}">See <em>work <span class="citation" data-cites="knuth1984texbook">(Knuth, 1984)</span></em></a>`
    )
    expect(contentHtml).toContain(`<p>${literal}</p>`)
  })

  it('fails clearly for unknown citation keys', async () => {
    await expect(
      convert('Missing [@missing].\n', {
        citations: { bibtex, cslXml: apaCsl }
      })
    ).rejects.toThrow('Citation key not found in BibTeX: missing')
  })
})

describe('image figures', () => {
  it('converts image-only paragraphs into figures with captions', async () => {
    const { contentHtml } = await convert(fixture('figure.md'))
    expect(contentHtml).toContain('<figure class="image-figure">')
    expect(contentHtml).toContain(
      '<img src="images/plot.png" alt="A caption from alt text">'
    )
    expect(contentHtml).toContain(
      '<figcaption>A caption from alt text</figcaption>'
    )
  })

  it('does not emit an empty caption when alt text is missing', async () => {
    const { contentHtml } = await convert('![](images/no-alt.png)\n')
    expect(contentHtml).toContain('<figure class="image-figure">')
    expect(contentHtml).not.toContain('<figcaption></figcaption>')
    expect(contentHtml).not.toContain('<figcaption>')
  })

  it('leaves inline images inside text paragraphs untouched', async () => {
    const { contentHtml } = await convert('See ![icon](i.png) inline.\n')
    expect(contentHtml).toContain('<p>')
    expect(contentHtml).not.toContain('<figure')
  })

  it('promotes reference-style images and preserves their titles and paths', async () => {
    const { contentHtml, assets } = await convert(
      '![Plot][figure]\n\nSee ![icon][figure] inline.\n\n[figure]: <a b.png> "Graph"'
    )
    expect(contentHtml).toContain('<figure class="image-figure"><img src="a%20b.png" alt="Plot" title="Graph"><figcaption>Plot</figcaption></figure>')
    expect(contentHtml).toContain('<p>See <img src="a%20b.png" alt="icon" title="Graph"> inline.</p>')
    expect(assets).toEqual(['a%20b.png'])
  })
})

describe('figure directive', () => {
  it('converts ::figure directives with wide support', async () => {
    const { contentHtml } = await convert(fixture('figure.md'))
    expect(contentHtml).toContain('class="image-figure wide"')
    expect(contentHtml).toContain('src="images/system.png"')
    expect(contentHtml).toContain('alt="System diagram"')
    expect(contentHtml).toContain('<figcaption>System overview</figcaption>')
  })

  it('warns and drops a figure directive without src', async () => {
    const { contentHtml, warnings } = await convert('::figure{alt="x"}\n')
    expect(contentHtml).not.toContain('<figure')
    expect(warnings.join(' ')).toContain('missing a src')
  })
})

describe('video directive', () => {
  it('emits a semantic video figure with source and poster', async () => {
    const { contentHtml } = await convert(fixture('video.md'))
    expect(contentHtml).toContain('class="media-figure video-figure"')
    expect(contentHtml).toContain('<video controls')
    expect(contentHtml).toContain('poster="media/demo-poster.png"')
    expect(contentHtml).toContain(
      '<source src="media/demo.mp4" type="video/mp4">'
    )
    expect(contentHtml).toContain('<figcaption>Demo video</figcaption>')
    // Print fallback with poster image and readable source link
    expect(contentHtml).toContain('video-print-fallback')
    expect(contentHtml).toContain('Video available at:')
  })

  it('supports loop/muted and infers webm MIME type', async () => {
    const { contentHtml } = await convert(fixture('video.md'))
    expect(contentHtml).toContain('type="video/webm"')
    expect(contentHtml).toContain('loop')
    expect(contentHtml).toContain('muted')
    // No poster: placeholder box instead
    expect(contentHtml).toContain('video-placeholder')
  })

  it('warns and drops a video directive without src', async () => {
    const { contentHtml, warnings } = await convert('::video{caption="x"}\n')
    expect(contentHtml).not.toContain('<video')
    expect(warnings.join(' ')).toContain('missing a src')
  })

  it('infers MIME types from extensions', () => {
    expect(inferVideoType('a.mp4')).toBe('video/mp4')
    expect(inferVideoType('a.webm')).toBe('video/webm')
    expect(inferVideoType('a.ogv')).toBe('video/ogg')
    expect(inferVideoType('a.unknown')).toBeUndefined()
  })
})

describe('raw HTML handling', () => {
  it('filters unsafe URLs in Markdown links and video fallbacks by default', async () => {
    const { contentHtml } = await convert([
      '[unused](JaVaScRiPt:) and [data](data:text/plain,preview)',
      '::video{src="JaVaScRiPt:"}',
      '[local](docs/guide.md) [section](#section) [email](mailto:editor@example.org)',
      '![image](data:image/png;base64,AA==)'
    ].join('\n\n'))
    expect(contentHtml).toContain('<a>unused</a> and <a>data</a>')
    expect(contentHtml).toContain('<source>')
    expect(contentHtml).not.toMatch(/(?:href|src)="javascript:/i)
    expect(contentHtml).toContain('href="docs/guide.md"')
    expect(contentHtml).toContain('href="#section"')
    expect(contentHtml).toContain('href="mailto:editor@example.org"')
    expect(contentHtml).toContain('src="data:image/png;base64,AA=="')
  })

  it('drops raw HTML by default', async () => {
    const { contentHtml } = await convert(
      'before\n\n<video src="x.mp4"></video>\n\nafter\n'
    )
    expect(contentHtml).not.toContain('<video')
  })

  it('sanitizes raw HTML when unsafe mode is enabled', async () => {
    const md = [
      'text with <em>allowed emphasis</em> here',
      '',
      '<video controls src="media/x.mp4"></video>',
      '',
      '<script>alert(1)</script>',
      '',
      '<img src="ok.png" onerror="alert(1)" alt="pic">',
      '',
      '<a href="javascript:alert(1)">bad link</a>'
    ].join('\n')
    const { contentHtml } = await convert(md, { unsafeHtml: true })
    expect(contentHtml).toContain('<em>allowed emphasis</em>')
    expect(contentHtml).toContain('<video controls src="media/x.mp4">')
    expect(contentHtml).not.toContain('<script')
    expect(contentHtml).not.toContain('alert(1)</script>')
    expect(contentHtml).not.toContain('onerror')
    expect(contentHtml).not.toContain('javascript:')
    expect(contentHtml).toContain('<img src="ok.png"')
  })

  it('still renders math correctly in unsafe mode', async () => {
    const { contentHtml } = await convert('Inline $a^2 + b^2 = c^2$ math.\n', {
      unsafeHtml: true
    })
    expect(contentHtml).toContain('class="katex"')
  })

  it('preserves footnote navigation and links to sanitized IDs', async () => {
    const { contentHtml } = await convert(
      'See [section](#%C3%A9) and note[^1] twice[^1].\n\n' +
      '<span id="é">Section</span>\n\n[^1]: Note.',
      { unsafeHtml: true }
    )
    const links = [...contentHtml.matchAll(/href="#([^"]+)"/g)]
    expect(links).toHaveLength(5)
    for (const [, fragment] of links) {
      expect(contentHtml).toContain(`id="${decodeURIComponent(fragment)}"`)
    }
  })
})

describe('stylesheet', () => {
  it('contains a print media block', () => {
    expect(css).toContain('@media print')
    expect(css).toContain('@page')
    expect(css).toContain('size: A4')
  })

  it('defines a two-column print layout for the article body', () => {
    expect(css).toContain('column-count: 2')
    expect(css).toContain('column-gap')
    expect(css).toContain('column-span: all')
    expect(css).toContain('break-inside: avoid')
  })

  it('exposes the documented CSS variables', () => {
    for (const v of [
      '--font-body',
      '--font-mono',
      '--paper-width',
      '--body-size',
      '--line-height',
      '--text-color',
      '--muted-color',
      '--rule-color',
      '--accent-color',
      '--syntax-keyword',
      '--syntax-string'
    ]) {
      expect(css).toContain(v)
    }
  })

  it('defines Japanese font variables from the document language', () => {
    expect(css).toContain(':root:lang(ja)')
    expect(css).toContain(
      '--font-body: "Noto Serif JP", "Hiragino Mincho ProN", "Yu Mincho", serif'
    )
    expect(css).toContain(
      '--font-heading: "Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif'
    )
  })

  it('styles highlight.js token classes', () => {
    expect(css).toContain('.paper-content pre code.hljs')
    expect(css).toContain('.paper-content .hljs-keyword')
    expect(css).toContain('.paper-content .hljs-string')
  })

  it('does not override syntax colors in print styles', () => {
    const printCss = css.slice(css.lastIndexOf('@media print {'))
    expect(printCss).not.toContain('--syntax-')
  })
})

describe('generated document structure', () => {
  it('emits the expected semantic skeleton', async () => {
    const { html } = await convert(fixture('minimal.md'))
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('<meta charset="utf-8">')
    expect(html).toContain('<main class="paper">')
    expect(html).toContain('<header class="paper-header">')
    expect(html).toContain('<h1 class="paper-title">Minimal Paper</h1>')
    expect(html).toContain('<section class="paper-authors">')
    expect(html).toContain('<span class="author-name">Test Author</span>')
    expect(html).toContain('<p class="paper-date">2026-07-04</p>')
    expect(html).toContain('<section class="paper-abstract">')
    expect(html).toContain('<section class="paper-keywords">')
    expect(html).toContain('<article class="paper-content">')
    expect(html).toContain('<title>Minimal Paper</title>')
  })

  it('uses frontmatter language for the html lang attribute', async () => {
    const { html } = await convert('---\nlang: ja\n---\nbody\n')

    expect(html).toContain('<html lang="ja">')
  })

  it('supports the language frontmatter alias', async () => {
    const { html } = await convert('---\nlanguage: ja-JP\n---\nbody\n')

    expect(html).toContain('<html lang="ja-JP">')
  })

  it('escapes metadata safely', async () => {
    const md = '---\ntitle: "Tags <b> & \\"quotes\\""\n---\nbody\n'
    const { html } = await convert(md)
    expect(html).toContain('Tags &lt;b&gt; &amp; &quot;quotes&quot;')
    expect(html).not.toContain('<title>Tags <b>')
  })

  it('supports title and lang overrides', async () => {
    const { html } = await convert(fixture('minimal.md'), {
      title: 'Overridden',
      lang: 'ja'
    })
    expect(html).toContain('<title>Overridden</title>')
    expect(html).toContain('<html lang="ja">')
  })
})

describe('CSS delivery modes', () => {
  it('links to paperify.css by default', async () => {
    const { html } = await convert(fixture('minimal.md'))
    expect(html).toContain('<link rel="stylesheet" href="paperify.css">')
    expect(html).not.toContain('<style>')
  })

  it('embeds the stylesheet when requested', async () => {
    const { html } = await convert(fixture('minimal.md'), {
      css: { mode: 'embed', content: css }
    })
    expect(html).toContain('<style>')
    expect(html).toContain('column-count: 2')
    expect(html).not.toContain('href="paperify.css"')
  })
})

describe('asset collection', () => {
  it('collects local image and video assets, skipping remote URLs', async () => {
    const md = [
      '![local](media/a.png)',
      '',
      '![remote](https://example.com/b.png)',
      '',
      '::video{src="media/demo.mp4" poster="media/poster.png"}'
    ].join('\n')
    const { assets } = await convert(md)
    expect(assets).toContain('media/a.png')
    expect(assets).toContain('media/demo.mp4')
    expect(assets).toContain('media/poster.png')
    expect(assets).not.toContain('https://example.com/b.png')
  })
})
