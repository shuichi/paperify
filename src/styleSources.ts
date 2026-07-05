import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface StyleSourceOptions {
  /** Custom base CSS file. Defaults to bundled paperify.css. */
  cssFile?: string
  /** Bundled fontset name, e.g. "japanese". */
  fontset?: string
}

export interface StyleBundle {
  /** CSS source paths in cascade order. */
  paths: string[]
  /** CSS content joined in cascade order. */
  content: string
}

function bundledStylesDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(here, '..', 'styles')
}

/** Locate the stylesheet bundled with the package (styles/paperify.css). */
export function defaultCssPath(): string {
  return path.join(bundledStylesDir(), 'paperify.css')
}

function fontsetDir(): string {
  return path.join(bundledStylesDir(), 'fontset')
}

export function listFontsets(): string[] {
  const dir = fontsetDir()
  if (!fs.existsSync(dir)) return []

  return fs
    .readdirSync(dir)
    .filter((entry) => entry.endsWith('.css'))
    .filter((entry) => fs.statSync(path.join(dir, entry)).isFile())
    .map((entry) => path.basename(entry, '.css'))
    .sort()
}

function availableFontsetsMessage(): string {
  const available = listFontsets()
  if (available.length === 0) return ''
  return ` Available fontsets: ${available.join(', ')}.`
}

export function resolveFontsetPath(fontset: string): string {
  const name = fontset.trim()
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    throw new Error(
      `Invalid fontset name: ${fontset}.${availableFontsetsMessage()}`
    )
  }

  const cssPath = path.resolve(fontsetDir(), `${name}.css`)
  if (!fs.existsSync(cssPath) || !fs.statSync(cssPath).isFile()) {
    throw new Error(`Unknown fontset: ${name}.${availableFontsetsMessage()}`)
  }

  return cssPath
}

export function resolveCssPaths(options: StyleSourceOptions): string[] {
  const baseCssPath = options.cssFile
    ? path.resolve(options.cssFile)
    : defaultCssPath()

  if (!fs.existsSync(baseCssPath) || !fs.statSync(baseCssPath).isFile()) {
    throw new Error(`CSS file not found: ${baseCssPath}`)
  }

  const paths = [baseCssPath]
  if (options.fontset) {
    paths.push(resolveFontsetPath(options.fontset))
  }
  return paths
}

export function readStyleBundle(options: StyleSourceOptions): StyleBundle {
  const paths = resolveCssPaths(options)
  const content = paths
    .map((cssPath) => fs.readFileSync(cssPath, 'utf8'))
    .join('\n\n')
  return { paths, content }
}
