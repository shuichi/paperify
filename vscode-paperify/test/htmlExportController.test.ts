import { beforeEach, describe, expect, it } from 'vitest'

import { BrowserLaunchError } from 'paperify/pdf'

import {
  HTML_EXPORT_IN_PROGRESS_MESSAGE,
  MISSING_HTML_BROWSER_MESSAGE,
  NOT_PAPERIFY_HTML_EXPORT_MESSAGE,
  HtmlExportController,
  type HtmlExporter
} from '../src/htmlExportController'
import type { ExportHtmlRequest, ExportHtmlResult } from '../src/html'
import { __mock, Uri, type MockOutputChannel } from './mocks/vscode'

interface FakeDocument {
  uri: Uri
  languageId: string
  isUntitled: boolean
  getText(): string
}

function makeDocument(
  filePath: string,
  text: string,
  languageId = 'markdown'
): FakeDocument {
  return {
    uri: Uri.file(filePath),
    languageId,
    isUntitled: false,
    getText: () => text
  }
}

const PAPERIFY_DOC = [
  '---',
  'paperify: true',
  'title: Example Paper',
  '---',
  '',
  '# Introduction',
  ''
].join('\n')

const PLAIN_DOC = '# Just Markdown\n\nBody.\n'

function makeOutput(): MockOutputChannel {
  return {
    name: 'Paperify',
    lines: [],
    appendLine(line: string) {
      this.lines.push(line)
    },
    show() {},
    dispose() {}
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function recordingExporter(result: ExportHtmlResult = { warnings: [] }) {
  const requests: ExportHtmlRequest[] = []
  const exporter: HtmlExporter = (request) => {
    requests.push(request)
    return Promise.resolve(result)
  }
  return { requests, exporter }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  __mock.reset()
})

describe('HtmlExportController', () => {
  it('refuses non-Paperify documents with guidance', async () => {
    const { requests, exporter } = recordingExporter()
    const controller = new HtmlExportController(
      makeOutput() as never,
      () => '',
      exporter
    )

    const exported = await controller.exportDocument(
      makeDocument('/docs/plain.md', PLAIN_DOC) as never
    )

    expect(exported).toBe(false)
    expect(requests).toHaveLength(0)
    expect(__mock.messages).toEqual([NOT_PAPERIFY_HTML_EXPORT_MESSAGE])
  })

  it('defaults the save dialog to a sibling HTML file', async () => {
    const { requests, exporter } = recordingExporter()
    const controller = new HtmlExportController(
      makeOutput() as never,
      () => '',
      exporter
    )
    __mock.saveDialogResult = undefined

    const exported = await controller.exportDocument(
      makeDocument('/docs/paper.md', PAPERIFY_DOC) as never
    )

    expect(exported).toBe(false)
    expect(requests).toHaveLength(0)
    const dialog = __mock.saveDialogCalls[0] as { defaultUri: Uri }
    expect(dialog.defaultUri.fsPath).toBe('/docs/paper.html')
    expect(__mock.progressCalls).toHaveLength(0)
  })

  it('exports current editor content and offers to open the result', async () => {
    const output = makeOutput()
    const { requests, exporter } = recordingExporter({
      warnings: ['image asset not found, left as-is: media/nope.png']
    })
    const mermaidRenderer = async () => []
    const controller = new HtmlExportController(
      output as never,
      () => 'CSS-X',
      exporter,
      mermaidRenderer
    )
    __mock.saveDialogResult = Uri.file('/out/paper.html')
    __mock.infoMessageChoice = 'Open HTML'

    const exported = await controller.exportDocument(
      makeDocument('/docs/paper.md', PAPERIFY_DOC) as never
    )

    expect(exported).toBe(true)
    expect(requests[0]).toMatchObject({
      markdown: PAPERIFY_DOC,
      inputDir: '/docs',
      documentPath: '/docs/paper.md',
      outputPath: '/out/paper.html',
      css: 'CSS-X',
      mermaidRenderer
    })
    expect(__mock.progressCalls).toHaveLength(1)
    expect(output.lines.some((line) => line.includes('[warning]'))).toBe(true)

    await flush()
    expect(__mock.openedExternal.map((uri) => uri.fsPath)).toEqual([
      '/out/paper.html'
    ])
  })

  it('blocks a second export of the same document while one is running', async () => {
    const pending = deferred<ExportHtmlResult>()
    let calls = 0
    const exporter: HtmlExporter = () => {
      calls++
      return pending.promise
    }
    const controller = new HtmlExportController(
      makeOutput() as never,
      () => '',
      exporter
    )
    __mock.saveDialogResult = Uri.file('/out/paper.html')
    const document = makeDocument('/docs/paper.md', PAPERIFY_DOC)

    const first = controller.exportDocument(document as never)
    await flush()
    const second = await controller.exportDocument(document as never)

    expect(second).toBe(false)
    expect(__mock.messages).toContain(HTML_EXPORT_IN_PROGRESS_MESSAGE)
    pending.resolve({ warnings: [] })
    expect(await first).toBe(true)
    expect(calls).toBe(1)
  })

  it('reports conversion failures and logs their details', async () => {
    const output = makeOutput()
    const exporter: HtmlExporter = () =>
      Promise.reject(new Error('conversion exploded\nlong detail'))
    const controller = new HtmlExportController(
      output as never,
      () => '',
      exporter
    )
    __mock.saveDialogResult = Uri.file('/out/paper.html')

    const exported = await controller.exportDocument(
      makeDocument('/docs/paper.md', PAPERIFY_DOC) as never
    )

    expect(exported).toBe(false)
    expect(__mock.errorMessages[0]).toEqual({
      message: 'Paperify: HTML export failed: conversion exploded',
      items: ['Show Output']
    })
    expect(output.lines.some((line) => line.includes('[error]'))).toBe(true)
  })

  it('offers browser settings when Mermaid cannot launch a browser', async () => {
    const exporter: HtmlExporter = () =>
      Promise.reject(new BrowserLaunchError('Could not find Chrome'))
    const controller = new HtmlExportController(
      makeOutput() as never,
      () => '',
      exporter
    )
    __mock.saveDialogResult = Uri.file('/out/paper.html')
    __mock.errorMessageChoice = 'Open Settings'

    const exported = await controller.exportDocument(
      makeDocument('/docs/paper.md', PAPERIFY_DOC) as never
    )

    expect(exported).toBe(false)
    expect(__mock.errorMessages[0]).toEqual({
      message: MISSING_HTML_BROWSER_MESSAGE,
      items: ['Open Settings']
    })
    await flush()
    expect(__mock.executedCommands).toContainEqual([
      'workbench.action.openSettings',
      'paperify.pdf.browserExecutable'
    ])
  })
})
