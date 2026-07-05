import { describe, expect, it } from 'vitest'

import { buildPdfOptions } from '../src/pdf.js'

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
