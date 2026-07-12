# AGENTS.md

## Project Overview

Paperify is a CSS-first academic publishing tool. It converts Markdown into
portable, paper-style HTML that reads well on screen and can be printed as an
A4 two-column academic paper. It is deliberately not a LaTeX clone. Keep the
converter small, keep the generated HTML semantic, and let CSS carry the visual
layout and typography.

The generated HTML must not require runtime JavaScript or a server. Math is
rendered statically at build time. Direct PDF output is produced by opening the
same compiled HTML in Puppeteer/Chromium and printing it with `print` media.

## Runtime And Tooling

- The project is TypeScript ESM for Node.js.
- The package requires Node.js `>=24.18.0`.
- Build with `npm run build`.
- Test with `npm test`.
- Example output is generated with `npm run example`.
- The CLI binary is `paperify`, built from `src/cli.ts` into `dist/cli.js`.

## Architecture

The codebase is intentionally small. Main responsibilities:

- `src/cli.ts`: argument parsing, watch mode, style loading, HTML/PDF build orchestration.
- `src/api.ts`: the supported embedding API (`paperify/api`) re-exporting
  `convert`, `compileHtml`, `parseFrontmatter`, bibliography/CSL resolution,
  and style loading for hosts such as the VS Code extension. CLI-only
  concerns (argument parsing, PDF/Puppeteer) must stay out of this module.
- `src/convert.ts`: Markdown to HTML conversion through the unified pipeline.
  The citation stack is imported lazily, only when `citations` are supplied.
- `src/citationSyntax.ts`: pure `[@key]` syntax recognition, shared by
  `citations.ts` and `bibliography.ts` without loading citation-js/citeproc.
- `src/frontmatter.ts`: YAML frontmatter parsing and metadata normalization.
- `src/template.ts`: final standalone HTML document assembly.
- `src/compile.ts`: local image/poster and KaTeX CSS/font inlining for compiled HTML.
- `src/pdf.ts`: Puppeteer/Chromium PDF rendering.
- `src/assets.ts`: local asset collection and optional copying for `--copy-assets`.
- `src/styleSources.ts`: bundled and custom CSS resolution.
- `src/transforms/*.ts`: Paperify-specific Markdown transforms and raw HTML schema.
- `styles/paperify.css`: the primary rendering layer for screen and print.
- `test/*.test.ts`: behavioral contracts for conversion, compilation, style loading, and PDF options.

## Conversion Pipeline

The core unified pipeline in `src/convert.ts` is:

1. `gray-matter` extracts YAML frontmatter before the unified processor runs.
2. `remark-parse`
3. `remark-gfm`
4. `remark-math`
5. `remark-directive`
6. Paperify remark transforms:
   - `remarkFigureDirective`
   - `remarkVideoDirective`
   - `remarkImageFigures`
7. `remark-rehype` with `allowDangerousHtml` only when `unsafeHtml` is enabled.
8. `rehype-raw` and `rehype-sanitize` only when `--unsafe-html` is enabled.
9. `rehype-katex`
10. `rehype-slug`
11. `collectAssets`
12. `rehype-stringify`

After this, `template.ts` wraps the rendered article fragment in the final HTML
document. The visual design should remain in CSS, not in converter logic.

## Frontmatter Contract

`frontmatter.ts` normalizes metadata into `PaperMeta`.

Supported fields:

- `title`
- `subtitle`
- `authors` or `author`
- `date`
- `abstract`
- `keywords`
- `lang` or `language`
- `headerTemplate`
- `footerTemplate`
- `paperify` (opt-in flag for integrations such as the VS Code preview; only
  the YAML boolean `true` counts, and it is never rendered into the HTML)

Authors may be plain strings or objects with `name`, `affiliation`, and
`email`. Keywords may be an array or a comma-separated string. YAML date objects
are normalized to `YYYY-MM-DD`. Metadata rendered into HTML must be escaped.
`lang` sets the generated `<html lang>` attribute and drives language-aware
CSS such as `:root:lang(ja)` font variables.

`headerTemplate` and `footerTemplate` are only used for direct PDF output and
are passed to Puppeteer's header/footer template support.

## Markdown Features

Paperify supports standard Markdown plus GFM tables, footnotes, strikethrough,
and autolinks.

Headings receive stable slug IDs through `rehype-slug`.

Inline and display math use `remark-math` and `rehype-katex`. Math output is
static HTML. A KaTeX stylesheet is included only when math is present.

Image-only paragraphs become semantic figures:

```html
<figure class="image-figure">
  <img src="..." alt="...">
  <figcaption>...</figcaption>
</figure>
```

The image alt text is preserved on the image and reused as the caption. Images
inside normal text paragraphs must remain inline images.

Explicit figures use a leaf directive:

```md
::figure{src="images/system.png" alt="System diagram" caption="System overview" wide=true}
```

`wide=true` adds `class="wide"` so the print stylesheet can span the item
across both print columns.

Videos use a leaf directive:

```md
::video{src="media/demo.mp4" poster="media/demo-poster.png" caption="Demo video" controls=true}
```

Supported video attributes include `src`, `poster`, `caption`, `controls`,
`loop`, `muted`, `autoplay`, and `wide`. `src` is required. `controls` defaults
to on. MIME type is inferred from common video extensions.

