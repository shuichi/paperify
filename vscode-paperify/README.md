# Paperify Preview for VS Code

Preview [Paperify](https://github.com/shuichi/paperify) Markdown documents as
compiled paper-style HTML inside VS Code — without leaving your editor and
without changing how you edit normal Markdown.

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

- **Paperify: Open Preview** (`paperify.openPreview`)
- **Paperify: Open Preview to the Side** (`paperify.openPreviewToSide`)

An editor-title preview button appears only when the active document is a
Paperify document. Running a command on a non-Paperify document shows a short
hint instead of opening a panel.

## What the preview shows

The preview reuses the actual Paperify build pipeline (`paperify/api`), so it
matches CLI output as closely as a webview allows:

- Paperify's stylesheet is embedded.
- Math is rendered statically with KaTeX (CSS and fonts inlined, no CDN).
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
npm run build          # bundles dist/extension.js and copies assets/paperify.css
npm run typecheck
npm test
```

To run the extension: open the `vscode-paperify/` folder in VS Code and press
F5 (Run Extension). To build an installable VSIX:

```bash
npm run package
code --install-extension paperify-preview-*.vsix
```

The bundle contains no Puppeteer, Chromium, or PDF code. The packaged
runtime dependencies are `katex` (stylesheet and fonts) and the citation
stack (`citation-js`, `citeproc`, CSL plugins), which is loaded lazily and
only for documents that actually have a bibliography.

## Out of scope (MVP)

- Choosing a CSL style (the preview always uses the CLI default,
  `computing-surveys`; use the CLI's `--csl` for other styles)
- PDF output, print settings UI
- Scroll sync, outline view, completions
- External (http/https) images — blocked by the CSP
- A Paperify-specific language ID or custom editor

## License

GPL-3.0-only, same as Paperify itself.
