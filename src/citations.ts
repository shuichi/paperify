import { createRequire } from 'node:module'

import type { Plugin } from 'unified'

import { escapeHtml } from './template.js'

const require = createRequire(import.meta.url)
const Cite = require('citation-js') as new (input: string) => { data: unknown[] }
const CSL = require('citeproc') as {
  Engine: new (
    sys: CiteprocSys,
    styleXml: string,
    locale?: string
  ) => CiteprocEngine
}
const cslLocales = require('@citation-js/plugin-csl/lib/locales.json') as Record<
  string,
  string
>

const CITATION_PATTERN = /\[([^[\]\n]*@[^[\]\n]+)\]/g
const CITATION_KEY_PATTERN = /^@([A-Za-z0-9_:.#$%&+?<>~/-]+)$/
const PLACEHOLDER_PREFIX = 'PAPERIFY_CITATION_PLACEHOLDER_'

export interface CitationOptions {
  /** BibTeX database text. */
  bibtex: string
  /** CSL style XML. */
  cslXml: string
  /** CSL locale, e.g. "en-US". Defaults to "en-US". */
  locale?: string
  /** Human-readable style id, used only in error messages. */
  styleId?: string
}

export interface CitationState {
  options: CitationOptions
  items: Map<string, CslItem>
  clusters: CitationCluster[]
}

interface CslItem {
  id?: unknown
  'citation-key'?: unknown
  [key: string]: unknown
}

interface CitationItem {
  id: string
}

interface CitationCluster {
  citationId: string
  placeholder: string
  items: CitationItem[]
}

interface MdastNode {
  type: string
  value?: string
  children?: MdastNode[]
}

interface CiteprocSys {
  retrieveLocale(locale: string): string
  retrieveItem(id: string): CslItem
}

interface CiteprocEngine {
  setOutputFormat(format: string): void
  processCitationCluster(
    citation: CiteprocCitation,
    citationsPre: Array<[string, number]>,
    citationsPost: Array<[string, number]>
  ): CiteprocCitationResult
  makeBibliography(): false | [CiteprocBibliographyMeta, string[]]
}

interface CiteprocCitation {
  citationID: string
  citationItems: CitationItem[]
  properties: { noteIndex: number }
}

type CiteprocCitationResult = [
  {
    citation_errors?: unknown[]
  },
  Array<[number, string, string]>
]

interface CiteprocBibliographyMeta {
  bibliography_errors?: unknown[]
  'second-field-align'?: boolean | string
  bibstart?: string
  bibend?: string
}

export function createCitationState(options: CitationOptions): CitationState {
  const cite = new Cite(options.bibtex)
  const items = new Map<string, CslItem>()

  for (const rawItem of cite.data) {
    if (!isCslItem(rawItem)) continue
    const id = citationItemId(rawItem)
    if (id) items.set(id, rawItem)
  }

  return {
    options,
    items,
    clusters: []
  }
}

export function remarkCitations(state: CitationState): Plugin<[], MdastNode> {
  return () => {
    return (tree) => {
      transformTextNodes(tree, state)
    }
  }
}

export function renderCitations(state: CitationState): {
  citations: Map<string, string>
  bibliographyHtml: string
} {
  if (state.clusters.length === 0) {
    return { citations: new Map(), bibliographyHtml: '' }
  }

  const engine = createEngine(state)
  const citationsPre: Array<[string, number]> = []
  const renderedCitations = new Map<string, string>()

  for (const cluster of state.clusters) {
    validateCluster(state, cluster)

    const result = engine.processCitationCluster(
      {
        citationID: cluster.citationId,
        citationItems: cluster.items,
        properties: { noteIndex: 0 }
      },
      citationsPre,
      []
    )

    if (result[0].citation_errors && result[0].citation_errors.length > 0) {
      throw new Error(
        `Citation processor reported an error for ${cluster.items
          .map((item) => `@${item.id}`)
          .join(', ')}`
      )
    }

    for (const [, html, citationId] of result[1]) {
      const renderedCluster = state.clusters.find(
        (candidate) => candidate.citationId === citationId
      )
      const cites = renderedCluster
        ? renderedCluster.items.map((item) => item.id).join(' ')
        : ''
      renderedCitations.set(
        citationId,
        `<span class="citation" data-cites="${escapeHtml(cites)}">${html}</span>`
      )
    }

    citationsPre.push([cluster.citationId, 0])
  }

  const bibliography = engine.makeBibliography()
  if (!bibliography) {
    return { citations: renderedCitations, bibliographyHtml: '' }
  }

  const [meta, entries] = bibliography
  if (meta.bibliography_errors && meta.bibliography_errors.length > 0) {
    throw new Error('Citation processor reported an error while rendering bibliography')
  }

  const bibliographyBody = `${meta.bibstart ?? ''}${entries.join('')}${meta.bibend ?? ''}`.trim()
  const sectionClass = meta['second-field-align']
    ? 'paper-references csl-second-field-align'
    : 'paper-references'
  const bibliographyHtml = bibliographyBody
    ? `<section class="${sectionClass}" id="references">\n<h2>References</h2>\n${bibliographyBody}\n</section>`
    : ''

  return { citations: renderedCitations, bibliographyHtml }
}

export function applyCitationHtml(
  contentHtml: string,
  state: CitationState,
  renderedCitations: Map<string, string>
): string {
  let html = contentHtml
  for (const cluster of state.clusters) {
    const rendered = renderedCitations.get(cluster.citationId)
    if (!rendered) continue
    html = html.split(cluster.placeholder).join(rendered)
  }
  return html
}

function transformTextNodes(node: MdastNode, state: CitationState): void {
  if (!node.children) return

  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i]
    if (child.type === 'text' && typeof child.value === 'string') {
      const replacement = splitCitationText(child.value, state)
      if (replacement) {
        node.children.splice(i, 1, ...replacement)
        i += replacement.length - 1
      }
      continue
    }

    transformTextNodes(child, state)
  }
}

