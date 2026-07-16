/**
 * html.ts
 *
 * VS Code-free HTML export. The shared builder produces the same compiled
 * standalone document used as the input to PDF export; this module only
 * writes that completed document to the destination selected by the user.
 */

import fs from 'node:fs'
import path from 'node:path'

import type { MermaidRenderer } from 'paperify/api'

import { buildCompiledHtml } from './build'

export interface ExportHtmlRequest {
  /** Current (possibly unsaved) Markdown source. */
  markdown: string
  /** Directory used to resolve local asset references. */
  inputDir: string
  /** Absolute path of the document on disk; undefined for untitled files. */
  documentPath?: string
  /** Destination HTML path chosen by the user. */
  outputPath: string
  /** Paperify CSS embedded into the generated document. */
  css: string
  /** Test seam; defaults to the CLI's cached Zotero style download. */
  fetchCslXml?: (styleId: string) => Promise<string>
  /** Build-time Mermaid renderer shared by preview and PDF export. */
  mermaidRenderer?: MermaidRenderer
}

export interface ExportHtmlResult {
  warnings: string[]
}

/** Export a Paperify document to portable, compiled HTML. */
export async function exportHtmlToFile(
  request: ExportHtmlRequest
): Promise<ExportHtmlResult> {
  // Finish conversion before touching the destination, so conversion errors
  // never truncate an existing file selected in the save dialog.
  const built = await buildCompiledHtml({
    markdown: request.markdown,
    inputDir: request.inputDir,
    documentPath: request.documentPath,
    css: request.css,
    strictCitations: true,
    strictMermaid: true,
    mermaidRenderer: request.mermaidRenderer,
    fetchCslXml: request.fetchCslXml
  })

  await fs.promises.mkdir(path.dirname(request.outputPath), { recursive: true })
  await fs.promises.writeFile(request.outputPath, built.html, 'utf8')
  return { warnings: built.warnings }
}
