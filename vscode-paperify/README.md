# Paperify Preview for VS Code

Preview [Paperify](https://github.com/shuichi/paperify) Markdown documents as
compiled paper-style HTML inside VS Code, and export them to portable HTML or
print-ready PDF — without leaving your editor and without changing how you
edit normal Markdown.

Only documents that explicitly opt in with the YAML boolean `paperify: true`
are treated as Paperify documents:

```markdown
---
paperify: true
title: Example Paper
authors:
  - name: Example Author
lang: ja
---

# Introduction

Body text with math: $E = mc^2$.
```

Everything else keeps using VS Code's built-in Markdown experience. The
extension does not define its own language, editor, or keybindings, and it
does not replace the built-in Markdown preview.

## Commands

- **Paperify: Show Actions** (`paperify.showActions`)
- **Paperify: Open Preview** (`paperify.openPreview`)
- **Paperify: Open Preview to the Side** (`paperify.openPreviewToSide`)
- **Paperify: Export HTML** (`paperify.exportHtml`)
- **Paperify: Export PDF** (`paperify.exportPdf`)

A single simplified Paperify icon appears in the editor title only when the
active document is a Paperify document. Selecting it opens a compact action
picker containing preview, HTML export, and PDF export. Running an individual
command on a non-Paperify document shows a short hint instead.

## What the preview shows

The preview reuses the actual Paperify build pipeline (`paperify/api`), so it
matches CLI output as closely as a webview allows:

- Paperify's stylesheet is embedded.
- Math is rendered statically with KaTeX (CSS and fonts inlined, no CDN).
- Mermaid fences are rendered to static SVG image figures at build time; no
  scripts or CDN requests are added to the preview.
- Local images and video posters are inlined as data URIs by `compileHtml()`.
- Local video files are served through webview resource URIs.
- GFM tables/footnotes, figures, video directives, and static code
  highlighting all work as in the CLI.
- Citations are processed through citeproc exactly like the CLI: the
  bibliography comes from frontmatter `bibliography:`, a terminal ```bibtex
  code block, or a sibling `<input>.bib`, using the CLI's default CSL style
  (`computing-surveys`, downloaded once per session and cached). Where the
  CLI hard-fails (missing .bib, offline style download, citations without a
  bibliography), the preview degrades to a warning in the output channel.
- VS Code's built-in webview element styles (blockquote, code, links, …) are
  reverted so the document cascades exactly like CLI output in a browser.
- Raw HTML stays disabled (`unsafeHtml: false`), matching the CLI default.

The preview updates live from unsaved editor content (debounced), and stale
async renders can never overwrite newer ones.

## HTML export

**Paperify: Export HTML** converts the current editor content (saved or not)
into portable, compiled HTML using the same pipeline as preview and PDF:

- Paperify CSS, KaTeX CSS/fonts, local images, video posters, citations, and
  Mermaid diagrams are embedded statically. Local video source files remain
  external references, matching the CLI's compiled HTML behavior.
- Webview-only reset styles, resource URIs, and CSP are not included, and the
  result contains no runtime JavaScript.
- Citation and Mermaid errors fail export rather than silently producing an
  incomplete paper. Missing optional images and posters remain warnings in the
  Paperify output channel.
- A save dialog defaults to `<input>.html` next to the Markdown document. A
  successful export can be opened directly from the completion notification.

## PDF export

**Paperify: Export PDF** renders the current editor content (saved or not)
to a print-ready PDF, exactly like the CLI's `paperify input.md -o output.pdf`:

- The same compiled standalone HTML is generated first (Paperify CSS, static
  KaTeX, inlined images/posters, citeproc citations — with the webview-only
  reset CSS, resource URIs, and CSP left out), written to a private temp
  directory, printed, and cleaned up afterwards. A failed export never leaves
  a partial PDF or temp files behind.
- Print options match the CLI: `printBackground`, `preferCSSPageSize`,
  `waitForFonts`, `print` media emulation, and frontmatter
  `headerTemplate`/`footerTemplate`.
- Citation problems fail the export with an error (like the CLI), rather than
  degrading to a warning like the live preview — an exported paper should
  never silently drop its citations.
- Invalid Mermaid diagrams likewise fail PDF export, while the live preview
  keeps the source code block and reports a warning during editing.
- A save dialog picks the destination (defaulting to `<input>.pdf` next to
  the document), a progress notification shows while printing, and duplicate
  exports of the same document are blocked.

PDF rendering and Mermaid diagrams in previews or HTML export need a locally
installed **Chrome, Edge, or Chromium**. The
extension ships no browser (and no full Puppeteer): it drives your local
browser through `puppeteer-core`. The executable is auto-detected from
standard install locations; if yours lives elsewhere, set:

- `paperify.pdf.browserExecutable` — absolute path to the browser executable
  used for Mermaid rendering and PDF export.

## Security

- Webview scripts are disabled (`enableScripts: false`).
- A strict Content-Security-Policy is injected (`default-src 'none'`,
  `script-src 'none'`; only inline styles, data-URI images/fonts, and local
  media via the webview's resource scheme are allowed).
- Local file access is limited to the document's directory
  (`localResourceRoots`).

## Errors and warnings

Conversion problems (for example invalid frontmatter YAML while editing) show
a concise error screen in the preview; full details and Paperify warnings go
to the **Paperify** output channel. Missing images or posters are warnings,
never preview failures — matching CLI behavior.

## Development

Requires the parent repository. From the repository root:

```bash
npm install
npm run build          # builds dist/, which the extension imports as paperify/api
cd vscode-paperify
npm install
npm run build          # bundles extension.js and copies Paperify CSS + Mermaid
npm run typecheck
npm test
```

To run the extension: open the `vscode-paperify/` folder in VS Code and press
F5 (Run Extension). To build an installable VSIX:

```bash
npm run package
code --install-extension paperify-preview-*.vsix
```

The bundle contains no browser binary and no full Puppeteer. Mermaid and PDF
rendering use `puppeteer-core` (compiled into the bundle) against your locally
installed Chrome/Edge/Chromium. The standalone Mermaid browser bundle is
copied into the VSIX as a local asset. The packaged runtime dependencies also
include `katex` (stylesheet and fonts) and the citation stack (`citation-js`,
`citeproc`, CSL plugins), which is loaded lazily and only for documents that
actually have a bibliography.

Requires VS Code 1.101 or later (its extension host provides the Node.js 22
runtime that `puppeteer-core` needs).

## Out of scope (MVP)

- Choosing a CSL style (preview and PDF export always use the CLI default,
  `computing-surveys`; use the CLI's `--csl` for other styles)
- Print settings UI beyond frontmatter `headerTemplate`/`footerTemplate`
- Scroll sync, outline view, completions
- External (http/https) images — blocked by the CSP
- A Paperify-specific language ID or custom editor

## License

GPL-3.0-only, same as Paperify itself.