Video output must include both a screen video element and a print fallback. In
print, CSS hides the video controls and shows either the poster image or a clean
placeholder plus a readable "Video available at:" source line.

## Raw HTML And Sanitization

Raw HTML is disabled by default. Unknown HTML in Markdown is dropped unless the
caller enables `unsafeHtml` or the CLI receives `--unsafe-html`.

With `--unsafe-html`, raw HTML is parsed and sanitized through
`src/transforms/sanitizeSchema.ts`. The schema is an allowlist for safe academic
HTML: text semantics, tables, figures, images, video/source, and classes needed
by Paperify and remark-math. Scripts, event handlers, and dangerous URLs must
not survive sanitization.

Sanitization runs before `rehype-katex`, so KaTeX's final generated HTML does
not need to be part of the allowlist. The schema does need to preserve the math
marker classes that `rehype-katex` consumes.

## HTML Compilation And Assets

`convert()` can produce HTML that links to `paperify.css` by default, but the
CLI always embeds CSS by passing `{ mode: "embed" }`.

`compileHtml()` makes CLI output more portable:

- It replaces the KaTeX CDN stylesheet link with locally resolved KaTeX CSS.
- It inlines KaTeX fonts referenced by that CSS as data URIs.
- It inlines local `<img src>` assets.
- It inlines local `<video poster>` assets.
- It does not inline video source files.

Missing local image or poster assets should produce warnings and remain
unchanged in the HTML. They should not make the build fail.

`collectAssets` records local `img`, `video`, `source`, and `poster` references.
`copyAssets` preserves relative paths under the output directory and refuses to
write outside it.

## CSS And Print Layout

`styles/paperify.css` is the rendering engine. Prefer CSS changes for visual
behavior. Avoid moving presentation decisions into TypeScript unless the HTML
structure itself must change.

The stylesheet is organized into numbered sections and exposes themeable values
as CSS custom properties. Important defaults include:

- Screen reading width: `--paper-width: 78ch`.
- Screen body size: `--body-size: 16px`.
- Print body size: `--print-body-size: 9.5pt`.
- Print line height: `--print-line-height: 1.45`.
- Print column gap: `--print-column-gap: 7mm`.

Screen output is a single centered reading column. Print output uses A4
`@page`, keeps title/authors/abstract/keywords single-column, then flows
`.paper-content` into two CSS columns.

Important print behavior:

- Headings use `break-after: avoid`.
- Figures, tables, code blocks, blockquotes, and display equations use
  `break-inside: avoid` where supported.
- `.wide` uses `column-span: all`.
- Tables are styled with booktabs-like rules.
- Code wraps in print instead of clipping.
- Display math is constrained to the column in print and scrolls horizontally on screen.
- Videos print as poster or placeholder fallback.
- Links print as plain text by default.
- `body.print-show-urls` opt-in displays external URLs after link text.

Japanese font defaults live in `styles/paperify.css` under `:root:lang(ja)`,
so frontmatter such as `lang: ja` switches typography without a separate
stylesheet.

## PDF Output

When the CLI output path ends in `.pdf`, it first writes a sibling `.html` file
and then renders that HTML to PDF through `src/pdf.ts`.

PDF rendering uses Puppeteer with:

- `printBackground: true`
- `preferCSSPageSize: true`
- `waitForFonts: true`
- `page.emulateMediaType("print")`

Header and footer rendering remain disabled unless `headerTemplate` or
`footerTemplate` is provided in frontmatter.

If Puppeteer cannot find or launch Chrome/Chromium, preserve the existing error
guidance that suggests installing Puppeteer's browser or using
`--browser-executable`.

## Design Boundaries

Keep these constraints intact unless the user explicitly asks for a larger
product change:

- Do not add runtime JavaScript to rendered documents.
- Do not turn Paperify into a full LaTeX replacement.
- Do not add citation processing, theorem environments, equation numbering,
  automatic cross-reference resolution, page-bottom footnotes, advanced float
  placement, or syntax highlighting as incidental changes.
- Keep generated HTML semantic and stable.
- Keep visual behavior in CSS where possible.
- Preserve accessibility basics such as image `alt` text.
- Prefer warnings over hard failures for missing optional media assets.

## VS Code Extension

`vscode-paperify/` is a self-contained VS Code extension that previews
Markdown documents whose frontmatter contains the YAML boolean
`paperify: true`. It reuses the pipeline through `paperify/api` (bundled with
esbuild) and must never include Puppeteer, Chromium, or PDF code. It has its
own `package.json`, tests (`npm test`), and build (`npm run build`); build the
root package first so `dist/` exists. See `vscode-paperify/README.md`.

## Testing Guidance

Run focused tests for the area you change, and run the full suite when behavior
or shared contracts change.

- Conversion, frontmatter, figures, videos, raw HTML, document structure:
  `test/convert.test.ts`
- Compiled standalone HTML and asset inlining:
  `test/compile.test.ts`
- CSS source resolution and language font defaults:
  `test/styleSources.test.ts`
- PDF option behavior:
  `test/pdf.test.ts`

Useful commands:

```bash
npm run build
npm test
npm run example
```

Because this is a publishing tool, small visual or structural regressions
matter. When changing HTML shape or CSS print behavior, inspect generated output
from `examples/sample.md` in addition to relying on tests.
