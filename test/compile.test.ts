import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { compileHtml } from '../src/compile.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const examplesDir = path.join(here, '..', 'examples')

describe('compiled HTML', () => {
  it('inlines local images and video posters, but not video sources', () => {
    const html = [
      '<!doctype html>',
      '<html><head><title>x</title></head><body>',
      '<img src="media/figure1.svg" alt="figure">',
      '<video poster="media/demo-poster.svg"><source src="media/demo.mp4" type="video/mp4"></video>',
      '</body></html>'
    ].join('\n')

    const { html: compiled, warnings } = compileHtml({
      html,
      inputDir: examplesDir
    })

    expect(warnings).toEqual([])
    expect(compiled).toContain('src="data:image/svg+xml;base64,')
    expect(compiled).toContain('poster="data:image/svg+xml;base64,')
    expect(compiled).toContain('src="media/demo.mp4"')
  })

  it('inlines KaTeX CSS and its fonts', () => {
    const html = [
      '<!doctype html>',
      '<html><head>',
      '  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.17.0/dist/katex.min.css" crossorigin="anonymous">',
      '</head><body></body></html>'
    ].join('\n')

    const { html: compiled } = compileHtml({
      html,
      inputDir: examplesDir
    })

    expect(compiled).toContain('<style>')
    expect(compiled).toContain('data:font/woff2;base64,')
    expect(compiled).not.toContain('cdn.jsdelivr.net/npm/katex')
    expect(compiled).not.toContain('url(fonts/')
  })

  it('keeps missing local assets as-is with a warning', () => {
    const { html: compiled, warnings } = compileHtml({
      html: '<img src="media/missing.png" alt="missing">',
      inputDir: examplesDir
    })

    expect(compiled).toContain('src="media/missing.png"')
    expect(warnings.join(' ')).toContain('asset not found')
  })
})
