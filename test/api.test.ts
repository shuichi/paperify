import { describe, it, expect } from 'vitest'

import * as api from '../src/api.js'

describe('embedding API surface (paperify/api)', () => {
  it('exposes the conversion helpers embedders rely on', () => {
    expect(typeof api.convert).toBe('function')
    expect(typeof api.compileHtml).toBe('function')
    expect(typeof api.parseFrontmatter).toBe('function')
    expect(typeof api.readStyleBundle).toBe('function')
    expect(typeof api.defaultCssPath).toBe('function')
    expect(typeof api.isLocalAsset).toBe('function')
    expect(typeof api.escapeHtml).toBe('function')
  })

  it('converts through the shared module without loading CLI-only code', async () => {
    const { html, meta } = await api.convert(
      '---\npaperify: true\ntitle: API Test\n---\n\nHello.\n',
      { css: { mode: 'embed', content: '/* css */' } }
    )
    expect(meta.paperify).toBe(true)
    expect(html).toContain('<h1 class="paper-title">API Test</h1>')
    expect(html).toContain('/* css */')
  })
})
