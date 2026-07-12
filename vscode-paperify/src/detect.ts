/**
 * detect.ts
 *
 * Decides whether a Markdown source is a Paperify document. Reuses the
 * Paperify frontmatter parser instead of pattern-matching the YAML block:
 * only the YAML boolean `paperify: true` opts a document in.
 */

import { parseFrontmatter } from 'paperify/api'

export function isPaperifyDocument(source: string): boolean {
  try {
    return parseFrontmatter(source).meta.paperify === true
  } catch {
    // Invalid YAML while the user is mid-edit must never crash detection.
    return false
  }
}
