/**
 * api.ts
 *
 * The supported embedding API for hosts that reuse the Paperify pipeline
 * outside the CLI (for example the VS Code preview extension in
 * `vscode-paperify/`). Import it as `paperify/api`.
 *
 * Only build-time conversion helpers belong here. CLI-only concerns such as
 * argument parsing and PDF rendering (Puppeteer) must stay out of this
 * module so that embedders never pull them in. The citation-js/citeproc
 * stack is loaded lazily by convert(), and only when citations are supplied.
 */

export { convert } from './convert.js'
export type { ConvertOptions, ConvertResult } from './convert.js'
export { compileHtml } from './compile.js'
export type { CompileOptions, CompileResult } from './compile.js'
export { parseFrontmatter } from './frontmatter.js'
export type { Author, FrontmatterResult, PaperMeta } from './frontmatter.js'
export { defaultCssPath, readStyleBundle, resolveCssPaths } from './styleSources.js'
export type { StyleBundle, StyleSourceOptions } from './styleSources.js'
export { isLocalAsset } from './assets.js'
export { escapeHtml } from './template.js'
export type { CssMode } from './template.js'
export {
  defaultBibPathForInput,
  extractTrailingBibtexBlock,
  markdownContainsCitations,
  resolveBibliographySource
} from './bibliography.js'
export type {
  BibliographySource,
  ExtractTrailingBibtexResult,
  ResolveBibliographyOptions
} from './bibliography.js'
export {
  DEFAULT_CSL_STYLE,
  clearCslStyleCache,
  fetchCslStyle,
  normalizeCslStyleId
} from './csl.js'
export { textContainsCitation } from './citationSyntax.js'
export type { CitationOptions } from './citations.js'
