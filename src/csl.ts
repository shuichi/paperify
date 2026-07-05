export const DEFAULT_CSL_STYLE = 'computing-surveys'

const ZOTERO_STYLE_BASE_URL = 'https://www.zotero.org/styles'
const CSL_STYLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const styleCache = new Map<string, string>()

export interface CslFetchResponse {
  ok: boolean
  status: number
  statusText: string
  text(): Promise<string>
}

export type CslFetch = (url: string) => Promise<CslFetchResponse>

export async function fetchCslStyle(
  styleId = DEFAULT_CSL_STYLE,
  fetchImpl: CslFetch = (url) => fetch(url)
): Promise<string> {
  const normalizedStyleId = normalizeCslStyleId(styleId)
  const cached = styleCache.get(normalizedStyleId)
  if (cached) return cached

  const xml = await fetchCslStyleXml(normalizedStyleId, fetchImpl)
  const parentStyleId = independentParentStyleId(xml)
  const resolvedXml =
    parentStyleId && parentStyleId !== normalizedStyleId
      ? await fetchCslStyleXml(parentStyleId, fetchImpl)
      : xml

  styleCache.set(normalizedStyleId, resolvedXml)
  return resolvedXml
}

export function normalizeCslStyleId(styleId: string): string {
  const normalized = styleId.trim()
  if (!CSL_STYLE_ID_PATTERN.test(normalized)) {
    throw new Error(
      `Invalid CSL style id: ${styleId}. Use a Zotero Style Repository id such as computing-surveys.`
    )
  }
  return normalized
}

export function cslStyleUrl(styleId: string): string {
  return `${ZOTERO_STYLE_BASE_URL}/${normalizeCslStyleId(styleId)}`
}

export function clearCslStyleCache(): void {
  styleCache.clear()
}

async function fetchCslStyleXml(
  styleId: string,
  fetchImpl: CslFetch
): Promise<string> {
  const url = cslStyleUrl(styleId)
  let response: CslFetchResponse
  try {
    response = await fetchImpl(url)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Failed to download CSL style "${styleId}" from ${url}: ${message}`)
  }

  if (!response.ok) {
    const status = response.statusText
      ? `${response.status} ${response.statusText}`
      : String(response.status)
    throw new Error(`Failed to download CSL style "${styleId}" from ${url}: ${status}`)
  }

  const xml = await response.text()
  if (!/<style[\s>]/.test(xml)) {
    throw new Error(`Downloaded CSL style "${styleId}" did not look like a CSL XML file`)
  }
  return xml
}

function independentParentStyleId(xml: string): string | undefined {
  const linkMatch = /<link\b[^>]*\brel=["']independent-parent["'][^>]*>/i.exec(xml)
  if (!linkMatch) return undefined

  const hrefMatch = /\bhref=["']([^"']+)["']/i.exec(linkMatch[0])
  if (!hrefMatch) return undefined

  const match = /zotero\.org\/styles\/([A-Za-z0-9._-]+)/i.exec(hrefMatch[1])
  return match ? normalizeCslStyleId(match[1]) : undefined
}
