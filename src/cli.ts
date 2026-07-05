#!/usr/bin/env node
/**
 * cli.ts
 *
 * The `paperify` command line interface.
 *
 *   paperify input.md -o output.html
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { convert } from './convert.js'
import { copyAssets } from './assets.js'
import type { CssMode } from './template.js'

const HELP = `paperify — CSS-first academic Markdown-to-HTML publishing

Usage:
  paperify <input.md> [options]

Options:
  --output, -o <file>   Output HTML path (default: <input>.html)
  --css <file>          Custom CSS file path (default: bundled paperify.css)
  --embed-css           Embed CSS into the HTML instead of linking it
  --unsafe-html         Allow sanitized raw HTML inside Markdown
  --title <title>       Override title from frontmatter
  --lang <lang>         HTML language attribute (default: en)
  --watch               Rebuild on file changes
  --copy-assets         Copy local image/video assets to the output directory
  --help                Show this help

Examples:
  paperify paper.md -o dist/paper.html
  paperify paper.md -o dist/paper.html --embed-css --copy-assets
  paperify paper.md --css mytheme.css --watch
`

interface CliOptions {
  input: string
  output: string
  cssFile?: string
  embedCss: boolean
  unsafeHtml: boolean
  title?: string
  lang?: string
  watch: boolean
  copyAssets: boolean
}

class CliError extends Error {}

function parseArgs(argv: string[]): CliOptions | 'help' {
  const positional: string[] = []
  let output: string | undefined
  let cssFile: string | undefined
  let embedCss = false
  let unsafeHtml = false
  let title: string | undefined
  let lang: string | undefined
  let watch = false
  let copy = false

  const takeValue = (flag: string, i: number): string => {
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('-')) {
      throw new CliError(`Option ${flag} requires a value`)
    }
    return value
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case '--help':
      case '-h':
        return 'help'
      case '--output':
      case '-o':
        output = takeValue(arg, i)
        i++
        break
      case '--css':
        cssFile = takeValue(arg, i)
        i++
        break
      case '--embed-css':
        embedCss = true
        break
      case '--unsafe-html':
        unsafeHtml = true
        break
      case '--title':
        title = takeValue(arg, i)
        i++
        break
      case '--lang':
        lang = takeValue(arg, i)
        i++
        break
      case '--watch':
        watch = true
        break
      case '--copy-assets':
        copy = true
        break
      default:
        if (arg.startsWith('-')) {
          throw new CliError(`Unknown option: ${arg}\n\n${HELP}`)
        }
        positional.push(arg)
    }
  }

  if (positional.length === 0) {
    throw new CliError(`No input file given.\n\n${HELP}`)
  }
  if (positional.length > 1) {
    throw new CliError(`Expected a single input file, got: ${positional.join(', ')}`)
  }

  const input = positional[0]
  const resolvedOutput =
    output ??
    path.join(
      path.dirname(input),
      path.basename(input, path.extname(input)) + '.html'
    )

  return {
    input,
    output: resolvedOutput,
    cssFile,
    embedCss,
    unsafeHtml,
    title,
    lang,
    watch,
    copyAssets: copy
  }
}

/** Locate the stylesheet bundled with the package (styles/paperify.css). */
function defaultCssPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(here, '..', 'styles', 'paperify.css')
}

function resolveCssSource(options: CliOptions): string {
  const cssPath = options.cssFile
    ? path.resolve(options.cssFile)
    : defaultCssPath()
  if (!fs.existsSync(cssPath)) {
    throw new CliError(`CSS file not found: ${cssPath}`)
  }
  return cssPath
}

async function buildOnce(options: CliOptions): Promise<void> {
  if (!fs.existsSync(options.input)) {
    throw new CliError(`Input file not found: ${options.input}`)
  }

  const markdown = fs.readFileSync(options.input, 'utf8')
  const cssPath = resolveCssSource(options)

  let css: CssMode
  if (options.embedCss) {
    css = { mode: 'embed', content: fs.readFileSync(cssPath, 'utf8') }
  } else {
    css = { mode: 'link', href: path.basename(cssPath) }
  }

  const result = await convert(markdown, {
    css,
    unsafeHtml: options.unsafeHtml,
    title: options.title,
    lang: options.lang
  })

  const outputDir = path.dirname(path.resolve(options.output))
  fs.mkdirSync(outputDir, { recursive: true })
  fs.writeFileSync(options.output, result.html, 'utf8')

  // When linking (the default), place the stylesheet next to the output
  // so the generated page works immediately.
  if (!options.embedCss) {
    const cssTarget = path.join(outputDir, path.basename(cssPath))
    if (path.resolve(cssPath) !== cssTarget) {
      fs.copyFileSync(cssPath, cssTarget)
    }
  }

  for (const warning of result.warnings) {
    console.warn(`paperify: warning: ${warning}`)
  }

  if (options.copyAssets) {
    const inputDir = path.dirname(path.resolve(options.input))
    const { copied, missing } = copyAssets(result.assets, inputDir, outputDir)
    if (copied.length > 0) {
      console.log(`paperify: copied ${copied.length} asset(s): ${copied.join(', ')}`)
    }
    for (const m of missing) {
      console.warn(`paperify: warning: asset not found, skipped: ${m}`)
    }
  }

  console.log(`paperify: wrote ${options.output}`)
}

function watchAndRebuild(options: CliOptions): void {
  const targets = new Set<string>([path.resolve(options.input)])
  if (options.cssFile) targets.add(path.resolve(options.cssFile))

  let timer: NodeJS.Timeout | undefined
  const rebuild = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      buildOnce(options).catch((err) => {
        console.error(`paperify: error: ${err instanceof Error ? err.message : err}`)
      })
    }, 120)
  }

  for (const target of targets) {
    try {
      fs.watch(target, { persistent: true }, rebuild)
    } catch (err) {
      console.warn(
        `paperify: warning: cannot watch ${target}: ${err instanceof Error ? err.message : err}`
      )
    }
  }
  console.log('paperify: watching for changes (press Ctrl+C to stop)…')
}

async function main(): Promise<void> {
  let options: CliOptions | 'help'
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
    return
  }

  if (options === 'help') {
    console.log(HELP)
    return
  }

  try {
    await buildOnce(options)
  } catch (err) {
    console.error(`paperify: error: ${err instanceof Error ? err.message : err}`)
    process.exitCode = 1
    return
  }

  if (options.watch) {
    watchAndRebuild(options)
  }
}

main()