function splitCitationText(
  value: string,
  state: CitationState
): MdastNode[] | undefined {
  const nodes: MdastNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  CITATION_PATTERN.lastIndex = 0
  while ((match = CITATION_PATTERN.exec(value)) !== null) {
    const items = parseCitationCluster(match[1])
    if (!items) continue

    if (match.index > lastIndex) {
      nodes.push({ type: 'text', value: value.slice(lastIndex, match.index) })
    }

    const cluster = createCluster(state, items)
    nodes.push({ type: 'text', value: cluster.placeholder })
    lastIndex = match.index + match[0].length
  }

  if (nodes.length === 0) return undefined

  if (lastIndex < value.length) {
    nodes.push({ type: 'text', value: value.slice(lastIndex) })
  }

  return nodes
}

function parseCitationCluster(value: string): CitationItem[] | undefined {
  const parts = value
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.length === 0) return undefined

  const items: CitationItem[] = []
  for (const part of parts) {
    const match = CITATION_KEY_PATTERN.exec(part)
    if (!match) return undefined
    items.push({ id: match[1] })
  }

  return items
}

function createCluster(
  state: CitationState,
  items: CitationItem[]
): CitationCluster {
  const index = state.clusters.length
  const cluster: CitationCluster = {
    citationId: `paperify-citation-${index + 1}`,
    placeholder: `${PLACEHOLDER_PREFIX}${index + 1}_`,
    items
  }
  state.clusters.push(cluster)
  return cluster
}

function createEngine(state: CitationState): CiteprocEngine {
  const locale = normalizeLocale(state.options.locale)
  const sys: CiteprocSys = {
    retrieveLocale: (requestedLocale) => retrieveLocale(requestedLocale),
    retrieveItem: (id) => {
      const item = state.items.get(id)
      if (!item) throw new Error(`Citation key not found in BibTeX: ${id}`)
      return item
    }
  }

  const engine = new CSL.Engine(sys, state.options.cslXml, locale)
  engine.setOutputFormat('html')
  return engine
}

function validateCluster(state: CitationState, cluster: CitationCluster): void {
  for (const item of cluster.items) {
    if (!state.items.has(item.id)) {
      throw new Error(`Citation key not found in BibTeX: ${item.id}`)
    }
  }
}

function retrieveLocale(locale: string): string {
  const normalized = normalizeLocale(locale)
  const candidates = [
    normalized,
    normalized.replace('_', '-'),
    normalized.replace('-', '_'),
    normalized.split('-')[0],
    'en-US'
  ]

  for (const candidate of candidates) {
    const xml = cslLocales[candidate]
    if (xml) return xml
  }

  return cslLocales['en-US']
}

function normalizeLocale(locale: string | undefined): string {
  if (!locale) return 'en-US'
  if (locale === 'en') return 'en-US'
  return locale
}

function isCslItem(value: unknown): value is CslItem {
  return typeof value === 'object' && value !== null
}

function citationItemId(item: CslItem): string | undefined {
  if (typeof item.id === 'string') return item.id
  if (typeof item['citation-key'] === 'string') return item['citation-key']
  return undefined
}
