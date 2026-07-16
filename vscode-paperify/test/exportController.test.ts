import { describe, it, expect, beforeEach } from 'vitest'

import { BrowserLaunchError } from 'paperify/pdf'

import {
  EXPORT_IN_PROGRESS_MESSAGE,
  MISSING_BROWSER_MESSAGE,
  NOT_PAPERIFY_EXPORT_MESSAGE,
  PdfExportController,
  type PdfExporter
} from '../src/exportController'
import type { ExportPdfRequest, ExportPdfResult } from '../src/pdf'
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

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function recordingExporter(result: ExportPdfResult = { warnings: [] }) {
  const requests: ExportPdfRequest[] = []
  const exporter: PdfExporter = (request) => {
    requests.push(request)
    return Promise.resolve(result)
  }
  return { requests, exporter }
}

beforeEach(() => {
  __mock.reset()
})

describe('PdfExportController', () => {
  it('refuses non-Paperify documents with guidance', async () => {
    const { requests, exporter } = recordingExporter()
    const controller = new PdfExportController(makeOutput() as never, () => '', exporter)

    const exported = await controller.exportDocument(
      makeDocument('/docs/plain.md', PLAIN_DOC) as never
    )

    expect(exported).toBe(false)
    expect(requests).toHaveLength(0)
    expect(__mock.messages).toEqual([NOT_PAPERIFY_EXPORT_MESSAGE])
  })

  it('does nothing further when the save dialog is cancelled', async () => {
    const { requests, exporter } = recordingExporter()
    const controller = new PdfExportController(makeOutput() as never, () => '', exporter)
    __mock.saveDialogResult = undefined

    const exported = await controller.exportDocument(
      makeDocument('/docs/paper.md', PAPERIFY_DOC) as never
    )

    expect(exported).toBe(false)
    expect(requests).toHaveLength(0)
    expect(__mock.saveDialogCalls).toHaveLength(1)
    const dialog = __mock.saveDialogCalls[0] as { defaultUri: Uri }
    expect(dialog.defaultUri.fsPath).toBe('/docs/paper.pdf')
    expect(__mock.progressCalls).toHaveLength(0)
  })

  it('exports the current editor content to the chosen path with progress', async () => {
    const output = makeOutput()
    const { requests, exporter } = recordingExporter({
      warnings: ['image asset not found, left as-is: media/nope.png']
    })
    const mermaidRenderer = async () => []
    const controller = new PdfExportController(
      output as never,
      () => 'CSS-X',
      exporter,
      mermaidRenderer
    )
    __mock.saveDialogResult = Uri.file('/out/paper.pdf')
    __mock.configuration.set('paperify.pdf.browserExecutable', '/opt/chrome')
    __mock.infoMessageChoice = 'Open PDF'

    const document = makeDocument('/docs/paper.md', PAPERIFY_DOC)
    const exported = await controller.exportDocument(document as never)

    expect(exported).toBe(true)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      markdown: PAPERIFY_DOC,
      inputDir: '/docs',
      documentPath: '/docs/paper.md',
      outputPath: '/out/paper.pdf',
      css: 'CSS-X',
      browserExecutablePath: '/opt/chrome'
    })
    expect(requests[0].mermaidRenderer).toBe(mermaidRenderer)
    expect(__mock.progressCalls).toHaveLength(1)
    expect(__mock.messages.some((m) => m.includes('exported paper.pdf'))).toBe(true)
    expect(output.lines.some((line) => line.includes('[warning]'))).toBe(true)

    // "Open PDF" on the success notification opens the file externally.
    await flush()
    expect(__mock.openedExternal.map((uri) => uri.fsPath)).toEqual(['/out/paper.pdf'])
  })

  it('blocks a second export of the same document while one is running', async () => {
    const pending = deferred<ExportPdfResult>()
    let calls = 0
    const exporter: PdfExporter = () => {
      calls++
      return pending.promise
    }
    const controller = new PdfExportController(makeOutput() as never, () => '', exporter)
    __mock.saveDialogResult = Uri.file('/out/paper.pdf')

    const document = makeDocument('/docs/paper.md', PAPERIFY_DOC)
    const first = controller.exportDocument(document as never)
    await flush()

    const second = await controller.exportDocument(document as never)
    expect(second).toBe(false)
    expect(__mock.messages).toContain(EXPORT_IN_PROGRESS_MESSAGE)

    pending.resolve({ warnings: [] })
    expect(await first).toBe(true)
    expect(calls).toBe(1)

    // After completion the document can be exported again.
    const third = await controller.exportDocument(document as never)
    expect(third).toBe(true)
    expect(calls).toBe(2)
  })

  it('reports generic failures concisely and logs details', async () => {
    const output = makeOutput()
    const exporter: PdfExporter = () =>
      Promise.reject(new Error('conversion exploded\nlong detail'))
    const controller = new PdfExportController(output as never, () => '', exporter)
    __mock.saveDialogResult = Uri.file('/out/paper.pdf')

    const exported = await controller.exportDocument(
      makeDocument('/docs/paper.md', PAPERIFY_DOC) as never
    )

    expect(exported).toBe(false)
    expect(__mock.errorMessages).toHaveLength(1)
    expect(__mock.errorMessages[0].message).toBe(
      'Paperify: PDF export failed: conversion exploded'
    )
    expect(__mock.errorMessages[0].items).toEqual(['Show Output'])
    expect(output.lines.some((line) => line.includes('[error]'))).toBe(true)
    expect(output.lines.some((line) => line.includes('conversion exploded'))).toBe(true)
  })

  it('offers to open settings when no browser can be launched', async () => {
    const exporter: PdfExporter = () =>
      Promise.reject(new BrowserLaunchError('Could not find Chrome.\n\nhelp text'))
    const controller = new PdfExportController(makeOutput() as never, () => '', exporter)
    __mock.saveDialogResult = Uri.file('/out/paper.pdf')
    __mock.errorMessageChoice = 'Open Settings'

    const exported = await controller.exportDocument(
      makeDocument('/docs/paper.md', PAPERIFY_DOC) as never
    )

    expect(exported).toBe(false)
    expect(__mock.errorMessages[0].message).toBe(MISSING_BROWSER_MESSAGE)
    expect(__mock.errorMessages[0].items).toEqual(['Open Settings'])

    await flush()
    expect(__mock.executedCommands).toContainEqual([
      'workbench.action.openSettings',
      'paperify.pdf.browserExecutable'
    ])
  })
})
