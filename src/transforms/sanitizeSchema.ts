/**
 * transforms/sanitizeSchema.ts
 *
 * Allowlist schema used by rehype-sanitize when --unsafe-html is enabled.
 * The goal is "safe academic HTML": text semantics, tables, figures,
 * images, and media elements (video/source) — but no scripts, no event
 * handlers, no dangerous URLs.
 *
 * Note that sanitization runs over the whole tree, so the schema must
 * also preserve what Paperify's own transforms and remark-math emit
 * (figure classes, `language-math` code classes, etc.). rehype-katex
 * runs *after* sanitization, so KaTeX's own output never needs to pass
 * through the allowlist.
 */

import { defaultSchema } from 'rehype-sanitize'
import type { Root } from 'hast'
import { visit } from 'unist-util-visit'

type Schema = typeof defaultSchema

function extend<T>(base: T[] | null | undefined, extra: T[]): T[] {
  return [...(base ?? []), ...extra]
}

export const sanitizeSchema: Schema = {
  ...defaultSchema,
  tagNames: extend(defaultSchema.tagNames, [
    'video',
    'source',
    'figure',
    'figcaption',
    'section',
    'mark',
    'kbd',
    'abbr',
    'cite',
    'caption',
    'colgroup',
    'col'
  ]),
  attributes: {
    ...defaultSchema.attributes,
    // Class names carry no script risk and are required for Paperify's
    // figure / media / wide styling hooks to survive sanitization.
    '*': extend(defaultSchema.attributes?.['*'], ['className']),
    video: [
      'src',
      'poster',
      'controls',
      'loop',
      'muted',
      'autoPlay',
      'playsInline',
      'preload',
      'width',
      'height'
    ],
    source: ['src', 'type'],
    img: extend(defaultSchema.attributes?.img, ['width', 'height', 'loading']),
    a: extend(defaultSchema.attributes?.a, ['rel', 'target']),
    abbr: ['title'],
    // Preserve remark-math's marker classes so rehype-katex (which runs
    // after sanitize) can still find and render the math nodes.
    code: extend(defaultSchema.attributes?.code, [
      ['className', /^language-/, 'math-inline', 'math-display']
    ]),
    th: extend(defaultSchema.attributes?.th, ['colSpan', 'rowSpan', 'scope']),
    td: extend(defaultSchema.attributes?.td, ['colSpan', 'rowSpan'])
  },
  protocols: {
    ...defaultSchema.protocols,
    src: ['http', 'https'],
    poster: ['http', 'https'],
    href: ['http', 'https', 'mailto', 'tel']
  }
}

export default sanitizeSchema

/** Check Markdown and directive URLs even when the raw HTML pipeline is off. */
export function rehypeMarkdownUrls() {
  return (tree: Root) => {
    visit(tree, 'element', ({ properties }) => {
      for (const key of ['href', 'src', 'poster']) {
        const url = properties[key]
        if (typeof url !== 'string') continue
        // Relative references have no protocol. Use browser URL parsing for
        // absolute URLs so case and whitespace are handled consistently.
        const protocol = URL.parse(url)?.protocol
        if (
          protocol === 'javascript:' || protocol === 'vbscript:' ||
          (key === 'href' && protocol === 'data:')
        ) {
          delete properties[key]
        }
      }
    })
  }
}

/** Keep fragment links pointed at IDs and named anchors renamed by sanitize. */
export function rehypeSanitizedFragmentLinks() {
  return (tree: Root) => {
    const prefix = sanitizeSchema.clobberPrefix
    if (!prefix) return
    const targets = new Set<string>()
    visit(tree, 'element', ({ properties, tagName }) => {
      if (typeof properties.id === 'string') targets.add(properties.id)
      if (tagName === 'a' && typeof properties.name === 'string') {
        targets.add(properties.name)
      }
    })
    visit(tree, 'element', ({ tagName, properties }) => {
      const { href } = properties
      if (tagName !== 'a' || typeof href !== 'string' || !href.startsWith('#')) return
      const fragment = href.slice(1)
      let target = fragment
      try {
        target = decodeURIComponent(fragment)
      } catch {
        // A fragment may literally contain a percent sign.
      }
      if (targets.has(prefix + fragment) || targets.has(prefix + target)) {
        properties.href = '#' + prefix + fragment
      }
    })
  }
}
