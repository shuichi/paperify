import { describe, it, expect } from 'vitest'

import { isPaperifyDocument } from '../src/detect'

describe('Paperify document detection', () => {
  it('accepts the YAML boolean paperify: true', () => {
    const source = [
      '---',
      'paperify: true',
      'title: Example Paper',
      'authors:',
      '  - name: Example Author',
      'lang: ja',
      '---',
      '',
      '# Introduction',
      '',
      '本文です。数式は $E = mc^2$ です。'
    ].join('\n')
    expect(isPaperifyDocument(source)).toBe(true)
  })

  it('rejects paperify: false', () => {
    expect(isPaperifyDocument('---\npaperify: false\n---\nbody\n')).toBe(false)
  })

  it('rejects the string "true"', () => {
    expect(isPaperifyDocument('---\npaperify: "true"\n---\nbody\n')).toBe(false)
  })

  it('rejects documents without the flag', () => {
    expect(isPaperifyDocument('---\ntitle: Plain\n---\nbody\n')).toBe(false)
    expect(isPaperifyDocument('# Plain Markdown\n\nbody\n')).toBe(false)
  })

  it('rejects other YAML value types without crashing', () => {
    expect(isPaperifyDocument('---\npaperify: 1\n---\nbody\n')).toBe(false)
    expect(isPaperifyDocument('---\npaperify:\n  nested: true\n---\nbody\n')).toBe(false)
  })

  it('treats invalid frontmatter YAML as not-a-paperify-document', () => {
    const invalid = '---\npaperify: true\ntitle: [unclosed\n---\nbody\n'
    expect(() => isPaperifyDocument(invalid)).not.toThrow()
    expect(isPaperifyDocument(invalid)).toBe(false)
  })
})
