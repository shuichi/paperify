import { describe, expect, it, beforeEach } from 'vitest'

import {
  clearCslStyleCache,
  cslStyleUrl,
  fetchCslStyle,
  normalizeCslStyleId
} from '../src/csl.js'
import type { CslFetchResponse } from '../src/csl.js'

const styleXml = (id: string): string =>
  `<?xml version="1.0" encoding="utf-8"?><style xmlns="http://purl.org/net/xbiblio/csl" version="1.0"><info><id>http://www.zotero.org/styles/${id}</id></info></style>`

const response = (xml: string): CslFetchResponse => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  text: async () => xml
})

describe('CSL style loading', () => {
  beforeEach(() => {
    clearCslStyleCache()
  })

  it('downloads Zotero styles by repository id', async () => {
    const calls: string[] = []
    const xml = await fetchCslStyle('example-style', async (url) => {
      calls.push(url)
      return response(styleXml('example-style'))
    })

    expect(calls).toEqual([cslStyleUrl('example-style')])
    expect(xml).toContain('example-style')
  })

  it('resolves dependent styles to their independent parent', async () => {
    const calls: string[] = []
    const dependent = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0">',
      '<info>',
      '<link href="http://www.zotero.org/styles/parent-style" rel="independent-parent"/>',
      '</info>',
      '</style>'
    ].join('')

    const xml = await fetchCslStyle('dependent-style', async (url) => {
      calls.push(url)
      return response(url.endsWith('/parent-style') ? styleXml('parent-style') : dependent)
    })

    expect(calls).toEqual([
      cslStyleUrl('dependent-style'),
      cslStyleUrl('parent-style')
    ])
    expect(xml).toContain('parent-style')
  })

  it('rejects invalid style ids before building a URL', () => {
    expect(() => normalizeCslStyleId('../bad')).toThrow('Invalid CSL style id')
  })

  it('includes style context when downloads fail', async () => {
    await expect(
      fetchCslStyle('missing-style', async () => {
        throw new Error('network unavailable')
      })
    ).rejects.toThrow(
      'Failed to download CSL style "missing-style" from https://www.zotero.org/styles/missing-style: network unavailable'
    )
  })
})
