import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import type { MermaidRenderer } from 'paperify/api'

import { exportHtmlToFile } from '../src/html'

const temporaryDirs: string[] = []

function makeOutputDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paperify-html-test-'))
  temporaryDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

const PAPERIFY_DOC = [
  '---',
  'paperify: true',
  'title: HTML Export',
  '---',
  '',
  '# Introduction',
  '',
  'Math: $E = mc^2$.',
  ''
].join('\n')

describe('exportHtmlToFile', () => {
  it('writes compiled standalone HTML without webview-only layers', async () => {
    const outputPath = path.join(makeOutputDir(), 'nested', 'paper.html')

    const result = await exportHtmlToFile({
      markdown: PAPERIFY_DOC,
      inputDir: os.tmpdir(),
      documentPath: path.join(os.tmpdir(), 'paper.md'),
      outputPath,
      css: '/* html-export-css */'
    })

    const html = fs.readFileSync(outputPath, 'utf8')
    expect(result.warnings).toEqual([])
    expect(html).toContain('<h1 class="paper-title">HTML Export</h1>')
    expect(html).toContain('/* html-export-css */')
    expect(html).toContain('class="katex"')
    expect(html).not.toContain('Content-Security-Policy')
    expect(html).not.toContain('vscode-webview://')
    expect(html).not.toContain('<script')
  })

  it('does not touch the destination when strict conversion fails', async () => {
    const outputPath = path.join(makeOutputDir(), 'paper.html')
    fs.writeFileSync(outputPath, 'existing output', 'utf8')
    const renderer: MermaidRenderer = async () => [
      { ok: false, error: 'diagram is incomplete' }
    ]

    await expect(
      exportHtmlToFile({
        markdown: `${PAPERIFY_DOC}\n\`\`\`mermaid\ngraph TD\n\`\`\`\n`,
        inputDir: os.tmpdir(),
        outputPath,
        css: '',
        mermaidRenderer: renderer
      })
    ).rejects.toThrow(/diagram is incomplete/)

    expect(fs.readFileSync(outputPath, 'utf8')).toBe('existing output')
  })

  it('returns non-fatal asset warnings from the compiled build', async () => {
    const outputPath = path.join(makeOutputDir(), 'paper.html')

    const result = await exportHtmlToFile({
      markdown: `${PAPERIFY_DOC}\n![Missing](media/nope.png)\n`,
      inputDir: os.tmpdir(),
      outputPath,
      css: ''
    })

    expect(result.warnings.join('\n')).toContain('image asset not found')
    expect(fs.readFileSync(outputPath, 'utf8')).toContain('media/nope.png')
  })
})
