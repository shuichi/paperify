import { describe, it, expect, beforeEach } from 'vitest'

import { NOT_PAPERIFY_MESSAGE, PreviewManager } from '../src/preview'
import type { PreviewRenderResult, PreviewRequest } from '../src/render'
import { __mock, Uri, ViewColumn, type MockOutputChannel } from './mocks/vscode'

const DEBOUNCE_MS = 10

interface FakeDocument {
  uri: Uri
  languageId: string
  isUntitled: boolean
  getText(): string
  setText(text: string): void
}

function makeDocument(filePath: string, text: string, languageId = 'markdown'): FakeDocument {
  let current = text
  return {
    uri: Uri.file(filePath),
    languageId,
    isUntitled: false,
    getText: () => current,
    setText: (next: string) => {
      current = next
    }
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

function echoRenderer(request: PreviewRequest): Promise<PreviewRenderResult> {
  return Promise.resolve({
    html: `<html><body>${request.markdown}</body></html>`,
    warnings: []
  })
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const flush = () => sleep(0)

function editDocument(document: FakeDocument, text: string): void {
  document.setText(text)
  __mock.changeTextDocument.fire({ document })
}

beforeEach(() => {
  __mock.reset()
})

describe('PreviewManager', () => {
  it('does not open a preview for plain Markdown and shows guidance', () => {
    const manager = new PreviewManager(makeOutput() as never, echoRenderer, DEBOUNCE_MS)
    const document = makeDocument('/docs/plain.md', PLAIN_DOC)

    const opened = manager.openPreview(document as never, ViewColumn.Active as never)

    expect(opened).toBe(false)
    expect(__mock.panels).toHaveLength(0)
    expect(__mock.messages).toEqual([NOT_PAPERIFY_MESSAGE])
  })

  it('does not open a preview for non-Markdown documents', () => {
    const manager = new PreviewManager(makeOutput() as never, echoRenderer, DEBOUNCE_MS)
    const document = makeDocument('/docs/paper.txt', PAPERIFY_DOC, 'plaintext')

    expect(manager.openPreview(document as never, ViewColumn.Active as never)).toBe(false)
    expect(__mock.panels).toHaveLength(0)
  })

  it('opens a webview panel with scripts disabled and renders the document', async () => {
    const manager = new PreviewManager(makeOutput() as never, echoRenderer, DEBOUNCE_MS)
    const document = makeDocument('/docs/paper.md', PAPERIFY_DOC)

    expect(manager.openPreview(document as never, ViewColumn.Active as never)).toBe(true)
    await flush()

    expect(__mock.panels).toHaveLength(1)
    const panel = __mock.panels[0]
    expect(panel.viewType).toBe('paperify.preview')
    expect((panel.webview.options as { enableScripts?: boolean }).enableScripts).toBe(false)
    expect(panel.webview.html).toContain('# Introduction')
  })

  it('restricts local resources to the document directory', () => {
    const manager = new PreviewManager(makeOutput() as never, echoRenderer, DEBOUNCE_MS)
    const document = makeDocument('/docs/paper.md', PAPERIFY_DOC)
    manager.openPreview(document as never, ViewColumn.Active as never)

    const options = __mock.panels[0].webview.options as {
      localResourceRoots?: Uri[]
    }
    expect(options.localResourceRoots?.map((uri) => uri.fsPath)).toEqual(['/docs'])
  })

  it('reuses the panel for the same document and reveals it', () => {
    const manager = new PreviewManager(makeOutput() as never, echoRenderer, DEBOUNCE_MS)
    const document = makeDocument('/docs/paper.md', PAPERIFY_DOC)

    manager.openPreview(document as never, ViewColumn.Active as never)
    manager.openPreview(document as never, ViewColumn.Beside as never)

    expect(__mock.panels).toHaveLength(1)
    expect(__mock.panels[0].revealCalls).toEqual([ViewColumn.Beside])
  })

  it('opens independent previews for different documents', () => {
    const manager = new PreviewManager(makeOutput() as never, echoRenderer, DEBOUNCE_MS)
    const first = makeDocument('/docs/a.md', PAPERIFY_DOC)
    const second = makeDocument('/docs/b.md', PAPERIFY_DOC)

    manager.openPreview(first as never, ViewColumn.Active as never)
    manager.openPreview(second as never, ViewColumn.Active as never)

    expect(__mock.panels).toHaveLength(2)
  })

  it('updates the preview after edits, debounced', async () => {
    let renders = 0
    const renderer = (request: PreviewRequest) => {
      renders++
      return echoRenderer(request)
    }
    const manager = new PreviewManager(makeOutput() as never, renderer, DEBOUNCE_MS)
    const document = makeDocument('/docs/paper.md', PAPERIFY_DOC)

    manager.openPreview(document as never, ViewColumn.Active as never)
    await flush()
    expect(renders).toBe(1)

    // Rapid consecutive edits collapse into a single debounced render.
    editDocument(document, `${PAPERIFY_DOC}\nRevision A\n`)
    editDocument(document, `${PAPERIFY_DOC}\nRevision B\n`)
    await sleep(DEBOUNCE_MS * 4)

    expect(renders).toBe(2)
    expect(__mock.panels[0].webview.html).toContain('Revision B')
  })

  it('never overwrites a newer render with a stale async result', async () => {
    const pending: Array<{
      markdown: string
      resolve: (value: PreviewRenderResult) => void
    }> = []
    const renderer = (request: PreviewRequest) => {
      const { promise, resolve } = deferred<PreviewRenderResult>()
      pending.push({ markdown: request.markdown, resolve })
      return promise
    }
    const manager = new PreviewManager(makeOutput() as never, renderer, DEBOUNCE_MS)
    const document = makeDocument('/docs/paper.md', PAPERIFY_DOC)

    manager.openPreview(document as never, ViewColumn.Active as never)
    editDocument(document, `${PAPERIFY_DOC}\nSecond\n`)
    await sleep(DEBOUNCE_MS * 4)
    editDocument(document, `${PAPERIFY_DOC}\nThird\n`)
    await sleep(DEBOUNCE_MS * 4)
    expect(pending).toHaveLength(3)

    // Resolve out of order: newest first, then the stale ones.
    pending[2].resolve({ html: '<html>third</html>', warnings: [] })
    await flush()
    pending[0].resolve({ html: '<html>first</html>', warnings: [] })
    pending[1].resolve({ html: '<html>second</html>', warnings: [] })
    await flush()

    expect(__mock.panels[0].webview.html).toBe('<html>third</html>')
  })

  it('shows a friendly error screen and logs details on conversion failure', async () => {
    const output = makeOutput()
    const renderer = () => Promise.reject(new Error('broken frontmatter'))
    const manager = new PreviewManager(output as never, renderer, DEBOUNCE_MS)
    const document = makeDocument('/docs/paper.md', PAPERIFY_DOC)

    manager.openPreview(document as never, ViewColumn.Active as never)
    await flush()

    const html = __mock.panels[0].webview.html
    expect(html).toContain('Paperify could not render this document')
    expect(html).toContain('broken frontmatter')
    expect(output.lines.some((line) => line.includes('[error]'))).toBe(true)
  })

  it('logs warnings once, not on every rerender with the same warnings', async () => {
    const output = makeOutput()
    const renderer = (request: PreviewRequest) =>
      Promise.resolve({
        html: `<html>${request.markdown.length}</html>`,
        warnings: ['image asset not found, left as-is: media/nope.png']
      })
    const manager = new PreviewManager(output as never, renderer, DEBOUNCE_MS)
    const document = makeDocument('/docs/paper.md', PAPERIFY_DOC)

    manager.openPreview(document as never, ViewColumn.Active as never)
    await flush()
    editDocument(document, `${PAPERIFY_DOC}\nMore\n`)
    await sleep(DEBOUNCE_MS * 4)

    const warningLines = output.lines.filter((line) => line.includes('[warning]'))
    expect(warningLines).toHaveLength(1)
  })

  it('releases listeners and timers when the panel is disposed', async () => {
    let renders = 0
    const renderer = (request: PreviewRequest) => {
      renders++
      return echoRenderer(request)
    }
    const manager = new PreviewManager(makeOutput() as never, renderer, DEBOUNCE_MS)
    const document = makeDocument('/docs/paper.md', PAPERIFY_DOC)

    manager.openPreview(document as never, ViewColumn.Active as never)
    await flush()
    expect(__mock.changeTextDocument.listeners.size).toBe(1)
    expect(__mock.closeTextDocument.listeners.size).toBe(1)

    // Leave a debounce timer pending, then dispose the panel.
    editDocument(document, `${PAPERIFY_DOC}\nEdited\n`)
    __mock.panels[0].dispose()

    expect(__mock.changeTextDocument.listeners.size).toBe(0)
    expect(__mock.closeTextDocument.listeners.size).toBe(0)

    await sleep(DEBOUNCE_MS * 4)
    expect(renders).toBe(1)

    // The document can be previewed again with a fresh panel afterwards.
    manager.openPreview(document as never, ViewColumn.Active as never)
    expect(__mock.panels).toHaveLength(2)
  })

  it('disposes the panel when the document is closed', () => {
    const manager = new PreviewManager(makeOutput() as never, echoRenderer, DEBOUNCE_MS)
    const document = makeDocument('/docs/paper.md', PAPERIFY_DOC)

    manager.openPreview(document as never, ViewColumn.Active as never)
    __mock.closeTextDocument.fire(document)

    expect(__mock.panels[0].disposed).toBe(true)
    expect(__mock.changeTextDocument.listeners.size).toBe(0)
    expect(manager.hasPreview(document as never)).toBe(false)
  })

  it('disposes all panels when the manager is disposed', () => {
    const manager = new PreviewManager(makeOutput() as never, echoRenderer, DEBOUNCE_MS)
    manager.openPreview(makeDocument('/docs/a.md', PAPERIFY_DOC) as never, ViewColumn.Active as never)
    manager.openPreview(makeDocument('/docs/b.md', PAPERIFY_DOC) as never, ViewColumn.Active as never)

    manager.dispose()

    expect(__mock.panels.every((panel) => panel.disposed)).toBe(true)
    expect(__mock.changeTextDocument.listeners.size).toBe(0)
  })
})
