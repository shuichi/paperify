# Paperify

**CSS-first academic publishing: Markdown in, one portable HTML file out — readable on screen, printable as a two-column paper.**

Paperify is a lightweight Markdown-to-HTML converter for academic writing. It is deliberately *not* a LaTeX clone. The converter stays small and emits minimal, semantic HTML; a carefully authored stylesheet (`paperify.css`) carries the layout and typography for both media:

- **Screen** — a single, centered reading column that is comfortable on desktop and mobile.
- **Print / PDF** — a two-column A4 academic paper, produced by the browser's own print engine. The title, authors, abstract, and keywords stay single-column; the article body flows into two columns with careful break control.

The same compiled HTML file serves both. There is no runtime JavaScript and no server. Direct `.pdf` output uses Puppeteer/Chromium at build time.

## Installation

Paperify requires Node.js 24 LTS or newer. The repo includes an `.nvmrc` pinned to the current latest LTS, Node.js 24.18.0.

```bash
npm install          # install dependencies
npm run build        # compile TypeScript to dist/
npm test             # run the test suite
npm run example      # compile examples/sample.md into dist/sample.html
```

To use the CLI from anywhere:

```bash
npm install -g .     # or: npm link
paperify input.md -o output.html
paperify input.md -o output.pdf
paperify input.md --fontset japanese -o output.pdf
```

## CLI usage

```
paperify <input.md> [options]

--output, -o <file>   Compile to this path; .pdf also writes sibling .html
                      (default: <input>.html)
--css <file>          Custom CSS file path (default: bundled paperify.css)
--fontset <name>      Add bundled font CSS after the base stylesheet
                      (for example: japanese)
--embed-css           Compatibility option; compiled HTML always embeds CSS
--unsafe-html         Allow sanitized raw HTML inside Markdown
--title <title>       Override title from frontmatter
--lang <lang>         HTML language attribute (default: en)
--browser-executable <file>
                      Chrome/Chromium executable for PDF output
--watch               Rebuild on file changes
--copy-assets         Compatibility option; images/posters compile inline
--help                Show help
```

Paperify compiles Markdown to a self-contained HTML file. The compiled HTML embeds Paperify CSS, local images, video posters/fallbacks, KaTeX CSS, and KaTeX fonts as data URIs, so the HTML can be opened on its own. Video files themselves are not embedded; use `--copy-assets` if you want local video sources copied next to the output for playback.

When the output path ends in `.pdf`, Paperify first writes the compiled HTML beside the PDF, then opens that HTML with Puppeteer's Chromium engine and prints it to PDF. For example, `paperify paper.md -o dist/paper.pdf` writes both `dist/paper.html` and `dist/paper.pdf`.

## Markdown conventions

Paperify uses the unified ecosystem: `remark-parse` + `remark-gfm`, so standard Markdown plus GitHub-flavored extensions (tables, footnotes, strikethrough, autolinks) work as expected. Headings receive stable, slugified IDs (`## Related Work` → `id="related-work"`), so internal links survive rebuilds.

### YAML frontmatter

```yaml
---
title: "A Lightweight Markdown-to-HTML Paper Converter"
subtitle: "CSS-first academic publishing for web and print"
authors:
  - name: "Alice Example"
    affiliation: "Example University"
    email: "alice@example.edu"
  - name: "Bob Example"
    affiliation: "Example Lab"
date: "2026-07-04"
abstract: |
  One or more paragraphs of abstract text.
keywords:
  - Markdown
  - academic publishing
lang: en
footerTemplate: |
  <div style="font-size:8px;width:100%;text-align:center">
    <span class="pageNumber"></span>/<span class="totalPages"></span>
  </div>
---
```

All fields are optional. Authors may also be plain strings, and keywords may be a comma-separated string. Regular document metadata is normalized and HTML-escaped before rendering. `headerTemplate` and `footerTemplate` are used only for direct PDF output and are passed through as Puppeteer header/footer HTML templates.

### Math

- Inline math: `$E = mc^2$`
- Display math: `$$ ... $$`

Math is rendered **statically at build time** with KaTeX — the output HTML needs no JavaScript to display equations. Compiled HTML embeds the KaTeX stylesheet and fonts from the installed `katex` package.

In print, display equations are kept inside their column, sized with restraint, and prevented from breaking across columns where the engine supports it. On screen, very long equations scroll horizontally instead of overflowing.

### Images and figures

A paragraph containing only an image becomes a semantic figure, with the alt text doubling as the caption:

```markdown
![Caption text](images/figure1.png)
```

```html
<figure class="image-figure">
  <img src="images/figure1.png" alt="Caption text">
  <figcaption>Caption text</figcaption>
</figure>
```

An image without alt text still becomes a figure, but no empty caption is emitted. Images inside regular text paragraphs are left untouched.

For explicit control — including **wide figures** that span both print columns — use the figure directive:

```markdown
::figure{src="images/system.png" alt="System diagram" caption="System overview" wide=true}
```

### Video

```markdown
::video{src="media/demo.mp4" poster="media/demo-poster.png" caption="Demo video" controls=true}
```

Supported attributes: `src` (required), `poster`, `caption`, `controls` (default: on), `loop`, `muted`, `autoplay`, `wide`. The MIME type is inferred from the file extension (`.mp4`, `.webm`, `.ogg`/`.ogv`, `.mov`).

