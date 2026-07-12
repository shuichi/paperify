/**
 * extension.ts
 *
 * Activation glue: registers the preview commands, maintains the
 * `paperify.isPaperifyDocument` context key that gates the editor-title
 * button, and wires the Paperify renderer to the preview manager.
 */

import path from 'node:path'
import * as vscode from 'vscode'

import { readStyleBundle } from 'paperify/api'
import { isPaperifyDocument } from './detect'
import { PreviewManager } from './preview'
import { renderPreviewHtml, type PreviewRenderer } from './render'

const CONTEXT_KEY = 'paperify.isPaperifyDocument'
const CONTEXT_DEBOUNCE_MS = 200

function createRenderer(context: vscode.ExtensionContext): PreviewRenderer {
  let css: string | undefined
  return async (request) => {
    css ??= readStyleBundle({
      cssFile: context.asAbsolutePath(path.join('assets', 'paperify.css'))
    }).content
    return renderPreviewHtml({ ...request, css })
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Paperify')
  const manager = new PreviewManager(output, createRenderer(context))

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
    vscode.commands.registerCommand('paperify.openPreview', () =>
      openFromActiveEditor(vscode.ViewColumn.Active)
    ),
    vscode.commands.registerCommand('paperify.openPreviewToSide', () =>
      openFromActiveEditor(vscode.ViewColumn.Beside)
    ),
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
