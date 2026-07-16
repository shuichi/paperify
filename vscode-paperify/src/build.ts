/**
 * build.ts
 *
 * The shared Markdown -> compiled standalone HTML pipeline used by both the
 * webview preview and PDF export. Deliberately free of any dependency on the
 * `vscode` module and of webview-specific processing (reset CSS, webview
 * resource URIs, CSP) — those stay in render.ts.
 *
 * The pipeline mirrors the CLI:
 *
 *   (here)         resolves the bibliography exactly like the CLI
 *                  (frontmatter path, terminal bibtex block, <input>.bib)
 *   convert()      Paperify Markdown → standalone HTML (CSS embedded,
 *                  KaTeX and Mermaid rendered statically, citeproc citations,
 *                  raw HTML disabled)
 *   compileHtml()  inlines local images, video posters, KaTeX CSS + fonts
 */

import fs from 'node:fs'
import path from 'node:path'

import {
  DEFAULT_CSL_STYLE,
  compileHtml,
  convert,
  extractTrailingBibtexBlock,
  fetchCslStyle,
  markdownContainsCitations,
  parseFrontmatter,
  resolveBibliographySource,
  textContainsCitation,
  type CitationOptions,
  type MermaidRenderer,
  type PaperMeta
} from 'paperify/api'

export interface BuildRequest {
  /** Current (possibly unsaved) Markdown source. */
  markdown: string
  /** Directory used to resolve local asset references. */
  inputDir: string
  /** Absolute path of the document on disk; undefined for untitled files. */
  documentPath?: string
  /** CSS embedded into the generated document. */
  css: string
  /**
   * With `strictCitations`, citation problems fail the build like the CLI
   * (an export must not silently drop citations). Without it, they degrade
   * to warnings so live preview typing never breaks the panel.
   */
  strictCitations?: boolean
  /** Fail on Mermaid errors for export; preview keeps the source + warning. */
  strictMermaid?: boolean
  /** Shared lazy browser renderer supplied by extension activation. */
  mermaidRenderer?: MermaidRenderer
  /** Test seam; defaults to the CLI's cached Zotero style download. */
  fetchCslXml?: (styleId: string) => Promise<string>
}

export interface BuildResult {
  /** Compiled standalone HTML document. */
  html: string
  /** Normalized frontmatter metadata (headerTemplate/footerTemplate, …). */
  meta: PaperMeta
  warnings: string[]
}

/**
 * Resolve citations the same way the CLI does: frontmatter `bibliography`,
 * then a terminal ```bibtex block, then a sibling `<input>.bib`.
 */
async function resolveCitations(
  markdownWithoutBibtex: string,
  embeddedBibtex: string | undefined,
  request: BuildRequest,
  fetchCslXml: (styleId: string) => Promise<string>,
  warnings: string[]
): Promise<CitationOptions | undefined> {
  const { content, meta } = parseFrontmatter(markdownWithoutBibtex)
  const inputPath =
    request.documentPath ?? path.join(request.inputDir, 'untitled.md')
  const strict = request.strictCitations === true

  const source = resolveBibliographySource({
    inputPath,
    frontmatterBibliography: meta.bibliography,
    embeddedBibtex
  })

  if (!source) {
    if (textContainsCitation(content) && markdownContainsCitations(content)) {
      const message =
        'citations found, but no bibliography was provided; add a frontmatter bibliography, a terminal bibtex code block, or a sibling .bib file'
      if (strict) throw new Error(message)
      warnings.push(message)
    }
    return undefined
  }

  let bibtex: string
  if (source.kind === 'file') {
    if (!fs.existsSync(source.path)) {
      if (strict) throw new Error(`BibTeX file not found: ${source.path}`)
      warnings.push(`BibTeX file not found, citations disabled: ${source.path}`)
      return undefined
    }
    bibtex = fs.readFileSync(source.path, 'utf8')
  } else {
    bibtex = source.bibtex
  }

  try {
    const cslXml = await fetchCslXml(DEFAULT_CSL_STYLE)
    return { bibtex, cslXml, styleId: DEFAULT_CSL_STYLE }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (strict) throw new Error(`citation style could not be loaded: ${message}`)
    warnings.push(`citations disabled: ${message}`)
    return undefined
  }
}

/** Build a compiled standalone Paperify HTML document from Markdown. */
export async function buildCompiledHtml(request: BuildRequest): Promise<BuildResult> {
  const fetchCslXml = request.fetchCslXml ?? fetchCslStyle
  const warnings: string[] = []

  const extracted = extractTrailingBibtexBlock(request.markdown)
  const citations = await resolveCitations(
    extracted.markdown,
    extracted.bibtex,
    request,
    fetchCslXml,
    warnings
  )

  const converted = await convert(extracted.markdown, {
    css: { mode: 'embed', content: request.css },
    unsafeHtml: false,
    citations,
    ...(request.mermaidRenderer
      ? {
          mermaid: {
            renderer: request.mermaidRenderer,
            failureMode: request.strictMermaid
              ? ('error' as const)
              : ('warn' as const)
          }
        }
      : {})
  })

  const compiled = compileHtml({
    html: converted.html,
    inputDir: request.inputDir
  })

  return {
    html: compiled.html,
    meta: converted.meta,
    warnings: [...warnings, ...converted.warnings, ...compiled.warnings]
  }
}
