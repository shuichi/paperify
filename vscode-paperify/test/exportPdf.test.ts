import { describe, it, expect, afterEach, vi } from 'vitest'
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
import type { MermaidRenderer } from 'paperify/api'

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
  it('refuses to replace the Markdown source before launching the browser', async () => {
    const run = fakeLauncher()
    const inputDir = makeOutputDir()
    const documentPath = path.join(inputDir, 'paper.md')
    fs.writeFileSync(documentPath, DOC)

    await expect(exportPdfToFile({
      markdown: DOC,
      inputDir,
      documentPath,
      outputPath: documentPath,
      css: '',
      launch: run.launcher
    })).rejects.toThrow(/overwrite the input document/)
    expect(fs.readFileSync(documentPath, 'utf8')).toBe(DOC)
    expect(run.launchOptions).toHaveLength(0)
  })

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

  it('preserves the previous PDF if copying to a different volume fails', async () => {
    const run = fakeLauncher()
    const outputDir = makeOutputDir()
    const outputPath = path.join(outputDir, 'paper.pdf')
    fs.writeFileSync(outputPath, 'previous PDF')
    const rename = vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(
      Object.assign(new Error('different volumes'), { code: 'EXDEV' })
    )
    const copy = vi.spyOn(fs.promises, 'copyFile').mockImplementationOnce(
      async (_from, to) => {
        await fs.promises.writeFile(to, 'partial PDF')
        throw new Error('copy interrupted')
      }
    )
    try {
      await expect(exportPdfToFile({
        markdown: DOC,
        inputDir: fixturesDir,
        outputPath,
        css: '',
        browserExecutablePath: process.execPath,
        launch: run.launcher
      })).rejects.toThrow('copy interrupted')

      expect(fs.readFileSync(outputPath, 'utf8')).toBe('previous PDF')
      expect(fs.readdirSync(outputDir)).toEqual(['paper.pdf'])
    } finally {
      rename.mockRestore()
      copy.mockRestore()
    }
  })

  it('preserves the document print math size in the compiled HTML sent to PDF', async () => {
    const run = fakeLauncher()

    await exportPdfToFile({
      markdown: DOC.replace('paperify: true', 'paperify: true\nprintMathSize: 8')
        .replace('Body text.', () => 'Inline $x$ math.\n\n$$\ny = x^2\n$$'),
      inputDir: fixturesDir,
      outputPath: path.join(makeOutputDir(), 'math.pdf'),
      css: ':root { --print-math-size: 8.5pt; }',
      browserExecutablePath: process.execPath,
      launch: run.launcher
    })

    const html = run.htmlSeenByBrowser[0]
    const body = html.slice(html.indexOf('<body>'))
    const override = '@media print { :root { --print-math-size: 8pt; } }'
    expect(html).toContain(override)
    expect(html.indexOf(override)).toBeGreaterThan(html.indexOf('--print-math-size: 8.5pt'))
    expect(html.indexOf(override)).toBeLessThan(html.indexOf('</head>'))
    expect(body).toContain('class="katex"')
    expect(body).toContain('class="katex-display"')
    expect(html.includes('href="https://cdn.jsdelivr.net/npm/katex')).toBe(false)
    expect(run.pdfOptions[0]).toMatchObject({ scale: 1 })
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

  it('places a statically rendered Mermaid figure in the HTML sent to PDF', async () => {
    const run = fakeLauncher()
    const mermaidRenderer: MermaidRenderer = async () => [
      {
        ok: true,
        value: {
          svg: '<svg xmlns="http://www.w3.org/2000/svg"><desc>PDF diagram</desc></svg>',
          description: 'PDF diagram'
        }
      }
    ]

    await exportPdfToFile({
      markdown: DOC.replace(
        'Body text.',
        '```mermaid\ngraph TD\nA-->B\n```'
      ),
      inputDir: fixturesDir,
      outputPath: path.join(makeOutputDir(), 'mermaid.pdf'),
      css: '',
      browserExecutablePath: process.execPath,
      launch: run.launcher,
      mermaidRenderer
    })

    expect(run.htmlSeenByBrowser[0]).toContain(
      'class="image-figure mermaid-figure"'
    )
    expect(run.htmlSeenByBrowser[0]).toContain(
      'src="data:image/svg+xml;base64,'
    )
    expect(run.htmlSeenByBrowser[0]).not.toContain('<script')
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
