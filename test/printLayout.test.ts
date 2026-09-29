import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import type { Browser } from 'puppeteer'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { convert } from '../src/convert.js'
import { compileHtml } from '../src/compile.js'
import { buildPdfOptions } from '../src/pdf.js'

const css = readFileSync(new URL('../styles/paperify.css', import.meta.url), 'utf8')
const browserExecutable = process.env['PAPERIFY_TEST_BROWSER']
const longWord = 'UnbrokenIdentifier'.repeat(30)
const table = [
  '| First | Second | Third | Fourth | Fifth |',
  '| --- | --- | --- | --- | --- |',
  `| ${Array(5).fill(longWord.slice(0, 180)).join(' | ')} |`
].join('\n')
const largeImage = 'data:image/svg+xml;base64,' + Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="80"><rect width="1600" height="80" fill="gray"/></svg>'
).toString('base64')

type Matrix = [number, number, number, number, number, number]
const identity = (): Matrix => [1, 0, 0, 1, 0, 0]

function multiply(left: Matrix, right: Matrix): Matrix {
  const [a, b, c, d, e, f] = left
  const [g, h, i, j, k, l] = right
  return [a * g + c * h, b * g + d * h, a * i + c * j,
    b * i + d * j, a * k + c * l + e, b * k + d * l + f]
}

/**
 * Read the text scale in Chromium's PDF content streams. CSS computed font
 * sizes alone miss Chromium's automatic whole-page shrink-to-fit. This is a
 * deliberately small reader for these generated fixtures, not a PDF parser.
 */
