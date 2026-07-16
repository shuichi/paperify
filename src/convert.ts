/**
 * convert.ts
 *
 * The main Markdown → HTML pipeline. Deliberately simple:
 *
 *   gray-matter        YAML frontmatter
 *   remark-parse       Markdown → mdast
 *   remark-gfm         tables, footnotes, strikethrough, autolinks
 *   remark-math        $inline$ and $$display$$ math
 *   remark-directive   ::figure / ::video directives
 *   (paperify)         figure, video & static Mermaid transforms
 *   remark-rehype      mdast → hast
 *   rehype-raw         only with --unsafe-html
 *   rehype-sanitize    only with --unsafe-html (allowlist schema)
 *   rehype-katex       static, build-time math rendering
 *   rehype-highlight   static, build-time syntax highlighting
 *   rehype-slug        stable heading IDs
 *   rehype-stringify   hast → HTML fragment
 *
 * The fragment is then wrapped by template.ts into a standalone document.
 * Visual quality is the stylesheet's responsibility, not the converter's.
 */

import { unified, type Processor } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkDirective from 'remark-directive'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import rehypeSlug from 'rehype-slug'
import rehypeStringify from 'rehype-stringify'

import { parseFrontmatter, type PaperMeta } from './frontmatter.js'
import { renderDocument, type CssMode } from './template.js'
import { collectAssets } from './assets.js'
import remarkImageFigures from './transforms/figures.js'
import remarkFigureDirective from './transforms/figureDirective.js'
import remarkVideoDirective from './transforms/videoDirective.js'
import remarkMermaid from './transforms/mermaid.js'
import sanitizeSchema from './transforms/sanitizeSchema.js'
import type { CitationOptions, CitationState } from './citations.js'
import type { MermaidConversionOptions } from './mermaid.js'

/**
 * The citation stack (citation-js, citeproc, CSL data) is heavy and only
 * needed when a bibliography is supplied, so it is imported on demand. Hosts
 * that never pass `citations` (such as the VS Code preview) never load it.
 */
type CitationsModule = typeof import('./citations.js')

interface ActiveCitations {
  module: CitationsModule
  state: CitationState
}

export interface ConvertOptions {
  /** How the stylesheet is delivered. Defaults to linking `paperify.css`. */
  css?: CssMode
  /** Allow (sanitized) raw HTML inside the Markdown. Off by default. */
  unsafeHtml?: boolean
  /** Override the frontmatter title. */
  title?: string
  /** Override the document language. Defaults to frontmatter lang, then "en". */
  lang?: string
  /** BibTeX/CSL inputs used to resolve Markdown citations like [@key]. */
  citations?: CitationOptions
  /** Build-time renderer for fenced `mermaid` diagrams. */
  mermaid?: MermaidConversionOptions
}

export interface ConvertResult {
  /** The complete standalone HTML document. */
  html: string
  /** HTML fragment for the article content only. */
  contentHtml: string
  /** Normalized frontmatter metadata. */
  meta: PaperMeta
  /** Local asset references (relative paths) found in the document. */
  assets: string[]
  /** Warnings emitted by the pipeline (e.g. directives missing src). */
  warnings: string[]
}

function buildProcessor(
  options: ConvertOptions,
  assets: string[],
  citations?: ActiveCitations
) {
  let processor: Processor<any, any, any, any, any> = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkDirective)
    .use(remarkFigureDirective)
    .use(remarkVideoDirective)
    .use(remarkImageFigures)
    .use(remarkMermaid, options.mermaid)

  if (citations) {
    processor = processor.use(citations.module.remarkCitations(citations.state))
  }

  processor = processor
    .use(remarkRehype, { allowDangerousHtml: Boolean(options.unsafeHtml) })

  if (options.unsafeHtml) {
    processor = processor.use(rehypeRaw).use(rehypeSanitize, sanitizeSchema)
  }

  return processor
    .use(rehypeKatex)
    .use(rehypeHighlight, { detect: false })
    .use(rehypeSlug)
    .use(collectAssets, { assets })
    .use(rehypeStringify)
}

/** Convert a Markdown source string into a standalone HTML document. */
export async function convert(
  markdown: string,
  options: ConvertOptions = {}
): Promise<ConvertResult> {
  const { content, meta } = parseFrontmatter(markdown)
  const assets: string[] = []
  const lang = options.lang ?? meta.lang ?? 'en'
  let citations: ActiveCitations | undefined
  if (options.citations) {
    const module = await import('./citations.js')
    citations = {
      module,
      state: module.createCitationState({
        ...options.citations,
        locale: options.citations.locale ?? lang
      })
    }
  }

  const processor = buildProcessor(options, assets, citations)
  const file = await processor.process(content)
  let contentHtml = String(file).trim()

  const warnings = file.messages.map((m) => m.reason)

  if (citations) {
    const rendered = citations.module.renderCitations(citations.state)
    contentHtml = citations.module.applyCitationHtml(
      contentHtml,
      citations.state,
      rendered.citations
    )
    if (rendered.bibliographyHtml) {
      contentHtml = `${contentHtml}\n${rendered.bibliographyHtml}`
    }
  }

  const effectiveMeta: PaperMeta = {
    ...meta,
    title: options.title ?? meta.title
  }
  const css: CssMode = options.css ?? { mode: 'link', href: 'paperify.css' }
  const hasMath = /class="[^"]*katex/.test(contentHtml)

  const html = renderDocument({
    meta: effectiveMeta,
    contentHtml,
    lang,
    css,
    hasMath
  })

  return { html, contentHtml, meta: effectiveMeta, assets, warnings }
}

export type { PaperMeta, Author } from './frontmatter.js'
export type { CssMode } from './template.js'
export type {
  MermaidConversionOptions,
  MermaidFailureMode,
  MermaidRenderer,
  MermaidRenderOutcome,
  MermaidRenderValue
} from './mermaid.js'
