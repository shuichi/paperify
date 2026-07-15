/**
 * pdf.ts
 *
 * PDF export for Paperify documents. Deliberately free of any dependency on
 * the `vscode` module so it can be tested directly; the command wiring,
 * progress UI, and save dialog live in exportController.ts.
 *
 * The flow mirrors the CLI (`paperify input.md -o output.pdf`):
 *
 *   buildCompiledHtml()  shared Markdown → compiled standalone HTML pipeline
 *                        (plain Paperify CSS — no webview reset, no CSP)
 *   (here)               writes the HTML into a private temp directory
 *   renderPdf()          paperify/pdf drives puppeteer-core against the
 *                        user's locally installed Chrome/Edge/Chromium
 *   (here)               moves the finished PDF to the destination, so a
 *                        failed render never leaves a partial file there
 *   (here)               removes the temp directory in all cases
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  BrowserLaunchError,
  renderPdf,
  type PdfBrowserLauncher
} from 'paperify/pdf'

import { buildCompiledHtml } from './build'

export const MISSING_BROWSER_HELP =
  'PDF export needs a locally installed Chrome, Edge, or Chromium. Install ' +
  'Google Chrome, or point the "paperify.pdf.browserExecutable" setting at ' +
  'a browser executable, and try again.'

export interface BrowserProbe {
  platform?: NodeJS.Platform
  env?: Record<string, string | undefined>
  exists?: (candidate: string) => boolean
}

/**
 * Well-known install locations for Chromium-family browsers, most specific
 * platform first. Detection is a plain existence check so it stays fast and
 * deterministic; anything unusual is covered by the executable setting or by
 * puppeteer-core's own `channel: "chrome"` lookup at launch time.
 */
function browserCandidates(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>
): string[] {
  if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    ]
  }

  if (platform === 'win32') {
    const roots = [
      env['PROGRAMFILES'],
      env['PROGRAMFILES(X86)'],
      env['LOCALAPPDATA']
    ].filter((root): root is string => Boolean(root))
    const suffixes = [
      'Google\\Chrome\\Application\\chrome.exe',
      'Microsoft\\Edge\\Application\\msedge.exe',
      'Chromium\\Application\\chrome.exe'
    ]
    return suffixes.flatMap((suffix) =>
      roots.map((root) => path.win32.join(root, suffix))
    )
  }

  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/opt/google/chrome/chrome',
    '/usr/bin/microsoft-edge',
    '/usr/bin/microsoft-edge-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium'
  ]
}

/** Find a locally installed Chromium-family browser, or undefined. */
export function detectBrowserExecutable(probe: BrowserProbe = {}): string | undefined {
  const platform = probe.platform ?? process.platform
  const env = probe.env ?? process.env
  const exists = probe.exists ?? fs.existsSync
  return browserCandidates(platform, env).find((candidate) => exists(candidate))
}

/**
 * Default launcher: puppeteer-core against an explicit executable, or its
 * built-in system Chrome lookup when detection found nothing. The import is
 * lazy so activating the extension never pays for puppeteer-core.
 */
const launchWithPuppeteerCore: PdfBrowserLauncher = async ({ executablePath }) => {
  const { default: puppeteer } = await import('puppeteer-core')
  return puppeteer.launch(
    executablePath ? { executablePath } : { channel: 'chrome' }
  )
}

export interface ExportPdfRequest {
  /** Current (possibly unsaved) Markdown source. */
  markdown: string
  /** Directory used to resolve local asset references. */
  inputDir: string
  /** Absolute path of the document on disk; undefined for untitled files. */
  documentPath?: string
  /** Destination PDF path chosen by the user. */
  outputPath: string
  /** Paperify CSS embedded into the generated document. */
  css: string
  /** The `paperify.pdf.browserExecutable` setting; empty means auto-detect. */
  browserExecutablePath?: string
  /** Test seam; defaults to puppeteer-core with the user's local browser. */
  launch?: PdfBrowserLauncher
  /** Test seam; defaults to the CLI's cached Zotero style download. */
  fetchCslXml?: (styleId: string) => Promise<string>
}

export interface ExportPdfResult {
  warnings: string[]
}

function resolveExecutablePath(configured: string | undefined): string | undefined {
  const trimmed = configured?.trim()
  if (trimmed) {
    if (!fs.existsSync(trimmed)) {
      throw new BrowserLaunchError(
        `The configured browser executable was not found: ${trimmed}\n\n${MISSING_BROWSER_HELP}`
      )
    }
    return trimmed
  }
  return detectBrowserExecutable()
}

async function moveFile(from: string, to: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(to), { recursive: true })
  try {
    await fs.promises.rename(from, to)
  } catch (error) {
    // Temp and destination can live on different volumes.
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    await fs.promises.copyFile(from, to)
    await fs.promises.unlink(from)
  }
}

/** Export a Paperify document to a PDF file. */
export async function exportPdfToFile(
  request: ExportPdfRequest
): Promise<ExportPdfResult> {
  const executablePath = resolveExecutablePath(request.browserExecutablePath)

  const built = await buildCompiledHtml({
    markdown: request.markdown,
    inputDir: request.inputDir,
    documentPath: request.documentPath,
    css: request.css,
    strictCitations: true,
    fetchCslXml: request.fetchCslXml
  })

  const baseName = request.documentPath
    ? path.basename(request.documentPath, path.extname(request.documentPath))
    : 'document'

  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'paperify-pdf-'))
  try {
    const htmlPath = path.join(tempDir, `${baseName}.html`)
    const tempPdfPath = path.join(tempDir, `${baseName}.pdf`)
    await fs.promises.writeFile(htmlPath, built.html, 'utf8')

    await renderPdf(
      {
        htmlPath,
        outputPath: tempPdfPath,
        browserExecutablePath: executablePath,
        headerTemplate: built.meta.headerTemplate,
        footerTemplate: built.meta.footerTemplate
      },
      {
        launch: request.launch ?? launchWithPuppeteerCore,
        missingBrowserHelp: MISSING_BROWSER_HELP
      }
    )

    // Only a fully rendered PDF ever reaches the destination.
    await moveFile(tempPdfPath, request.outputPath)
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  }

  return { warnings: built.warnings }
}
