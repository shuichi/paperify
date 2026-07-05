import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  listFontsets,
  readStyleBundle,
  resolveCssPaths
} from '../src/styleSources.js'

describe('style sources', () => {
  it('lists bundled fontsets', () => {
    expect(listFontsets()).toContain('japanese')
  })

  it('loads the base stylesheet before the requested fontset', () => {
    const bundle = readStyleBundle({ fontset: 'japanese' })

    expect(bundle.paths[0]).toMatch(/styles[/\\]paperify\.css$/)
    expect(bundle.paths[1]).toMatch(/styles[/\\]fontset[/\\]japanese\.css$/)
    expect(bundle.content.indexOf('--font-body: system-ui')).toBeLessThan(
      bundle.content.indexOf('--font-body: "Noto Serif JP"')
    )
  })

  it('applies fontsets after a custom base stylesheet', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paperify-style-'))
    const cssPath = path.join(dir, 'theme.css')
    fs.writeFileSync(cssPath, ':root { --accent-color: #8b0000; }\n', 'utf8')

    const bundle = readStyleBundle({ cssFile: cssPath, fontset: 'japanese' })

    expect(bundle.paths[0]).toBe(cssPath)
    expect(bundle.paths[1]).toMatch(/styles[/\\]fontset[/\\]japanese\.css$/)
    expect(bundle.content).toContain('--accent-color: #8b0000')
    expect(bundle.content).toContain('--font-body: "Noto Serif JP"')
  })

  it('rejects unsafe or unknown fontset names', () => {
    expect(() => resolveCssPaths({ fontset: '../japanese' })).toThrow(
      /Invalid fontset name/
    )
    expect(() => resolveCssPaths({ fontset: 'missing' })).toThrow(
      /Unknown fontset/
    )
  })
})
