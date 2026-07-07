import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  readStyleBundle,
  resolveCssPaths
} from '../src/styleSources.js'

describe('style sources', () => {
  it('loads the bundled base stylesheet by default', () => {
    const bundle = readStyleBundle({})

    expect(bundle.paths).toHaveLength(1)
    expect(bundle.paths[0]).toMatch(/styles[/\\]paperify\.css$/)
    expect(bundle.content).toContain('--font-body: system-ui')
    expect(bundle.content).toContain(':root:lang(ja)')
  })

  it('loads a custom stylesheet as the only stylesheet', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paperify-style-'))
    const cssPath = path.join(dir, 'theme.css')
    fs.writeFileSync(cssPath, ':root { --accent-color: #8b0000; }\n', 'utf8')

    const bundle = readStyleBundle({ cssFile: cssPath })

    expect(bundle.paths).toEqual([cssPath])
    expect(bundle.paths[0]).toBe(cssPath)
    expect(bundle.content).toContain('--accent-color: #8b0000')
  })

  it('rejects missing CSS files', () => {
    const cssPath = path.join(os.tmpdir(), `paperify-missing-${Date.now()}.css`)

    expect(() => resolveCssPaths({ cssFile: cssPath })).toThrow(
      /CSS file not found/
    )
  })
})
