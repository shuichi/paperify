/**
 * pdf.ts
 *
 * Renders Paperify HTML to PDF through a Chromium-based browser driven by a
 * Puppeteer-compatible launcher supplied by the host: the CLI passes full
 * `puppeteer`, the VS Code extension passes `puppeteer-core` pointed at a
 * locally installed Chrome/Edge/Chromium. This module itself never imports
 * a Puppeteer implementation, so hosts control exactly what ships.
 *
 * The Markdown -> compiled HTML pipeline remains unchanged; this module only
 * opens the compiled HTML file and asks the browser to print it.
 */

import { pathToFileURL } from 'node:url'

/** The subset of Puppeteer's PDFOptions that Paperify produces. */
export interface PaperifyPdfOptions {
  path: string
  printBackground: boolean
  preferCSSPageSize: boolean
  waitForFonts: boolean
  displayHeaderFooter?: boolean
  headerTemplate?: string
  footerTemplate?: string
}

/**
 * Structural slices of the Puppeteer API used for rendering. Both
 * `puppeteer` and `puppeteer-core` satisfy them, and tests can substitute
 * lightweight fakes without either package.
 */
export interface PdfBrowserPage {
  emulateMediaType(type: 'print'): Promise<unknown>
  goto(
    url: string,
    options: { waitUntil: Array<'load' | 'domcontentloaded'> }
  ): Promise<unknown>
  waitForNetworkIdle(options: {
    idleTime: number
    timeout: number
  }): Promise<unknown>
  bringToFront(): Promise<unknown>
  pdf(options: PaperifyPdfOptions): Promise<unknown>
}

export interface PdfBrowser {
  newPage(): Promise<PdfBrowserPage>
  close(): Promise<unknown>
}

export type PdfBrowserLauncher = (options: {
  executablePath?: string
}) => Promise<PdfBrowser>

export interface RenderPdfOptions {
  /** Compiled Paperify HTML path. */
  htmlPath: string
  /** Destination PDF path. */
  outputPath: string
  /** Optional Chromium/Chrome executable path for the launcher. */
  browserExecutablePath?: string
  /** Puppeteer HTML template for the print header. */
  headerTemplate?: string
  /** Puppeteer HTML template for the print footer. */
  footerTemplate?: string
}

export interface RenderPdfRuntime {
  /** Launches the browser; hosts supply puppeteer or puppeteer-core. */
  launch: PdfBrowserLauncher
  /**
   * Host-specific guidance appended when the browser cannot be found or
   * launched. Defaults to the CLI's Puppeteer instructions.
   */
  missingBrowserHelp?: string
}

/** Raised when the browser itself could not be found or launched. */
export class BrowserLaunchError extends Error {}

const DEFAULT_MISSING_BROWSER_HELP =
  'Puppeteer could not find or launch a local browser. Run ' +
  '`npx puppeteer browsers install chrome`, or pass ' +
  '`--browser-executable <path>`, and try again.'

function isMissingBrowserMessage(message: string): boolean {
  return (
    message.includes('Could not find Chrome') ||
    message.includes('Could not find Chromium') ||
    message.includes('Could not find Google Chrome') ||
    message.includes('Browser was not found') ||
    message.includes('Failed to launch the browser process')
  )
}

function asPdfError(error: unknown, help: string): Error {
  if (error instanceof BrowserLaunchError) return error
  const message = error instanceof Error ? error.message : String(error)
  if (isMissingBrowserMessage(message)) {
    return new BrowserLaunchError(`${message}\n\n${help}`)
  }
  return error instanceof Error ? error : new Error(message)
}

export function buildPdfOptions(options: RenderPdfOptions): PaperifyPdfOptions {
  const hasHeaderFooter = Boolean(options.headerTemplate || options.footerTemplate)
  const pdfOptions: PaperifyPdfOptions = {
    path: options.outputPath,
    printBackground: true,
    preferCSSPageSize: true,
    waitForFonts: true
  }

  if (hasHeaderFooter) {
    pdfOptions.displayHeaderFooter = true
    pdfOptions.headerTemplate = options.headerTemplate ?? ''
    pdfOptions.footerTemplate = options.footerTemplate ?? ''
  }

  return pdfOptions
}

export async function renderPdf(
  options: RenderPdfOptions,
  runtime: RenderPdfRuntime
): Promise<void> {
  const help = runtime.missingBrowserHelp ?? DEFAULT_MISSING_BROWSER_HELP
  try {
    const browser = await runtime.launch({
      executablePath: options.browserExecutablePath
    })

    try {
      const page = await browser.newPage()
      await page.emulateMediaType('print')
      await page.goto(pathToFileURL(options.htmlPath).href, {
        waitUntil: ['load', 'domcontentloaded']
      })
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 30_000 })
      await page.bringToFront()

      await page.pdf(buildPdfOptions(options))
    } finally {
      await browser.close()
    }
  } catch (error) {
    throw asPdfError(error, help)
  }
}
