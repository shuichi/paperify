/**
 * render.ts
 *
 * Builds the preview HTML for the webview. Deliberately free of any
 * dependency on the `vscode` module so it can be tested directly.
 *
 * The Markdown -> compiled standalone HTML pipeline is shared with PDF
 * export (build.ts); this module adds only the webview-specific layers:
 *
 *   buildCompiledHtml()  shared pipeline, with local media mapped to webview
 *                        URIs and citation problems reported as warnings
 *   (here)               reverts VS Code's webview default styles via a
 *                        reset stylesheet placed before paperify.css
 *   (here)               injects a strict Content-Security-Policy
 */

import type { MermaidRenderer } from 'paperify/api'

import { buildCompiledHtml } from './build'

export interface PreviewRequest {
  /** Current (possibly unsaved) Markdown source. */
  markdown: string
  /** Directory used to resolve local asset references. */
  inputDir: string
  /** Absolute path of the document on disk; undefined for untitled files. */
  documentPath?: string
  /** The webview's CSP source (`webview.cspSource`). */
  cspSource: string
  /** Maps an absolute local file path to a webview-safe URI string. */
  resolveResource: (absolutePath: string) => string
}

/**
 * VS Code prepends a `_defaultStyles` sheet to every webview that themes
 * plain elements (body, blockquote, code, links, …). Paperify's stylesheet
 * only overrides the properties it sets itself, so anything else would leak
 * editor theming into the preview and diverge from CLI output opened in a
 * browser. This sheet reverts exactly what `_defaultStyles` touches; it is
 * placed *before* paperify.css, which therefore keeps the final word.
 */
const WEBVIEW_RESET_CSS = `/* vscode-webview reset: restore browser default rendering */
body {
  margin: revert;
  padding: revert;
  background-color: revert;
  color: revert;
  font-family: revert;
  font-weight: revert;
  font-size: revert;
}
img, video { max-width: revert; max-height: revert; }
a, a code { color: revert; }
a:hover { color: revert; }
code {
  font-family: revert;
  color: revert;
  background-color: revert;
  padding: revert;
  border-radius: revert;
}
pre code { padding: revert; }
blockquote { background: revert; border-color: revert; }
kbd {
  color: revert;
  background-color: revert;
  border: revert;
  border-radius: revert;
  padding: revert;
  vertical-align: revert;
  box-shadow: revert;
}`

export interface PreviewRenderResult {
  html: string
  warnings: string[]
}

export type PreviewRenderer = (
  request: PreviewRequest
) => Promise<PreviewRenderResult>

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function contentSecurityPolicy(cspSource: string): string {
  return [
    "default-src 'none'",
    // Images and KaTeX fonts arrive as data URIs from compileHtml().
    `img-src data: ${cspSource}`,
    'font-src data:',
    // The Paperify stylesheet is embedded as an inline <style> block.
    "style-src 'unsafe-inline'",
    // Local video files are served through webview resource URIs.
    `media-src ${cspSource}`,
    "script-src 'none'"
  ].join('; ')
}

function injectCsp(html: string, cspSource: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(cspSource)}">`
  return html.replace('<head>', () => `<head>\n  ${meta}`)
}

/** Render a Paperify document for display inside a webview. */
export async function renderPreviewHtml(
  request: PreviewRequest & {
    css: string
    /** Test seam; defaults to the CLI's cached Zotero style download. */
    fetchCslXml?: (styleId: string) => Promise<string>
    /** Build-time Mermaid renderer shared by the extension. */
    mermaidRenderer?: MermaidRenderer
  }
): Promise<PreviewRenderResult> {
  const built = await buildCompiledHtml({
    markdown: request.markdown,
    inputDir: request.inputDir,
    documentPath: request.documentPath,
    css: `${WEBVIEW_RESET_CSS}\n\n${request.css}`,
    fetchCslXml: request.fetchCslXml,
    mermaidRenderer: request.mermaidRenderer,
    resolveMediaSource: request.resolveResource
  })

  return {
    html: injectCsp(built.html, request.cspSource),
    warnings: built.warnings
  }
}

/** A friendly error screen shown instead of a stack trace. */
export function renderPreviewErrorHtml(
  message: string,
  cspSource: string
): string {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Paperify Preview Error</title>
  <style>
    body {
      font-family: var(--vscode-font-family, sans-serif);
      color: var(--vscode-foreground, #333);
      padding: 2rem;
      line-height: 1.6;
    }
    h1 { font-size: 1.2rem; }
    pre {
      background: var(--vscode-textCodeBlock-background, rgba(128, 128, 128, 0.12));
      padding: 0.75rem 1rem;
      border-radius: 4px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    p.hint { opacity: 0.8; }
  </style>
</head>
<body>
  <h1>Paperify could not render this document</h1>
  <pre>${escapeHtml(message)}</pre>
  <p class="hint">The preview will refresh automatically once the document converts again.
  Full details are in the <strong>Paperify</strong> output channel
  (View &rarr; Output &rarr; Paperify).</p>
</body>
</html>
`
  return injectCsp(html, cspSource)
}
