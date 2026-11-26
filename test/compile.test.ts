import { describe, it, expect } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

import { compileHtml } from '../src/compile.js'
import { convert } from '../src/convert.js'
import { copyAssets } from '../src/assets.js'

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

  it('uses the URL pathname for local files and preserves SVG fragments', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paperify-asset-'))
    try {
      fs.writeFileSync(path.join(dir, '..plot A&B.svg'), '<svg/>')
      const { contentHtml, assets } = await convert('![Panel](..plot%20A&B.svg?v=2#panel)')
      const compiled = compileHtml({ html: contentHtml, inputDir: dir })
      expect(compiled.warnings).toEqual([])
      expect(compiled.html).toContain(`src="data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}#panel"`)

      const out = path.join(dir, 'output')
      expect(copyAssets(assets, dir, out)).toEqual({ copied: assets, missing: [] })
      expect(fs.readFileSync(path.join(out, '..plot A&B.svg'), 'utf8')).toBe('<svg/>')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rewrites only real media attributes and keeps surrounding markup intact', () => {
    const style = `<style>p::before { content: '<img src="missing.svg">'; }</style>`
    const { html, warnings } = compileHtml({
      html: style + `<img data-src="placeholder" alt="a > b" src='media/figure1.svg'>`,
      inputDir: examplesDir
    })
    expect(warnings).toEqual([])
    expect(html).toContain(style + '<img data-src="placeholder" alt="a > b" src="data:image/svg+xml;base64,')
  })

  it('treats directories like missing optional assets', () => {
    const html = '<img src="media/">'
    expect(compileHtml({ html, inputDir: examplesDir })).toEqual({
      html, warnings: ['image asset not found, left as-is: media/']
    })
    expect(copyAssets(['media/'], examplesDir, examplesDir)).toEqual({
      copied: [], missing: ['media/']
    })
  })

  it('leaves the source and existing hard-linked destinations intact when copying', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paperify-copy-'))
    try {
      const out = path.join(dir, 'out')
      const media = path.join(dir, 'clip.mp4')
      fs.mkdirSync(out)
      fs.writeFileSync(media, 'new clip')
      fs.utimesSync(media, 1000, 1000)
      expect(copyAssets(['clip.mp4'], dir, dir).copied).toEqual(['clip.mp4'])
      expect(fs.statSync(media).mtimeMs).toBe(1000000)

      const previous = path.join(dir, 'previous.mp4')
      fs.writeFileSync(previous, 'previous clip')
      fs.linkSync(previous, path.join(out, 'clip.mp4'))
      expect(copyAssets(['clip.mp4'], dir, out).missing).toEqual(['clip.mp4'])
      expect(fs.readFileSync(previous, 'utf8')).toBe('previous clip')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

})
