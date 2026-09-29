/**
 * frontmatter.ts
 *
 * Parses YAML frontmatter with gray-matter and normalizes it into a
 * predictable `PaperMeta` shape. Everything downstream (template, CLI)
 * can rely on the normalized types instead of raw YAML values.
 */

import matter from 'gray-matter'

export interface Author {
  name: string
  affiliation?: string
  email?: string
}

export interface PaperMeta {
  title?: string
  subtitle?: string
  authors: Author[]
  date?: string
  abstract?: string
  keywords: string[]
  lang?: string
  bibliography?: string
  headerTemplate?: string
  footerTemplate?: string
  /** Absolute print math size, normalized to a positive CSS pt length. */
  printMathSize?: string
  /**
   * Opt-in flag for integrations such as the VS Code preview. Only the YAML
   * boolean `true` counts; it is never rendered into the generated HTML.
   */
  paperify?: boolean
}

export interface FrontmatterResult {
  /** Markdown body with the frontmatter block removed. */
  content: string
  /** Normalized metadata. */
  meta: PaperMeta
}

function asString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  if (value instanceof Date) return formatDate(value)
  const s = String(value).trim()
  return s.length > 0 ? s : undefined
}

/** Accept only positive, finite point sizes; unitless YAML numbers mean pt. */
export function normalizePrintMathSize(value: unknown): string | undefined {
  let points: number
  if (typeof value === 'number') {
    points = value
  } else if (typeof value === 'string') {
    const length = value.trim()
    if (!/^(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?pt$/i.test(length)) {
      return undefined
    }
    points = Number(length.slice(0, -2))
  } else {
    return undefined
  }
  return Number.isFinite(points) && points > 0 ? `${points}pt` : undefined
}

/** Format a Date as YYYY-MM-DD (UTC), the least surprising form for papers. */
function formatDate(d: Date): string {
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

function normalizeAuthors(value: unknown): Author[] {
  if (value === null || value === undefined) return []
  const list = Array.isArray(value) ? value : [value]
  const authors: Author[] = []
  for (const entry of list) {
    if (entry === null || entry === undefined) continue
    if (typeof entry === 'string') {
      const name = entry.trim()
      if (name) authors.push({ name })
      continue
    }
    if (typeof entry === 'object') {
      const record = entry as Record<string, unknown>
      const name = asString(record.name)
      if (!name) continue
      const author: Author = { name }
      const affiliation = asString(record.affiliation)
      const email = asString(record.email)
      if (affiliation) author.affiliation = affiliation
      if (email) author.email = email
      authors.push(author)
    }
  }
  return authors
}

function normalizeKeywords(value: unknown): string[] {
  if (value === null || value === undefined) return []
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean)
  }
  if (Array.isArray(value)) {
    return value
      .map((k) => asString(k))
      .filter((k): k is string => Boolean(k))
  }
  return []
}

/**
 * Parse frontmatter from a Markdown source string.
 * Never throws on missing frontmatter; a document without any YAML block
 * simply yields empty metadata.
 */
export function parseFrontmatter(source: string): FrontmatterResult {
  const parsed = matter(source)
  const data = (parsed.data ?? {}) as Record<string, unknown>

  const meta: PaperMeta = {
    title: asString(data.title),
    subtitle: asString(data.subtitle),
    authors: normalizeAuthors(data.authors ?? data.author),
    date: asString(data.date),
    abstract: asString(data.abstract),
    keywords: normalizeKeywords(data.keywords),
    lang: asString(data.lang ?? data.language),
    bibliography: asString(data.bibliography),
    headerTemplate: asString(data.headerTemplate),
    footerTemplate: asString(data.footerTemplate),
    printMathSize: normalizePrintMathSize(data.printMathSize),
    paperify: data.paperify === true ? true : undefined
  }

  return { content: parsed.content, meta }
}
