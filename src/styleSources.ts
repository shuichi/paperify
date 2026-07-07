import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface StyleSourceOptions {
  /** Custom base CSS file. Defaults to bundled paperify.css. */
  cssFile?: string
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

export function resolveCssPaths(options: StyleSourceOptions): string[] {
  const baseCssPath = options.cssFile
    ? path.resolve(options.cssFile)
    : defaultCssPath()

  if (!fs.existsSync(baseCssPath) || !fs.statSync(baseCssPath).isFile()) {
    throw new Error(`CSS file not found: ${baseCssPath}`)
  }

  return [baseCssPath]
}

export function readStyleBundle(options: StyleSourceOptions): StyleBundle {
  const paths = resolveCssPaths(options)
  const content = paths
    .map((cssPath) => fs.readFileSync(cssPath, 'utf8'))
    .join('\n\n')
  return { paths, content }
}
