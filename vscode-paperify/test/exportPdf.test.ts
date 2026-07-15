import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  BrowserLaunchError,
  type PaperifyPdfOptions,
  type PdfBrowserLauncher
} from 'paperify/pdf'

import {
  MISSING_BROWSER_HELP,
  detectBrowserExecutable,
  exportPdfToFile
} from '../src/pdf'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixturesDir = path.join(here, 'fixtures')

const DOC = [
  '---',
  'paperify: true',
  'title: Export Test',
  'headerTemplate: "<div>header</div>"',
  'footerTemplate: "<div>footer</div>"',
  '---',
  '',
  '# Introduction',
  '',
  'Body text.',
  ''
].join('\n')

interface FakeRun {
  launcher: PdfBrowserLauncher
  launchOptions: Array<{ executablePath?: string }>
  pdfOptions: PaperifyPdfOptions[]
  htmlSeenByBrowser: string[]
  pdfError?: Error
}

function fakeLauncher(overrides: { pdfError?: Error } = {}): FakeRun {
  const run: FakeRun = {
    launchOptions: [],
    pdfOptions: [],
    htmlSeenByBrowser: [],
    launcher: async (options) => {
      run.launchOptions.push(options)
      return {
        newPage: async () => ({
          emulateMediaType: async () => {},
          goto: async (url: string) => {
            run.htmlSeenByBrowser.push(fs.readFileSync(fileURLToPath(url), 'utf8'))
          },
          waitForNetworkIdle: async () => {},
          bringToFront: async () => {},
          pdf: async (options: PaperifyPdfOptions) => {
            run.pdfOptions.push(options)
            if (overrides.pdfError) throw overrides.pdfError
            fs.writeFileSync(options.path, '%PDF-1.7 fake')
          }
        }),
        close: async () => {}
      }
    }
  }
  return run
}

const cleanups: string[] = []
function makeOutputDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paperify-export-test-'))
  cleanups.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of cleanups.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('exportPdfToFile', () => {
  it('exports a PDF through the injected browser and removes the temp directory', async () => {
    const run = fakeLauncher()
    const outputPath = path.join(makeOutputDir(), 'paper.pdf')

    const { warnings } = await exportPdfToFile({
      markdown: DOC,
      inputDir: fixturesDir,
      documentPath: path.join(fixturesDir, 'paper.md'),
      outputPath,
      css: '/* export-test-css */',
      // Any existing file stands in for a browser executable here; the fake
      // launcher never actually spawns it.
      browserExecutablePath: process.execPath,
      launch: run.launcher
    })

    expect(warnings).toEqual([])
    expect(fs.readFileSync(outputPath, 'utf8')).toBe('%PDF-1.7 fake')
    expect(run.launchOptions).toEqual([{ executablePath: process.execPath }])

    // The temp HTML is a plain Paperify document, not webview HTML.
    expect(run.htmlSeenByBrowser).toHaveLength(1)
    expect(run.htmlSeenByBrowser[0]).toContain('<h1 class="paper-title">Export Test</h1>')
    expect(run.htmlSeenByBrowser[0]).toContain('/* export-test-css */')
    expect(run.htmlSeenByBrowser[0]).not.toContain('Content-Security-Policy')
    expect(run.htmlSeenByBrowser[0]).not.toContain('vscode-webview')

    // Frontmatter header/footer templates reach the PDF options.
    expect(run.pdfOptions[0]).toMatchObject({
      printBackground: true,
      preferCSSPageSize: true,
      waitForFonts: true,
      displayHeaderFooter: true,
      headerTemplate: '<div>header</div>',
      footerTemplate: '<div>footer</div>'
    })

    // The private temp directory is gone, success or not.
    expect(fs.existsSync(path.dirname(run.pdfOptions[0].path))).toBe(false)
  })

  it('rejects and leaves no partial PDF when rendering fails', async () => {
    const run = fakeLauncher({ pdfError: new Error('print blew up') })
    const outputPath = path.join(makeOutputDir(), 'paper.pdf')

    await expect(
      exportPdfToFile({
        markdown: DOC,
        inputDir: fixturesDir,
        outputPath,
        css: '',
        browserExecutablePath: process.execPath,
        launch: run.launcher
      })
    ).rejects.toThrow('print blew up')

    expect(fs.existsSync(outputPath)).toBe(false)
    expect(fs.existsSync(path.dirname(run.pdfOptions[0].path))).toBe(false)
  })

  it('fails fast with guidance when the configured executable does not exist', async () => {
    const run = fakeLauncher()

    const error = await exportPdfToFile({
      markdown: DOC,
      inputDir: fixturesDir,
      outputPath: path.join(makeOutputDir(), 'paper.pdf'),
      css: '',
      browserExecutablePath: '/definitely/not/a/browser',
      launch: run.launcher
    }).catch((err: unknown) => err)

    expect(error).toBeInstanceOf(BrowserLaunchError)
    expect((error as Error).message).toContain('/definitely/not/a/browser')
    expect((error as Error).message).toContain(MISSING_BROWSER_HELP)
    expect(run.launchOptions).toHaveLength(0)
  })

  it('fails strictly on citation problems before ever launching a browser', async () => {
    const run = fakeLauncher()

    await expect(
      exportPdfToFile({
        markdown: [
          '---',
          'paperify: true',
          '---',
          '',
          'See [@knuth1984texbook].',
          ''
        ].join('\n'),
        inputDir: os.tmpdir(),
        outputPath: path.join(makeOutputDir(), 'paper.pdf'),
        css: '',
        browserExecutablePath: process.execPath,
        launch: run.launcher
      })
    ).rejects.toThrow(/no bibliography/)

    expect(run.launchOptions).toHaveLength(0)
  })
})

describe('detectBrowserExecutable', () => {
  it('finds macOS browsers in /Applications', () => {
    const edge = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    expect(
      detectBrowserExecutable({
        platform: 'darwin',
        exists: (candidate) => candidate === edge
      })
    ).toBe(edge)
  })

  it('finds Windows browsers under the program-files roots', () => {
    const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    expect(
      detectBrowserExecutable({
        platform: 'win32',
        env: {
          PROGRAMFILES: 'C:\\Program Files',
          'PROGRAMFILES(X86)': 'C:\\Program Files (x86)'
        },
        exists: (candidate) => candidate === chrome
      })
    ).toBe(chrome)
  })

  it('returns undefined when nothing is installed', () => {
    expect(
      detectBrowserExecutable({ platform: 'linux', exists: () => false })
    ).toBeUndefined()
  })
})
