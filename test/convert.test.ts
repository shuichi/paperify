import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { convert } from '../src/convert.js'
import { parseFrontmatter } from '../src/frontmatter.js'
import { inferVideoType } from '../src/transforms/videoDirective.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixture = (name: string): string =>
  fs.readFileSync(path.join(here, 'fixtures', name), 'utf8')
const css = fs.readFileSync(
  path.join(here, '..', 'styles', 'paperify.css'),
  'utf8'
)

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
      '--accent-color'
    ]) {
      expect(css).toContain(v)
    }
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
