import { describe, expect, it } from 'vitest'
import { pathToFileURL } from 'node:url'

import {
  BrowserLaunchError,
  buildPdfOptions,
  renderPdf,
  type PaperifyPdfOptions,
  type PdfBrowser,
  type PdfBrowserLauncher
} from '../src/pdf.js'

describe('PDF rendering options', () => {
  it('keeps header and footer rendering disabled by default', () => {
    const options = buildPdfOptions({
      htmlPath: '/tmp/input.html',
      outputPath: '/tmp/output.pdf'
    })

    expect(options).toMatchObject({
      path: '/tmp/output.pdf',
      printBackground: true,
      preferCSSPageSize: true,
      waitForFonts: true
    })
    expect(options.displayHeaderFooter).toBeUndefined()
    expect(options.headerTemplate).toBeUndefined()
    expect(options.footerTemplate).toBeUndefined()
  })

  it('enables Puppeteer header and footer templates when provided', () => {
    const headerTemplate =
      '<div><span class="date"></span> <span class="title"></span></div>'
    const footerTemplate =
      '<div><span class="pageNumber"></span>/<span class="totalPages"></span></div>'

    const options = buildPdfOptions({
      htmlPath: '/tmp/input.html',
      outputPath: '/tmp/output.pdf',
      headerTemplate,
      footerTemplate
    })

    expect(options.displayHeaderFooter).toBe(true)
    expect(options.headerTemplate).toBe(headerTemplate)
    expect(options.footerTemplate).toBe(footerTemplate)
  })
})

interface FakeBrowserRun {
  launcher: PdfBrowserLauncher
  calls: string[]
  launchOptions: Array<{ executablePath?: string }>
  gotoUrls: string[]
  pdfOptions: PaperifyPdfOptions[]
}

function fakeBrowser(overrides: { pdfError?: Error } = {}): FakeBrowserRun {
  const run: FakeBrowserRun = {
    calls: [],
    launchOptions: [],
    gotoUrls: [],
    pdfOptions: [],
    launcher: async (options) => {
      run.calls.push('launch')
      run.launchOptions.push(options)
      const browser: PdfBrowser = {
        newPage: async () => ({
          emulateMediaType: async (type) => run.calls.push(`emulateMediaType:${type}`),
          goto: async (url) => {
            run.calls.push('goto')
            run.gotoUrls.push(url)
          },
          waitForNetworkIdle: async () => run.calls.push('waitForNetworkIdle'),
          bringToFront: async () => run.calls.push('bringToFront'),
          pdf: async (options) => {
            run.calls.push('pdf')
            run.pdfOptions.push(options)
            if (overrides.pdfError) throw overrides.pdfError
          }
        }),
        close: async () => run.calls.push('close')
      }
      return browser
    }
  }
  return run
}

describe('renderPdf', () => {
  it('drives the injected browser with print media emulation and CLI options', async () => {
    const run = fakeBrowser()

    await renderPdf(
      {
        htmlPath: '/tmp/input.html',
        outputPath: '/tmp/output.pdf',
        browserExecutablePath: '/opt/chrome',
        headerTemplate: '<div>header</div>'
      },
      { launch: run.launcher }
    )

    expect(run.calls).toEqual([
      'launch',
      'emulateMediaType:print',
      'goto',
      'waitForNetworkIdle',
      'bringToFront',
      'pdf',
      'close'
    ])
    expect(run.launchOptions).toEqual([{ executablePath: '/opt/chrome' }])
    expect(run.gotoUrls).toEqual([pathToFileURL('/tmp/input.html').href])
    expect(run.pdfOptions[0]).toMatchObject({
      path: '/tmp/output.pdf',
      printBackground: true,
      preferCSSPageSize: true,
      waitForFonts: true,
      displayHeaderFooter: true,
      headerTemplate: '<div>header</div>'
    })
  })

  it('closes the browser even when rendering fails', async () => {
    const run = fakeBrowser({ pdfError: new Error('render exploded') })

    await expect(
      renderPdf(
        { htmlPath: '/tmp/input.html', outputPath: '/tmp/output.pdf' },
        { launch: run.launcher }
      )
    ).rejects.toThrow('render exploded')

    expect(run.calls.at(-1)).toBe('close')
  })

  it('maps missing-browser launch failures to guidance', async () => {
    const launch: PdfBrowserLauncher = () =>
      Promise.reject(new Error('Could not find Chrome (ver. 140.0.0.0)'))

    const error = await renderPdf(
      { htmlPath: '/tmp/input.html', outputPath: '/tmp/output.pdf' },
      { launch }
    ).catch((err: unknown) => err)

    expect(error).toBeInstanceOf(BrowserLaunchError)
    expect((error as Error).message).toContain('Could not find Chrome')
    expect((error as Error).message).toContain('npx puppeteer browsers install chrome')
  })

  it('lets hosts replace the missing-browser guidance', async () => {
    const launch: PdfBrowserLauncher = () =>
      Promise.reject(new Error('Failed to launch the browser process!'))

    const error = await renderPdf(
      { htmlPath: '/tmp/input.html', outputPath: '/tmp/output.pdf' },
      { launch, missingBrowserHelp: 'Install a browser or set the setting.' }
    ).catch((err: unknown) => err)

    expect(error).toBeInstanceOf(BrowserLaunchError)
    expect((error as Error).message).toContain('Install a browser or set the setting.')
    expect((error as Error).message).not.toContain('npx puppeteer')
  })

  it('passes other errors through unchanged', async () => {
    const launch: PdfBrowserLauncher = () =>
      Promise.reject(new Error('net::ERR_FILE_NOT_FOUND'))

    const error = await renderPdf(
      { htmlPath: '/tmp/input.html', outputPath: '/tmp/output.pdf' },
      { launch }
    ).catch((err: unknown) => err)

    expect(error).not.toBeInstanceOf(BrowserLaunchError)
    expect((error as Error).message).toBe('net::ERR_FILE_NOT_FOUND')
  })
})
