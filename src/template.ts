/**
 * template.ts
 *
 * Assembles the final standalone HTML document. The body is deliberately
 * minimal and semantic: layout and typography are the stylesheet's job.
 */

import { createRequire } from 'node:module'
import type { PaperMeta } from './frontmatter.js'

export type CssMode =
  | { mode: 'link'; href: string }
  | { mode: 'embed'; content: string }

export interface TemplateOptions {
  meta: PaperMeta
  /** Already-rendered HTML fragment for the article body. */
  contentHtml: string
  /** Language for the <html lang> attribute. */
  lang: string
  css: CssMode
  /** Whether the document contains KaTeX output (adds the KaTeX stylesheet). */
  hasMath: boolean
}

/** Escape a string for use inside HTML text content and attribute values. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function katexVersion(): string {
  try {
    const require = createRequire(import.meta.url)
    const pkg = require('katex/package.json') as { version?: string }
    if (pkg.version) return pkg.version
  } catch {
    // Fall through to the pinned default.
  }
  return '0.16.22'
}

function renderAuthors(meta: PaperMeta): string {
  if (meta.authors.length === 0) return ''
  const items = meta.authors
    .map((author) => {
      const parts: string[] = [
        `<span class="author-name">${escapeHtml(author.name)}</span>`
      ]
      if (author.affiliation) {
        parts.push(
          `<span class="author-affiliation">${escapeHtml(author.affiliation)}</span>`
        )
      }
      if (author.email) {
        parts.push(
          `<a class="author-email" href="mailto:${escapeHtml(author.email)}">${escapeHtml(author.email)}</a>`
        )
      }
      return `      <div class="paper-author">\n        ${parts.join('\n        ')}\n      </div>`
    })
    .join('\n')
  return `    <section class="paper-authors">\n${items}\n    </section>\n`
}

function renderAbstract(meta: PaperMeta): string {
  if (!meta.abstract) return ''
  const paragraphs = meta.abstract
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `    <p>${escapeHtml(p)}</p>`)
    .join('\n')
  return `  <section class="paper-abstract">\n    <h2>Abstract</h2>\n${paragraphs}\n  </section>\n`
}

function renderKeywords(meta: PaperMeta): string {
  if (meta.keywords.length === 0) return ''
  const list = meta.keywords.map((k) => escapeHtml(k)).join(', ')
  return `  <section class="paper-keywords">\n    <h2>Keywords</h2>\n    <p>${list}</p>\n  </section>\n`
}

function renderHeader(meta: PaperMeta): string {
  const title = meta.title ?? 'Untitled'
  let out = `  <header class="paper-header">\n`
  out += `    <h1 class="paper-title">${escapeHtml(title)}</h1>\n`
  if (meta.subtitle) {
    out += `    <p class="paper-subtitle">${escapeHtml(meta.subtitle)}</p>\n`
  }
  out += renderAuthors(meta)
  if (meta.date) {
    out += `    <p class="paper-date">${escapeHtml(meta.date)}</p>\n`
  }
  out += `  </header>\n`
  return out
}

function renderCss(css: CssMode, hasMath: boolean): string {
  let out = ''
  if (hasMath) {
    // KaTeX HTML output is static; only its stylesheet (and web fonts)
    // are needed at view time. See README for fully-offline usage.
    out += `  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@${katexVersion()}/dist/katex.min.css" crossorigin="anonymous">\n`
  }
  if (css.mode === 'link') {
    out += `  <link rel="stylesheet" href="${escapeHtml(css.href)}">\n`
  } else {
    out += `  <style>\n${css.content}\n  </style>\n`
  }
  return out
}

export function renderDocument(options: TemplateOptions): string {
  const { meta, contentHtml, lang, css, hasMath } = options
  const title = meta.title ?? 'Untitled'

  const description = meta.abstract
    ? `  <meta name="description" content="${escapeHtml(
        meta.abstract.split(/\n{2,}/)[0].replace(/\s+/g, ' ').trim()
      )}">\n`
    : ''
  const authorMeta =
    meta.authors.length > 0
      ? `  <meta name="author" content="${escapeHtml(meta.authors.map((a) => a.name).join(', '))}">\n`
      : ''
  const keywordsMeta =
    meta.keywords.length > 0
      ? `  <meta name="keywords" content="${escapeHtml(meta.keywords.join(', '))}">\n`
      : ''

  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="generator" content="paperify">
${authorMeta}${keywordsMeta}${description}  <title>${escapeHtml(title)}</title>
${renderCss(css, hasMath)}</head>
<body>
<main class="paper">
${renderHeader(meta)}${renderAbstract(meta)}${renderKeywords(meta)}  <article class="paper-content">
${contentHtml}
  </article>
</main>
</body>
</html>
`
}
