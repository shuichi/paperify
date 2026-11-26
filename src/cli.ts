#!/usr/bin/env node
/**
 * cli.ts
 *
 * The `paperify` command line interface.
 *
 *   paperify input.md -o output.html   # compile Markdown to HTML
 *   paperify input.md -o output.pdf
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { convert } from './convert.js'
import { copyAssets, resolveLocalAsset } from './assets.js'
import { compileHtml } from './compile.js'
import { renderPdf } from './pdf.js'
import { assertDistinctOutputPath } from './outputPath.js'
import { createMermaidRenderer } from './mermaid.js'
import { defaultCssPath, readStyleBundle } from './styleSources.js'
import type { CssMode } from './template.js'
import { DEFAULT_CSL_STYLE, fetchCslStyle } from './csl.js'
import { parseFrontmatter } from './frontmatter.js'
import {
  defaultBibPathForInput,
  extractTrailingBibtexBlock,
  markdownContainsCitations,
  resolveBibliographySource
} from './bibliography.js'

const HELP = `paperify — CSS-first academic Markdown-to-HTML publishing

Usage:
  paperify <input.md> [options]

Options:
  --output, -o <file>   Compile to this path; .pdf also writes sibling .html
                        (default: <input>.html)
  --css <file>          Custom CSS file path (default: bundled paperify.css)
  --bib, --bibliography <file>
                        BibTeX bibliography file (default: frontmatter
                        bibliography, terminal bibtex block, or <input>.bib)
  --csl <id>            Zotero Style Repository CSL style ID
                        (default: computing-surveys)
  --embed-css           Compatibility option; compiled HTML always embeds CSS
  --unsafe-html         Allow sanitized raw HTML inside Markdown
  --title <title>       Override title from frontmatter
  --lang <lang>         HTML language attribute (default: en)
  --browser-executable <file>
                        Chrome/Chromium executable for Mermaid and PDF output
  --watch               Rebuild on file changes
  --copy-assets         Compatibility option; images/posters compile inline
  --help                Show this help

Examples:
  paperify paper.md -o dist/paper.html
  paperify paper.md -o dist/paper.pdf
  paperify paper.md --css mytheme.css --watch
`

interface CliOptions {
  input: string
  output: string
  cssFile?: string
  bibFile?: string
  cslStyle: string
  embedCss: boolean
  unsafeHtml: boolean
  title?: string
  lang?: string
  browserExecutable?: string
  watch: boolean
  copyAssets: boolean
}

class CliError extends Error {}

function parseArgs(argv: string[]): CliOptions | 'help' {
  const positional: string[] = []
  let output: string | undefined
  let cssFile: string | undefined
  let bibFile: string | undefined
  let cslStyle = DEFAULT_CSL_STYLE
  let embedCss = false
  let unsafeHtml = false
  let title: string | undefined
  let lang: string | undefined
  let browserExecutable: string | undefined
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
      case '--fontset':
        throw new CliError(
          '--fontset has been removed. Set lang: ja in frontmatter, or pass --lang ja, to use Japanese font defaults.'
        )
      case '--bib':
      case '--bibliography':
        bibFile = takeValue(arg, i)
        i++
        break
      case '--csl':
        cslStyle = takeValue(arg, i)
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
      case '--browser-executable':
        browserExecutable = takeValue(arg, i)
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
    bibFile,
    cslStyle,
    embedCss,
    unsafeHtml,
    title,
    lang,
    browserExecutable,
    watch,
    copyAssets: copy
  }
}

function isPdfOutput(output: string): boolean {
  return path.extname(output).toLowerCase() === '.pdf'
}

function compiledHtmlPathForOutput(output: string): string {
  if (!isPdfOutput(output)) return output
  const parsed = path.parse(output)
  return path.join(parsed.dir, `${parsed.name}.html`)
}

async function buildOnce(
  options: CliOptions,
  trackFile?: (filePath: string) => void
): Promise<void> {
  trackFile?.(options.input)
  if (!fs.existsSync(options.input)) {
    throw new CliError(`Input file not found: ${options.input}`)
  }

  const outputIsPdf = isPdfOutput(options.output)
  const compiledHtmlPath = path.resolve(compiledHtmlPathForOutput(options.output))
  assertDistinctOutputPath(options.input, compiledHtmlPath)
  if (outputIsPdf) assertDistinctOutputPath(options.input, options.output)

  const rawMarkdown = fs.readFileSync(options.input, 'utf8')
  const extracted = extractTrailingBibtexBlock(rawMarkdown)
  const markdown = extracted.markdown
  const frontmatter = parseFrontmatter(markdown)
  const { meta } = frontmatter
  trackFile?.(options.cssFile ?? defaultCssPath())
  const styleBundle = readStyleBundle(options)
  const inputDir = path.dirname(path.resolve(options.input))
  const bibliographySource = resolveBibliographySource({
    inputPath: options.input,
    cliBibFile: options.bibFile,
    frontmatterBibliography: meta.bibliography,
    embeddedBibtex: extracted.bibtex
  })
  if (!bibliographySource) trackFile?.(defaultBibPathForInput(options.input))
  let citations:
    | { bibtex: string; cslXml: string; styleId: string }
    | undefined

  if (bibliographySource) {
    let bibtex: string
    if (bibliographySource.kind === 'file') {
      trackFile?.(bibliographySource.path)
      if (!fs.existsSync(bibliographySource.path)) {
        throw new CliError(`BibTeX file not found: ${bibliographySource.path}`)
      }
      bibtex = fs.readFileSync(bibliographySource.path, 'utf8')
    } else {
      bibtex = bibliographySource.bibtex
    }

    citations = {
      bibtex,
      cslXml: await fetchCslStyle(options.cslStyle),
      styleId: options.cslStyle
    }
  } else if (markdownContainsCitations(frontmatter.content)) {
    throw new CliError(
      `Citation found, but no bibliography was provided. Add --bib, frontmatter bibliography, a terminal bibtex code block, or ${path.resolve(defaultBibPathForInput(options.input))}.`
    )
  }

  const css: CssMode = { mode: 'embed', content: styleBundle.content }
  const mermaidRenderer = createMermaidRenderer(
    {
      browserExecutablePath: options.browserExecutable
        ? path.resolve(options.browserExecutable)
        : undefined
    },
    {
      launch: async ({ executablePath }) => {
        const { default: puppeteer } = await import('puppeteer')
        return puppeteer.launch(executablePath ? { executablePath } : {})
      }
    }
  )

  const result = await (async () => {
    try {
      return await convert(markdown, {
        css,
        unsafeHtml: options.unsafeHtml,
        title: options.title,
        lang: options.lang,
        citations,
        mermaid: {
          renderer: mermaidRenderer.render,
          failureMode: 'error'
        }
      })
    } finally {
      await mermaidRenderer.dispose()
    }
  })()

  const outputDir = path.dirname(path.resolve(options.output))
  if (trackFile) {
    for (const ref of result.assets) {
      const asset = resolveLocalAsset(ref, inputDir)
      if (asset) trackFile(asset.filePath)
    }
  }
  fs.mkdirSync(outputDir, { recursive: true })

  const compiled = compileHtml({
    html: result.html,
    inputDir
  })
  fs.writeFileSync(compiledHtmlPath, compiled.html, 'utf8')

  if (outputIsPdf) {
    // The CLI supplies full puppeteer (with its managed browser downloads);
    // other hosts of paperify/pdf inject their own launcher instead.
    const { default: puppeteer } = await import('puppeteer')
    await renderPdf(
      {
        htmlPath: compiledHtmlPath,
        outputPath: path.resolve(options.output),
        browserExecutablePath: options.browserExecutable
          ? path.resolve(options.browserExecutable)
          : undefined,
        headerTemplate: result.meta.headerTemplate,
        footerTemplate: result.meta.footerTemplate
      },
      { launch: (launchOptions) => puppeteer.launch(launchOptions) }
    )
  }

  for (const warning of [...result.warnings, ...compiled.warnings]) {
    console.warn(`paperify: warning: ${warning}`)
  }

  if (options.copyAssets) {
    const { copied, missing } = copyAssets(result.assets, inputDir, outputDir)
    if (copied.length > 0) {
      console.log(`paperify: copied ${copied.length} asset(s): ${copied.join(', ')}`)
    }
    for (const asset of missing) {
      console.warn(`paperify: warning: asset could not be copied: ${asset}`)
    }
  }

  console.log(`paperify: compiled ${compiledHtmlPath}`)
  if (outputIsPdf) {
    console.log(`paperify: wrote ${options.output}`)
  }
}

function watchAndRebuild(options: CliOptions): () => void {
  const targets = new Set<string>()
  let timer: NodeJS.Timeout | undefined
  let running = false
  let pending = false
  let stopped = false
  const onChange = (current: fs.Stats, previous: fs.Stats) => {
    // watchFile also reports an initially missing optional bibliography.
    if (!current.nlink && !previous.nlink) return
    clearTimeout(timer)
    timer = setTimeout(rebuild, 120)
  }

  async function rebuild(): Promise<void> {
    if (running) {
      pending = true
      return
    }
    running = true
    const nextTargets = new Set<string>()
    try {
      await buildOnce(options, (filePath) => {
        const target = path.resolve(filePath)
        nextTargets.add(target)
        if (stopped || targets.has(target)) return
        // Watch the path across editor saves that replace the original inode.
        fs.watchFile(target, { interval: 250 }, onChange)
        targets.add(target)
      })
    } catch (err) {
      console.error(`paperify: error: ${err instanceof Error ? err.message : err}`)
    }
    for (const target of targets) {
      if (nextTargets.has(target)) continue
      fs.unwatchFile(target, onChange)
      targets.delete(target)
    }
    running = false
    if (pending && !stopped) {
      pending = false
      void rebuild()
    }
  }

  void rebuild()
  console.log('paperify: watching for changes (press Ctrl+C to stop)…')
  return () => {
    stopped = true
    clearTimeout(timer)
    for (const target of targets) fs.unwatchFile(target, onChange)
    targets.clear()
  }
}

export async function main(
  argv: string[] = process.argv.slice(2)
): Promise<void | (() => void)> {
  let options: CliOptions | 'help'
  try {
    options = parseArgs(argv)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
    return
  }

  if (options === 'help') {
    console.log(HELP)
    return
  }

  if (options.watch) return watchAndRebuild(options)

  try {
    await buildOnce(options)
  } catch (err) {
    console.error(`paperify: error: ${err instanceof Error ? err.message : err}`)
    process.exitCode = 1
  }
}

if (import.meta.main) void main()
