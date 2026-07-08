import fs from 'node:fs'
import path from 'node:path'

import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkDirective from 'remark-directive'

import { textContainsCitation } from './citations.js'

export interface ExtractTrailingBibtexResult {
  /** Markdown with a terminal bibtex fence removed, when present. */
  markdown: string
  /** The terminal BibTeX database text. Empty/blank blocks yield undefined. */
  bibtex?: string
  /** True when a terminal bibtex fence was removed from the Markdown. */
  removed: boolean
}

export type BibliographySource =
  | {
      kind: 'file'
      source: 'cli' | 'frontmatter' | 'default'
      path: string
    }
  | {
      kind: 'embedded'
      source: 'embedded'
      bibtex: string
    }

export interface ResolveBibliographyOptions {
  /** Markdown input path. Frontmatter bibliography paths are relative to this file. */
  inputPath: string
  /** CLI --bib/--bibliography value. Kept cwd-relative for compatibility. */
  cliBibFile?: string
  /** Frontmatter bibliography value. Resolved relative to inputPath. */
  frontmatterBibliography?: string
  /** Non-empty BibTeX extracted from a terminal bibtex fence. */
  embeddedBibtex?: string
  /** Test seam for default bibliography discovery. */
  fileExists?: (filePath: string) => boolean
}

interface MarkdownNode {
  type: string
  value?: unknown
  children?: MarkdownNode[]
}

interface SourceLine {
  text: string
  start: number
  end: number
  contentEnd: number
}

interface OpenFence {
  char: '`' | '~'
  length: number
  info: string
  start: number
  contentStart: number
}

interface ClosedFence {
  info: string
  start: number
  contentStart: number
  contentEnd: number
  closeLineIndex: number
}

export function defaultBibPathForInput(input: string): string {
  const parsed = path.parse(input)
  return path.join(parsed.dir, `${parsed.name}.bib`)
}

export function resolveBibliographySource(
  options: ResolveBibliographyOptions
): BibliographySource | undefined {
  if (options.cliBibFile) {
    return {
      kind: 'file',
      source: 'cli',
      path: path.resolve(options.cliBibFile)
    }
  }

  const inputPath = path.resolve(options.inputPath)
  const inputDir = path.dirname(inputPath)

  if (options.frontmatterBibliography) {
    return {
      kind: 'file',
      source: 'frontmatter',
      path: path.resolve(inputDir, options.frontmatterBibliography)
    }
  }

  if (options.embeddedBibtex && options.embeddedBibtex.trim()) {
    return {
      kind: 'embedded',
      source: 'embedded',
      bibtex: options.embeddedBibtex
    }
  }

  const fileExists = options.fileExists ?? fs.existsSync
  const candidate = path.resolve(defaultBibPathForInput(options.inputPath))
  return fileExists(candidate)
    ? { kind: 'file', source: 'default', path: candidate }
    : undefined
}

export function extractTrailingBibtexBlock(
  markdown: string
): ExtractTrailingBibtexResult {
  const lines = splitLines(markdown)
  const lastContentLine = findLastContentLine(lines)
  if (lastContentLine === -1) {
    return { markdown, removed: false }
  }

  const fence = findTerminalFence(lines, lastContentLine)
  if (!fence || !isBibtexInfo(fence.info)) {
    return { markdown, removed: false }
  }

  const bibtex = markdown.slice(fence.contentStart, fence.contentEnd)
  const prefix = markdown.slice(0, fence.start).trimEnd()

  return {
    markdown: prefix ? `${prefix}\n` : '',
    bibtex: bibtex.trim() ? bibtex : undefined,
    removed: true
  }
}

export function markdownContainsCitations(markdown: string): boolean {
  const tree = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkDirective)
    .parse(markdown) as MarkdownNode
  return nodeContainsCitations(tree)
}

function nodeContainsCitations(node: MarkdownNode): boolean {
  if (node.type === 'text' && typeof node.value === 'string') {
    return textContainsCitation(node.value)
  }

  return Boolean(node.children?.some((child) => nodeContainsCitations(child)))
}

function splitLines(source: string): SourceLine[] {
  const lines: SourceLine[] = []
  const pattern = /[^\r\n]*(?:\r\n|\n|\r|$)/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(source)) !== null) {
    const raw = match[0]
    if (raw === '') break

    const lineBreakLength = raw.endsWith('\r\n')
      ? 2
      : raw.endsWith('\n') || raw.endsWith('\r')
        ? 1
        : 0

    lines.push({
      text: raw.slice(0, raw.length - lineBreakLength),
      start: match.index,
      end: match.index + raw.length,
      contentEnd: match.index + raw.length - lineBreakLength
    })
  }

  return lines
}

function findLastContentLine(lines: SourceLine[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].text.trim()) return i
  }
  return -1
}

function findTerminalFence(
  lines: SourceLine[],
  lastContentLine: number
): ClosedFence | undefined {
  let open: OpenFence | undefined
  let lastClosed: ClosedFence | undefined

  for (let i = 0; i <= lastContentLine; i++) {
    const line = lines[i]
    if (!open) {
      const opening = parseOpeningFence(line.text)
      if (opening) {
        open = {
          ...opening,
          start: line.start,
          contentStart: line.end
        }
      }
      continue
    }

    if (isClosingFence(line.text, open)) {
      lastClosed = {
        info: open.info,
        start: open.start,
        contentStart: open.contentStart,
        contentEnd: line.start,
        closeLineIndex: i
      }
      open = undefined
    }
  }

  return lastClosed?.closeLineIndex === lastContentLine ? lastClosed : undefined
}

function parseOpeningFence(
  line: string
): { char: '`' | '~'; length: number; info: string } | undefined {
  const match = /^(?: {0,3})(`{3,}|~{3,})(.*)$/.exec(line)
  if (!match) return undefined

  const fence = match[1]
  const info = match[2].trim()
  if (fence[0] === '`' && info.includes('`')) return undefined

  return {
    char: fence[0] as '`' | '~',
    length: fence.length,
    info
  }
}

function isClosingFence(line: string, open: OpenFence): boolean {
  const match = /^(?: {0,3})(`{3,}|~{3,})[ \t]*$/.exec(line)
  if (!match) return false

  const fence = match[1]
  return fence[0] === open.char && fence.length >= open.length
}

function isBibtexInfo(info: string): boolean {
  const language = info.trim().split(/\s+/, 1)[0]
  return language.toLowerCase() === 'bibtex'
}