- **On screen** the video is playable with native controls.
- **In print** the `<video>` element (and its controls) is hidden. The poster image is printed instead when one exists; otherwise a clean placeholder box shows the video filename. Either way a readable "Video available at: …" source line is printed so the video remains reachable from paper.

### Tables, code, footnotes, blockquotes

- **Tables** use GFM syntax and booktabs-style thin rules. On screen, wide tables scroll horizontally; in print they are kept inside a column and protected from breaking where possible.
- **Code blocks** are fenced. There is no syntax highlighting in v1, but the `language-*` class is preserved on the `<code>` element so a highlighter or theme can hook in later. In print, code wraps rather than clipping.
- **Footnotes** use GFM syntax (`[^1]`) and render compactly at the end of the document. True page-bottom footnotes are out of scope for v1.
- **Blockquotes** render as restrained academic notes with a thin left rule.

### Raw HTML

Raw HTML is **disabled by default** — unknown HTML in the source is dropped. With `--unsafe-html`, raw HTML is allowed but sanitized against an allowlist of safe academic elements (text semantics, headings, lists, tables, figures, images, `video`/`source`, KaTeX-compatible code classes). Scripts, event handlers, and `javascript:` URLs are always stripped.

## Screen vs. print behavior

| Aspect | Screen | Print |
| --- | --- | --- |
| Layout | single centered column (~78ch) | two-column A4, front matter single-column |
| Body size | 16px, line-height 1.7 | 9.5pt, line-height 1.45 |
| Wide elements | normal width | `column-span: all` |
| Video | playable | poster / placeholder + source URL |
| Long equations | horizontal scroll | constrained to column |
| Links | accent-colored underline | plain text (optional URL display) |

To print external URLs after link text, add `class="print-show-urls"` to `<body>` in a post-processing step or custom template — it is off by default to keep output quiet.

## Exporting to PDF

The recommended path is direct PDF output:

```bash
paperify paper.md -o paper.pdf
```

Paperify uses Puppeteer to open the compiled HTML file and print with Chromium's `print` media type, `preferCSSPageSize`, and background graphics enabled. The stylesheet's `@page` rule controls the A4 page size and margins.

PDF headers and footers can be controlled from YAML frontmatter:

```yaml
---
title: "Paper Title"
headerTemplate: |
  <div style="font-size:8px;width:100%;padding:0 12mm">
    <span class="title"></span>
  </div>
footerTemplate: |
  <div style="font-size:8px;width:100%;text-align:center">
    <span class="pageNumber"></span>/<span class="totalPages"></span>
  </div>
---
```

Puppeteer fills special spans by class name: `date`, `title`, `url`, `pageNumber`, and `totalPages`. Header/footer templates are rendered in Puppeteer's print margin area, so put any needed styling inline or inside a `<style>` tag in the template.

If Puppeteer cannot find or launch its managed browser, install it with `npx puppeteer browsers install chrome`, or point Paperify at an existing Chrome/Chromium binary:

```bash
paperify paper.md -o paper.pdf --browser-executable "/path/to/chrome"
```

You can still open an HTML output in a browser and choose **Print → Save as PDF**, but browser print engines vary. Chromium-based browsers remain the most predictable manual export path.

## Customizing paperify.css

The stylesheet is the deliverable that does the visual work — the HTML is intentionally plain. Everything themeable is exposed as a CSS custom property:

```css
:root {
  --font-body: Georgia, "Times New Roman", serif;
  --paper-width: 72ch;
  --accent-color: #8b0000;
}
```

Options for theming:

- **Override variables** in a small stylesheet loaded after `paperify.css`.
- **Use a bundled fontset** with `--fontset japanese`; Paperify loads `styles/paperify.css` first, then `styles/fontset/japanese.css`.
- **Pass your own stylesheet** with `--css mytheme.css` (start from a copy of `styles/paperify.css`).
- Print-specific knobs (`--print-body-size`, `--print-line-height`, `--print-column-gap`) live in the same `:root` block.

The file is organized into numbered, commented sections (tokens → base → reading column → front matter → content → print) so it is safe to edit surgically.

## Limitations

- **Not a full LaTeX replacement.** No numbered equations/theorems, cross-reference resolution, or automatic figure numbering.
- **No citation processor in v1.** Write the references section manually in Markdown (BibTeX/CSL support would layer cleanly on the pipeline later).
- **Browser print engines vary.** Column balancing, `break-inside`, and `column-span` support differ between Chromium, Firefox, and Safari. Direct `.pdf` output uses Puppeteer/Chromium for a more stable export path.
- **Advanced float placement and true page-bottom footnotes are out of scope.** Figures print where they occur, and footnotes collect at the end of the document.

## Project layout

```
src/
  cli.ts                     CLI: args, watch, compile/PDF orchestration
  compile.ts                 self-contained compiled HTML generation
  convert.ts                 unified pipeline (remark → rehype)
  pdf.ts                     Puppeteer PDF rendering
  template.ts                standalone HTML document assembly
  frontmatter.ts             YAML metadata parsing & normalization
  assets.ts                  local asset collection & copying
  transforms/
    figures.ts               image-only paragraph → <figure>
    figureDirective.ts       ::figure{...}
    videoDirective.ts        ::video{...} + print fallback markup
    sanitizeSchema.ts        allowlist for --unsafe-html
styles/
  paperify.css               the first-class stylesheet (screen + print)
examples/
  sample.md                  demonstrates every feature
test/
  convert.test.ts            Vitest suite
```

## License

MIT
