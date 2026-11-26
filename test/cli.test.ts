import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { main } from '../src/cli.js'

describe('CLI builds', () => {
  let dir: string
  let input: string
  let output: string
  let stopWatching: (() => void) | void
  const originalExitCode = process.exitCode

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paperify-cli-'))
    input = path.join(dir, 'paper.md')
    output = path.join(dir, 'paper.html')
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    stopWatching?.()
    stopWatching = undefined
    process.exitCode = originalExitCode
    vi.restoreAllMocks()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it.each(['same path', 'aliased PDF', 'aliased HTML sibling'])(
    'preserves the source document for an unsafe output (%s)',
    async (collision) => {
      fs.writeFileSync(input, 'Original Markdown')
      const pdf = path.join(dir, 'paper.pdf')
      if (collision === 'aliased PDF') fs.linkSync(input, pdf)
      if (collision === 'aliased HTML sibling') fs.linkSync(input, output)
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})

      await main([input, '-o', collision === 'same path' ? input : pdf])

      expect(process.exitCode).toBe(1)
      expect(error).toHaveBeenCalledWith(expect.stringContaining('overwrite the input'))
      expect(fs.readFileSync(input, 'utf8')).toBe('Original Markdown')
      expect(fs.existsSync(output)).toBe(collision === 'aliased HTML sibling')
    }
  )

  it('tracks replacements of the Markdown file and newly referenced media', async () => {
    const readHtml = () => fs.readFileSync(output, 'utf8')
    const replaceSource = (text: string) => {
      const replacement = path.join(dir, 'editor.tmp')
      fs.writeFileSync(replacement, text)
      fs.renameSync(replacement, input)
    }
    replaceSource('Initial content')
    stopWatching = await main([input, '--watch'])
    await vi.waitFor(() => expect(readHtml()).toContain('Initial content'), 3000)
    replaceSource('First save')
    await vi.waitFor(() => expect(readHtml()).toContain('First save'), 3000)
    const image = path.join(dir, 'diagram.svg')
    fs.writeFileSync(image, '<svg/>')
    replaceSource('Second save\n\n![Diagram](diagram.svg)')
    await vi.waitFor(() => expect(readHtml()).toContain('Second save'), 3000)
    const newImage = '<svg><title>Updated</title></svg>'
    fs.writeFileSync(image, newImage)
    await vi.waitFor(
      () => expect(readHtml()).toContain(Buffer.from(newImage).toString('base64')),
      3000
    )
  }, 10_000)

  it('recovers when an input dependency is missing at startup', async () => {
    const css = path.join(dir, 'theme.css')
    fs.writeFileSync(input, 'Recoverable error')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    stopWatching = await main([input, '--css', css, '--watch'])
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith(expect.stringContaining('CSS file not found')))
    fs.writeFileSync(css, 'body { color: navy }')
    await vi.waitFor(
      () => expect(fs.readFileSync(output, 'utf8')).toContain('body { color: navy }'),
      3000
    )
  })
})
