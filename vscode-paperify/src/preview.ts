/**
 * preview.ts
 *
 * Owns the preview webview panels: one panel per Paperify document, live
 * updates from unsaved editor content with debouncing, and a generation
 * counter so a slow conversion can never overwrite a newer one.
 */

import path from 'node:path'
import * as vscode from 'vscode'

import { isPaperifyDocument } from './detect'
import { documentDir, documentPath, fallbackInputDir } from './documentPaths'
import { renderPreviewErrorHtml, type PreviewRenderer } from './render'

export const NOT_PAPERIFY_MESSAGE =
  'Paperify preview is only available for Markdown documents with "paperify: true" in the YAML frontmatter.'

const VIEW_TYPE = 'paperify.preview'
const DEFAULT_DEBOUNCE_MS = 200

interface PreviewEntry {
  readonly key: string
  readonly document: vscode.TextDocument
  readonly panel: vscode.WebviewPanel
  readonly disposables: vscode.Disposable[]
  generation: number
  timer: ReturnType<typeof setTimeout> | undefined
  disposed: boolean
  lastLoggedWarnings: string
}

function previewTitle(document: vscode.TextDocument): string {
  if (document.isUntitled) return 'Paperify Preview'
  return `Paperify: ${path.basename(document.uri.fsPath)}`
}

export class PreviewManager implements vscode.Disposable {
  private readonly entries = new Map<string, PreviewEntry>()

  constructor(
    private readonly output: vscode.OutputChannel,
    private readonly renderer: PreviewRenderer,
    private readonly debounceMs: number = DEFAULT_DEBOUNCE_MS
  ) {}

  /**
   * Open (or reveal) the preview for a document. Returns false when the
   * document is not a Paperify document; no panel is created in that case.
   */
  openPreview(
    document: vscode.TextDocument,
    column: vscode.ViewColumn
  ): boolean {
    if (
      document.languageId !== 'markdown' ||
      !isPaperifyDocument(document.getText())
    ) {
      void vscode.window.showInformationMessage(NOT_PAPERIFY_MESSAGE)
      return false
    }

    const key = document.uri.toString()
    const existing = this.entries.get(key)
    if (existing) {
      existing.panel.reveal(column)
      return true
    }

    const dir = documentDir(document)
    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      previewTitle(document),
      column,
      {
        enableScripts: false,
        localResourceRoots: dir ? [vscode.Uri.file(dir)] : []
      }
    )

    const entry: PreviewEntry = {
      key,
      document,
      panel,
      disposables: [],
      generation: 0,
      timer: undefined,
      disposed: false,
      lastLoggedWarnings: ''
    }

    entry.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.toString() === key) this.scheduleUpdate(entry)
      }),
      vscode.workspace.onDidCloseTextDocument((closed) => {
        if (closed.uri.toString() === key) panel.dispose()
      }),
      panel.onDidDispose(() => this.cleanup(entry))
    )

    this.entries.set(key, entry)
    void this.update(entry)
    return true
  }

  hasPreview(document: vscode.TextDocument): boolean {
    return this.entries.has(document.uri.toString())
  }

  dispose(): void {
    for (const entry of [...this.entries.values()]) {
      entry.panel.dispose()
      // panel.dispose() fires onDidDispose → cleanup(), but guard against
      // hosts that do not deliver the event synchronously.
      this.cleanup(entry)
    }
    this.entries.clear()
  }

  private scheduleUpdate(entry: PreviewEntry): void {
    if (entry.disposed) return
    if (entry.timer !== undefined) clearTimeout(entry.timer)
    entry.timer = setTimeout(() => {
      entry.timer = undefined
      void this.update(entry)
    }, this.debounceMs)
  }

  private async update(entry: PreviewEntry): Promise<void> {
    const generation = ++entry.generation
    const { document, panel } = entry
    try {
      const result = await this.renderer({
        markdown: document.getText(),
        inputDir: documentDir(document) ?? fallbackInputDir(),
        documentPath: documentPath(document),
        cspSource: panel.webview.cspSource,
        resolveResource: (absolutePath) =>
          panel.webview.asWebviewUri(vscode.Uri.file(absolutePath)).toString()
      })
      if (entry.disposed || generation !== entry.generation) return
      panel.webview.html = result.html
      this.logWarnings(entry, result.warnings)
    } catch (error) {
      if (entry.disposed || generation !== entry.generation) return
      const message = error instanceof Error ? error.message : String(error)
      this.output.appendLine(`[error] ${entry.key}: ${message}`)
      if (error instanceof Error && error.stack) {
        this.output.appendLine(error.stack)
      }
      panel.webview.html = renderPreviewErrorHtml(
        message,
        panel.webview.cspSource
      )
    }
  }

  private logWarnings(entry: PreviewEntry, warnings: string[]): void {
    const combined = warnings.join('\n')
    // Warnings repeat on every keystroke while the cause persists; only log
    // when the set actually changes.
    if (combined === entry.lastLoggedWarnings) return
    entry.lastLoggedWarnings = combined
    for (const warning of warnings) {
      this.output.appendLine(`[warning] ${entry.key}: ${warning}`)
    }
  }

  private cleanup(entry: PreviewEntry): void {
    if (entry.disposed) return
    entry.disposed = true
    if (entry.timer !== undefined) {
      clearTimeout(entry.timer)
      entry.timer = undefined
    }
    for (const disposable of entry.disposables.splice(0)) {
      try {
        disposable.dispose()
      } catch {
        // Never let one broken listener keep the rest alive.
      }
    }
    this.entries.delete(entry.key)
  }
}
