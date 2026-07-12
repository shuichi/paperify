/**
 * citationSyntax.ts
 *
 * Pure citation syntax recognition for Markdown text like `[@key]` or
 * `[@a; @b]`. Kept separate from citations.ts so that callers that only
 * need to *detect* citations (bibliography resolution, editors) never load
 * the heavy citation-js/citeproc stack.
 */

export const CITATION_PATTERN = /\[([^[\]\n]*@[^[\]\n]+)\]/g
export const CITATION_KEY_PATTERN = /^@([A-Za-z0-9_:.#$%&+?<>~/-]+)$/

export interface CitationItem {
  id: string
}

export function parseCitationCluster(
  value: string
): CitationItem[] | undefined {
  const parts = value
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.length === 0) return undefined

  const items: CitationItem[] = []
  for (const part of parts) {
    const match = CITATION_KEY_PATTERN.exec(part)
    if (!match) return undefined
    items.push({ id: match[1] })
  }

  return items
}

export function textContainsCitation(value: string): boolean {
  let match: RegExpExecArray | null

  CITATION_PATTERN.lastIndex = 0
  while ((match = CITATION_PATTERN.exec(value)) !== null) {
    if (parseCitationCluster(match[1])) return true
  }

  return false
}
