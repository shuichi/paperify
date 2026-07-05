/**
 * pdf.ts
 *
 * Renders Paperify HTML to PDF through Puppeteer's Chromium engine.
 * The Markdown -> compiled HTML pipeline remains unchanged; this module only
 * opens the compiled HTML file and asks Chromium to print it.
 */

import { pathToFileURL } from 'node:url'

import type { PDFOptions } from 'puppeteer'

export interface RenderPdfOptions {
  /** Compiled Paperify HTML path. */
  htmlPath: string
  /** Destination PDF path. */
  outputPath: string
  /** Optional Chromium/Chrome executable path for Puppeteer. */
  browserExecutablePath?: string
  /** Puppeteer HTML template for the print header. */
  headerTemplate?: string
  /** Puppeteer HTML template for the print footer. */
  footerTemplate?: string
}

function asPdfError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (
    message.includes('Could not find Chrome') ||
    message.includes('Could not find Chromium') ||
    message.includes('Browser was not found') ||
    message.includes('Failed to launch the browser process')
  ) {
    return new Error(
      `${message}\n\nPuppeteer could not find or launch a local browser. Run ` +
        '`npx puppeteer browsers install chrome`, or pass ' +
        '`--browser-executable <path>`, and try again.'
    )
  }
  return error instanceof Error ? error : new Error(message)
}

export function buildPdfOptions(options: RenderPdfOptions): PDFOptions {
  const hasHeaderFooter = Boolean(options.headerTemplate || options.footerTemplate)
  const pdfOptions: PDFOptions = {
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

export async function renderPdf(options: RenderPdfOptions): Promise<void> {
  try {
    const { default: puppeteer } = await import('puppeteer')
    const browser = await puppeteer.launch({
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
    throw asPdfError(error)
  }
}