function pdfTextPointSizes(pdf: Uint8Array, nominalFontSize?: number): number[] {
  const bytes = Buffer.from(pdf)
  const raw = bytes.toString('latin1')
  const sizes: number[] = []
  const number = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)`
  const operators = new RegExp(
    String.raw`(?:^|\s)(?:(?:${number}\s+){6}(?:cm|Tm)|\/\S+\s+${number}\s+Tf|q|Q|Tj|TJ)(?=\s|$)`,
    'g'
  )

  for (let offset = 0; (offset = raw.indexOf('stream\n', offset)) !== -1;) {
    const end = raw.indexOf('\nendstream', offset)
    if (end === -1) break
    const start = offset + 'stream\n'.length
    offset = end + '\nendstream'.length
    let content: string
    try {
      content = inflateSync(bytes.subarray(start, end)).toString('latin1')
    } catch {
      continue
    }
    if (!/\bBT\b/.test(content) || !/\bTf\b/.test(content)) continue

    let transform = identity()
    let textTransform = identity()
    let fontSize = 0
    const stack: Matrix[] = []
    for (const match of content.matchAll(operators)) {
      const parts = match[0].trim().split(/\s+/)
      const operator = parts.pop()
      if (operator === 'q') stack.push([...transform])
      else if (operator === 'Q') transform = stack.pop() ?? identity()
      else if (operator === 'cm') transform = multiply(transform, parts.map(Number) as Matrix)
      else if (operator === 'Tm') textTransform = parts.map(Number) as Matrix
      else if (operator === 'Tf') fontSize = Number(parts[1])
      else if (operator === 'Tj' || operator === 'TJ') {
        if (nominalFontSize !== undefined && Math.abs(fontSize - nominalFontSize) > 0.01) continue
        const effective = multiply(transform, textTransform)
        sizes.push(fontSize * Math.hypot(effective[2], effective[3]))
      }
    }
  }
  return sizes
}

describe.runIf(Boolean(browserExecutable))('printed typography in Chromium', () => {
  let browser: Browser

  beforeAll(async () => {
    const { default: puppeteer } = await import('puppeteer')
    browser = await puppeteer.launch({ executablePath: browserExecutable })
  }, 30_000)

  afterAll(async () => {
    await browser?.close()
  })

  it.each([
    { name: 'ordinary text', content: 'A normal paragraph.', size: 9.5 },
    { name: 'a long identifier', content: longWord, size: 9.5 },
    { name: 'a long URL', content: `https://example.test/${longWord}`, size: 9.5 },
    { name: 'a table with long cells', content: table, size: 9.5 },
    { name: 'an overridden body size', content: longWord, size: 11 },
    { name: 'a long title', content: 'A normal paragraph.', title: longWord, size: 9.5 },
    { name: 'a large inline image', content: `Before ![Inline illustration](${largeImage}) after.`, size: 9.5 }
  ])('preserves physical body font size with $name', async ({ content, title, size }) => {
    const markdown = [
      ...(title ? ['---', `title: ${title}`, '---', ''] : []),
      'Body size before the potentially overflowing content.', '',
      content, '',
      'Body size after the potentially overflowing content.'
    ].join('\n')
    const result = await convert(markdown, {
      css: {
        mode: 'embed',
        content: size === 9.5 ? css : `${css}\n:root { --print-body-size: ${size}pt; }`
      }
    })
    const page = await browser.newPage()
    try {
      // Match the A4 content width (210mm minus the two 14mm margins) when
      // inspecting print styles outside the browser's pagination pass.
      await page.setViewport({ width: 688, height: 980 })
      await page.emulateMediaType('print')
      await page.setContent(result.html)
      const { path: _path, ...options } = buildPdfOptions({
        htmlPath: '/unused.html', outputPath: '/unused.pdf'
      })
      const pointSizes = pdfTextPointSizes(await page.pdf(options))
      expect(pointSizes.length).toBeGreaterThan(0)
      // The final paragraph always uses the body size, including fixtures
      // whose title/table/inline code intentionally uses a different size.
      expect(pointSizes.at(-1)).toBeCloseTo(size, 1)

      const layout = await page.evaluate(() => {
        const article = document.querySelector('.paper-content')!
        const style = getComputedStyle(article)
        const columnWidth = (article.clientWidth - parseFloat(style.columnGap)) / 2
        return {
          columns: style.columnCount,
          columnWidth,
          textBlocks: [...document.querySelectorAll('.paper-title, .paper-content p')].map(block => ({
            available: block.clientWidth,
            content: block.scrollWidth
          })),
          tables: [...article.querySelectorAll('table')].map(table => ({
            width: table.getBoundingClientRect().width,
            cells: [...table.querySelectorAll('th, td')].map(cell => ({
              available: cell.clientWidth,
              content: cell.scrollWidth
            }))
          })),
          images: [...article.querySelectorAll('img')].map(img => img.getBoundingClientRect().width)
        }
      })
      expect(layout.columns).toBe('2')
      for (const block of layout.textBlocks) {
        expect(block.content).toBeLessThanOrEqual(block.available + 1)
      }
      for (const table of layout.tables) {
        expect(table.width).toBeLessThanOrEqual(layout.columnWidth + 1)
        for (const cell of table.cells) {
          expect(cell.content).toBeLessThanOrEqual(cell.available + 1)
        }
      }
      for (const width of layout.images) {
        expect(width).toBeLessThanOrEqual(layout.columnWidth + 1)
      }
    } finally {
      await page.close()
    }
  }, 30_000)

  it('keeps inline math struts at justified column edges from shrinking the page', async () => {
    const result = await convert([
      'Body text in the first column.', '',
      'Normal text with subscript $x_i$', '',
      'Body text after the equations.'
    ].join('\n'), {
      css: {
        mode: 'embed',
        // Make the short line end precisely at the second column's edge,
        // just as a fully justified line within a longer paragraph would.
        content: `${css}\n:root { --print-math-size: 9.975pt; }\n@media print { .paper-content > p:nth-child(2) { break-before: column; text-align-last: justify; } }`
      }
    })
    const compiled = compileHtml({ html: result.html, inputDir: process.cwd() })
    expect(compiled.warnings).toEqual([])
    const page = await browser.newPage()
    try {
      await page.emulateMediaType('print')
      await page.setContent(compiled.html)
      const { path: _path, ...options } = buildPdfOptions({
        htmlPath: '/unused.html', outputPath: '/unused.pdf'
      })
      const sizes = pdfTextPointSizes(await page.pdf(options), 12.66)
      // Chromium quantizes 9.5pt to 12.66 CSS px (9.495pt). An overflowing
      // two-pixel KaTeX strut used to reduce every body glyph to ~9.467pt.
      expect(sizes.length).toBeGreaterThan(0)
      for (const size of sizes) expect(Math.abs(size - 9.495)).toBeLessThan(0.01)
    } finally {
      await page.close()
    }
  }, 30_000)

  it.each([
    { name: 'the default', frontmatter: '', theme: '', mathSize: 8.5, bodySize: 9.5 },
    { name: 'a numeric YAML size', frontmatter: 'printMathSize: 7.5', theme: '', mathSize: 7.5, bodySize: 9.5 },
    { name: 'a YAML point size overriding CSS', frontmatter: 'printMathSize: 8pt', theme: '--print-math-size: 9pt;', mathSize: 8, bodySize: 9.5 },
    { name: 'CSS with a larger body', frontmatter: '', theme: '--print-math-size: 9pt; --print-body-size: 11pt;', mathSize: 9, bodySize: 11 }
  ])('sets all printed math independently of body text with $name', async ({ frontmatter, theme, mathSize, bodySize }) => {
    const result = await convert([
      ...(frontmatter ? ['---', frontmatter, '---', ''] : []),
      'Body text and inline math $x+y$.', '',
      '## Heading with $x+y$', '',
      '| Math | Meaning |', '| --- | --- |', '| $x+y$ | A sum |', '',
      '$$', 'x+y', '$$', '',
      'Body text after the equations.'
    ].join('\n'), {
      css: { mode: 'embed', content: `${css}\n:root { ${theme} }` }
    })
    const compiled = compileHtml({ html: result.html, inputDir: process.cwd() })
    expect(compiled.warnings).toEqual([])
    const page = await browser.newPage()
    try {
      await page.setContent(compiled.html)
      // The document's print setting must not shrink the screen preview.
      const screenMathSize = await page.$eval('.katex', element => parseFloat(getComputedStyle(element).fontSize))
      expect(screenMathSize).toBeCloseTo(16 * 1.21, 2)

      await page.emulateMediaType('print')
      const mathSizes = await page.$$eval('.katex', elements => elements.map(element => parseFloat(getComputedStyle(element).fontSize)))
      expect(mathSizes).toHaveLength(4)
      for (const size of mathSizes) expect(size).toBeCloseTo(mathSize * 4 / 3, 2)

      const { path: _path, ...options } = buildPdfOptions({
        htmlPath: '/unused.html', outputPath: '/unused.pdf'
      })
      const pdf = await page.pdf(options)
      for (const expected of [mathSize, bodySize]) {
        const pointSizes = pdfTextPointSizes(pdf, expected * 4 / 3)
        expect(pointSizes.length).toBeGreaterThan(0)
        for (const size of pointSizes) expect(Math.abs(size - expected)).toBeLessThan(0.01)
      }
    } finally {
      await page.close()
    }
  }, 30_000)
})
