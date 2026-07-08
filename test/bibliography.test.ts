import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { createRequire } from 'node:module'

import {
  extractTrailingBibtexBlock,
  markdownContainsCitations,
  resolveBibliographySource
} from '../src/bibliography.js'
import { convert } from '../src/convert.js'

const require = createRequire(import.meta.url)
const cslStyles = require('@citation-js/plugin-csl/lib/styles.json') as Record<
  string,
  string
>
const apaCsl = cslStyles.apa

const bibtex = [
  '@book{knuth1984texbook,',
  '  author = {Knuth, Donald E.},',
  '  title = {The TeXbook},',
  '  publisher = {Addison-Wesley},',
  '  year = {1984}',
  '}'
].join('\n')

describe('embedded BibTeX blocks', () => {
  it('extracts a terminal bibtex code block before conversion', async () => {
    const extracted = extractTrailingBibtexBlock(
      ['See [@knuth1984texbook].', '', '```bibtex', bibtex, '```', ''].join('\n')
    )

    expect(extracted.removed).toBe(true)
    expect(extracted.markdown).not.toContain('@book{knuth1984texbook')
    expect(extracted.bibtex).toContain('@book{knuth1984texbook')

    const { contentHtml } = await convert(extracted.markdown, {
      citations: { bibtex: extracted.bibtex ?? '', cslXml: apaCsl }
    })

    expect(contentHtml).not.toContain('language-bibtex')
    expect(contentHtml).not.toContain('@book{knuth1984texbook')
    expect(contentHtml).toContain('(Knuth, 1984)')
    expect(contentHtml).toContain('id="ref-knuth1984texbook" class="csl-entry"')
  })

  it('hides an empty terminal bibtex block without using it as a source', () => {
    const extracted = extractTrailingBibtexBlock(
      ['See [@knuth1984texbook].', '', '```bibtex', '   ', '```', ''].join('\n')
    )

    expect(extracted.removed).toBe(true)
    expect(extracted.bibtex).toBeUndefined()
    expect(extracted.markdown.trim()).toBe('See [@knuth1984texbook].')
  })

  it('leaves non-terminal bibtex code blocks in the Markdown', () => {
    const markdown = ['```bibtex', bibtex, '```', '', 'More text.'].join('\n')
    const extracted = extractTrailingBibtexBlock(markdown)

    expect(extracted.removed).toBe(false)
    expect(extracted.markdown).toBe(markdown)
    expect(extracted.bibtex).toBeUndefined()
  })

  it('detects citation syntax in Markdown text but not code blocks', () => {
    expect(markdownContainsCitations('See [@knuth1984texbook].')).toBe(true)
    expect(markdownContainsCitations('```md\nSee [@knuth1984texbook].\n```')).toBe(
      false
    )
  })
})

describe('bibliography source resolution', () => {
  const inputPath = path.join('/tmp', 'paperify-bib', 'paper.md')

  it('prefers CLI bibliography paths and keeps them cwd-relative', () => {
    const source = resolveBibliographySource({
      inputPath,
      cliBibFile: 'refs/cli.bib',
      frontmatterBibliography: 'frontmatter.bib',
      embeddedBibtex: bibtex,
      fileExists: () => true
    })

    expect(source).toEqual({
      kind: 'file',
      source: 'cli',
      path: path.resolve('refs/cli.bib')
    })
  })

  it('resolves frontmatter bibliography paths relative to the Markdown file', () => {
    const source = resolveBibliographySource({
      inputPath,
      frontmatterBibliography: 'refs/frontmatter.bib',
      embeddedBibtex: bibtex,
      fileExists: () => true
    })

    expect(source).toEqual({
      kind: 'file',
      source: 'frontmatter',
      path: path.join(path.dirname(inputPath), 'refs', 'frontmatter.bib')
    })
  })

  it('uses embedded BibTeX only when no file source was specified', () => {
    const source = resolveBibliographySource({
      inputPath,
      embeddedBibtex: bibtex,
      fileExists: () => true
    })

    expect(source).toEqual({
      kind: 'embedded',
      source: 'embedded',
      bibtex
    })
  })

  it('falls back to an input-matched .bib file when present', () => {
    const source = resolveBibliographySource({
      inputPath,
      fileExists: (candidate) => candidate === inputPath.replace(/\.md$/, '.bib')
    })

    expect(source).toEqual({
      kind: 'file',
      source: 'default',
      path: inputPath.replace(/\.md$/, '.bib')
    })
  })
})
