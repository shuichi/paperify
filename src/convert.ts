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
 *   (paperify)         figure & video transforms
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
import sanitizeSchema from './transforms/sanitizeSchema.js'

export interface ConvertOptions {
  /** How the stylesheet is delivered. Defaults to linking `paperify.css`. */
  css?: CssMode
  /** Allow (sanitized) raw HTML inside the Markdown. Off by default. */
  unsafeHtml?: boolean
  /** Override the frontmatter title. */
  title?: string
  /** Override the document language. Defaults to frontmatter lang, then "en". */
  lang?: string
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

function buildProcessor(options: ConvertOptions, assets: string[]) {
  let processor: Processor<any, any, any, any, any> = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkDirective)
    .use(remarkFigureDirective)
    .use(remarkVideoDirective)
    .use(remarkImageFigures)
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

  const processor = buildProcessor(options, assets)
  const file = await processor.process(content)
  const contentHtml = String(file).trim()

  const warnings = file.messages.map((m) => m.reason)

  const effectiveMeta: PaperMeta = {
    ...meta,
    title: options.title ?? meta.title
  }
  const lang = options.lang ?? meta.lang ?? 'en'
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
