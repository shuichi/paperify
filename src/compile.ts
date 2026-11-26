/**
 * compile.ts
 *
 * Turns a generated Paperify HTML document into a self-contained compiled
 * HTML file. Paperify CSS is supplied by the caller; this module inlines
 * local image/poster assets plus KaTeX CSS and fonts.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { parse, type DefaultTreeAdapterTypes } from 'parse5'

import { resolveLocalAsset } from './assets.js'
import { escapeHtml } from './template.js'

export interface CompileOptions {
  /** Complete Paperify HTML document. */
  html: string
  /** Directory used to resolve local Markdown asset references. */
  inputDir: string
  /** Optional host URI for a local video file, e.g. in a VS Code webview. */
  resolveMediaSource?: (absolutePath: string) => string
}

export interface CompileResult {
  html: string
  warnings: string[]
}

const MIME_BY_EXT: Record<string, string> = {
  '.apng': 'image/apng',
  '.avif': 'image/avif',
  '.eot': 'application/vnd.ms-fontobject',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

function mimeForPath(filePath: string): string {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

function fileToDataUri(filePath: string): string {
  const data = fs.readFileSync(filePath)
  return `data:${mimeForPath(filePath)};base64,${data.toString('base64')}`
}

function inlineAssetAttributes(
  { html, inputDir, resolveMediaSource }: CompileOptions,
  warnings: string[]
): string {
  if (!/<(?:img|video|source)\b/i.test(html)) return html
  const replacements: { start: number; end: number; text: string }[] = []
  function rewrite(
    node: DefaultTreeAdapterTypes.Element,
    name: string,
    label: string,
    mapSource?: (absolutePath: string) => string
  ) {
    const attr = node.attrs.find((attr) => attr.name === name)
    const location = node.sourceCodeLocation?.attrs?.[name]
    if (!attr || !location) return
    const asset = resolveLocalAsset(attr.value, inputDir)
    if (!asset) return
    if (!fs.statSync(asset.filePath, { throwIfNoEntry: false })?.isFile()) {
      warnings.push(`${label} asset not found, left as-is: ${attr.value}`)
      return
    }
    const value = mapSource
      ? mapSource(asset.filePath) + asset.search + asset.hash
      : fileToDataUri(asset.filePath) + asset.hash
    replacements.push({
      start: location.startOffset,
      end: location.endOffset,
      text: `${name}="${escapeHtml(value)}"`
    })
  }
  function visit(node: DefaultTreeAdapterTypes.ChildNode) {
    if (!('tagName' in node)) return
    if (node.tagName === 'img') rewrite(node, 'src', 'image')
    if (node.tagName === 'video') rewrite(node, 'poster', 'video poster')
    if (resolveMediaSource && (node.tagName === 'source' || node.tagName === 'video')) {
      rewrite(node, 'src', 'video', resolveMediaSource)
    }
    node.childNodes.forEach(visit)
  }
  // Use the parser's decoded attribute value and splice its original source
  // range. All bytes outside the rewritten attributes (including CSS) survive.
  parse(html, { sourceCodeLocationInfo: true }).childNodes.forEach(visit)
  const parts: string[] = []
  let cursor = 0
  for (const { start, end, text } of replacements.sort((a, b) => a.start - b.start)) {
    parts.push(html.slice(cursor, start), text)
    cursor = end
  }
  parts.push(html.slice(cursor))
  return parts.join('')
}

function isExternalCssUrl(value: string): boolean {
  if (!value) return true
  if (value.startsWith('#')) return true
  if (value.startsWith('//')) return true
  if (value.startsWith('data:')) return true
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return true
  return path.isAbsolute(value)
}

function inlineCssUrls(css: string, cssDir: string, warnings: string[]): string {
  return css.replace(/url\((["']?)([^"')]+)\1\)/g, (match, _quote, rawUrl: string) => {
    const trimmed = rawUrl.trim()
    if (isExternalCssUrl(trimmed)) return match

    const filePath = path.resolve(cssDir, trimmed)
    if (!fs.existsSync(filePath)) {
      warnings.push(`CSS asset not found, left as-is: ${trimmed}`)
      return match
    }

    return `url("${fileToDataUri(filePath)}")`
  })
}

function styleTag(css: string): string {
  return `<style>\n${css.replace(/<\/style/gi, '<\\/style')}\n</style>`
}

function compiledKatexCss(warnings: string[]): string | undefined {
  try {
    const require = createRequire(import.meta.url)
    const cssPath = require.resolve('katex/dist/katex.min.css')
    const css = fs.readFileSync(cssPath, 'utf8')
    return inlineCssUrls(css, path.dirname(cssPath), warnings)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    warnings.push(`KaTeX stylesheet could not be compiled: ${message}`)
    return undefined
  }
}

function inlineKatexStylesheet(html: string, warnings: string[]): string {
  const katexLink =
    /<link rel="stylesheet" href="https:\/\/cdn\.jsdelivr\.net\/npm\/katex@[^"]+\/dist\/katex\.min\.css" crossorigin="anonymous">/
  if (!katexLink.test(html)) return html

  const katexCss = compiledKatexCss(warnings)
  if (!katexCss) return html

  return html.replace(
    /\s*<link rel="stylesheet" href="https:\/\/cdn\.jsdelivr\.net\/npm\/katex@[^"]+\/dist\/katex\.min\.css" crossorigin="anonymous">\n?/g,
    `  ${styleTag(katexCss)}\n`
  )
}

export function compileHtml(options: CompileOptions): CompileResult {
  const warnings: string[] = []
  const html = inlineKatexStylesheet(inlineAssetAttributes(options, warnings), warnings)
  return { html, warnings }
}
