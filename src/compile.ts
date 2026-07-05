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

import { isLocalAsset } from './assets.js'

export interface CompileOptions {
  /** Complete Paperify HTML document. */
  html: string
  /** Directory used to resolve local Markdown asset references. */
  inputDir: string
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

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function inlineLocalAsset(
  ref: string,
  inputDir: string,
  warnings: string[],
  label: string
): string {
  const decoded = decodeHtmlAttribute(ref)
  if (!isLocalAsset(decoded)) return ref

  const filePath = path.resolve(inputDir, decoded)
  if (!fs.existsSync(filePath)) {
    warnings.push(`${label} asset not found, left as-is: ${decoded}`)
    return ref
  }

  return fileToDataUri(filePath)
}

function inlineAssetAttributes(
  html: string,
  inputDir: string,
  warnings: string[]
): string {
  let out = html.replace(
    /(<img\b[^>]*?\bsrc=")([^"]*)(")/gi,
    (_match, before: string, src: string, after: string) =>
      `${before}${inlineLocalAsset(src, inputDir, warnings, 'image')}${after}`
  )

  out = out.replace(
    /(<video\b[^>]*?\bposter=")([^"]*)(")/gi,
    (_match, before: string, poster: string, after: string) =>
      `${before}${inlineLocalAsset(poster, inputDir, warnings, 'video poster')}${after}`
  )

  return out
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
  let html = inlineKatexStylesheet(options.html, warnings)
  html = inlineAssetAttributes(html, options.inputDir, warnings)
  return { html, warnings }
}
