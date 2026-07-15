/**
 * extension.ts
 *
 * Activation glue: registers the preview and PDF export commands, maintains
 * the `paperify.isPaperifyDocument` context key that gates the editor-title
 * buttons, and wires the Paperify renderer to the preview manager.
 */

import path from 'node:path'
import * as vscode from 'vscode'

import { readStyleBundle } from 'paperify/api'
import { isPaperifyDocument } from './detect'
import { PdfExportController } from './exportController'
import { PreviewManager } from './preview'
import { renderPreviewHtml, type PreviewRenderer } from './render'

const CONTEXT_KEY = 'paperify.isPaperifyDocument'
const CONTEXT_DEBOUNCE_MS = 200

function createCssLoader(context: vscode.ExtensionContext): () => string {
  let css: string | undefined
  return () =>
    (css ??= readStyleBundle({
      cssFile: context.asAbsolutePath(path.join('assets', 'paperify.css'))
    }).content)
}

function createRenderer(loadCss: () => string): PreviewRenderer {
  return (request) => renderPreviewHtml({ ...request, css: loadCss() })
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Paperify')
  const loadCss = createCssLoader(context)
  const manager = new PreviewManager(output, createRenderer(loadCss))
  const pdfExport = new PdfExportController(output, loadCss)

  let contextTimer: ReturnType<typeof setTimeout> | undefined
  let lastContextValue: boolean | undefined

  const applyContextKey = (editor: vscode.TextEditor | undefined): void => {
    const value =
      editor?.document.languageId === 'markdown' &&
      isPaperifyDocument(editor.document.getText())
    if (value === lastContextValue) return
    lastContextValue = value
    void vscode.commands.executeCommand('setContext', CONTEXT_KEY, value)
  }

  // Editing the frontmatter can flip a document in or out of Paperify mode,
  // so the context key follows document changes with a small debounce.
  const scheduleContextKeyUpdate = (): void => {
    if (contextTimer !== undefined) clearTimeout(contextTimer)
    contextTimer = setTimeout(() => {
      contextTimer = undefined
      applyContextKey(vscode.window.activeTextEditor)
    }, CONTEXT_DEBOUNCE_MS)
  }

  const openFromActiveEditor = (column: vscode.ViewColumn): void => {
    const editor = vscode.window.activeTextEditor
    if (!editor) {
      void vscode.window.showInformationMessage(
        'Open a Markdown document to use the Paperify preview.'
      )
      return
    }
    manager.openPreview(editor.document, column)
  }

  context.subscriptions.push(
    output,
    manager,
    pdfExport,
    vscode.commands.registerCommand('paperify.openPreview', () =>
      openFromActiveEditor(vscode.ViewColumn.Active)
    ),
    vscode.commands.registerCommand('paperify.openPreviewToSide', () =>
      openFromActiveEditor(vscode.ViewColumn.Beside)
    ),
    vscode.commands.registerCommand('paperify.exportPdf', () => {
      const editor = vscode.window.activeTextEditor
      if (!editor) {
        void vscode.window.showInformationMessage(
          'Open a Markdown document to export a Paperify PDF.'
        )
        return
      }
      void pdfExport.exportDocument(editor.document)
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (contextTimer !== undefined) {
        clearTimeout(contextTimer)
        contextTimer = undefined
      }
      applyContextKey(editor)
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document === vscode.window.activeTextEditor?.document) {
        scheduleContextKeyUpdate()
      }
    }),
    {
      dispose: () => {
        if (contextTimer !== undefined) clearTimeout(contextTimer)
      }
    }
  )

  applyContextKey(vscode.window.activeTextEditor)
}

export function deactivate(): void {}
