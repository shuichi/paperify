/**
 * htmlExportController.ts
 *
 * VS Code glue for standalone HTML export: validation, save/progress UI,
 * duplicate-run protection, warning logging, and concise error reporting.
 */

import os from 'node:os'
import path from 'node:path'
import * as vscode from 'vscode'

import type { MermaidRenderer } from 'paperify/api'
import { BrowserLaunchError } from 'paperify/pdf'

import { isPaperifyDocument } from './detect'
import { documentDir, documentPath, fallbackInputDir } from './documentPaths'
import {
  exportHtmlToFile,
  type ExportHtmlRequest,
  type ExportHtmlResult
} from './html'

export const NOT_PAPERIFY_HTML_EXPORT_MESSAGE =
  'Paperify HTML export is only available for Markdown documents with "paperify: true" in the YAML frontmatter.'

export const HTML_EXPORT_IN_PROGRESS_MESSAGE =
  'Paperify is already exporting HTML for this document.'

export const MISSING_HTML_BROWSER_MESSAGE =
  'Paperify could not find or launch a Chrome, Edge, or Chromium browser needed to render Mermaid diagrams. ' +
  'Install Google Chrome, or set "paperify.pdf.browserExecutable".'

const OPEN_SETTINGS_ACTION = 'Open Settings'
const SHOW_OUTPUT_ACTION = 'Show Output'
const OPEN_HTML_ACTION = 'Open HTML'

export type HtmlExporter = (
  request: ExportHtmlRequest
) => Promise<ExportHtmlResult>

function defaultHtmlUri(document: vscode.TextDocument): vscode.Uri {
  const filePath = documentPath(document)
  if (filePath) {
    const parsed = path.parse(filePath)
    return vscode.Uri.file(path.join(parsed.dir, `${parsed.name}.html`))
  }
  const folder =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir()
  return vscode.Uri.file(path.join(folder, 'paperify.html'))
}

export class HtmlExportController implements vscode.Disposable {
  private readonly inFlight = new Set<string>()

  constructor(
    private readonly output: vscode.OutputChannel,
    private readonly loadCss: () => string,
    private readonly exporter: HtmlExporter = exportHtmlToFile,
    private readonly mermaidRenderer?: MermaidRenderer
  ) {}

  dispose(): void {
    this.inFlight.clear()
  }

  async exportDocument(document: vscode.TextDocument): Promise<boolean> {
    if (
      document.languageId !== 'markdown' ||
      !isPaperifyDocument(document.getText())
    ) {
      void vscode.window.showInformationMessage(
        NOT_PAPERIFY_HTML_EXPORT_MESSAGE
      )
      return false
    }

    const key = document.uri.toString()
    if (this.inFlight.has(key)) {
      void vscode.window.showInformationMessage(
        HTML_EXPORT_IN_PROGRESS_MESSAGE
      )
      return false
    }

    const target = await vscode.window.showSaveDialog({
      defaultUri: defaultHtmlUri(document),
      filters: { HTML: ['html'] }
    })
    if (!target) return false

    this.inFlight.add(key)
    try {
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Paperify: exporting ${path.basename(target.fsPath)}…`
        },
        () =>
          this.exporter({
            markdown: document.getText(),
            inputDir: documentDir(document) ?? fallbackInputDir(),
            documentPath: documentPath(document),
            outputPath: target.fsPath,
            css: this.loadCss(),
            mermaidRenderer: this.mermaidRenderer
          })
      )
      this.logWarnings(key, result.warnings)
      void this.showSuccess(target)
      return true
    } catch (error) {
      this.reportFailure(key, error)
      return false
    } finally {
      this.inFlight.delete(key)
    }
  }

  private logWarnings(key: string, warnings: string[]): void {
    for (const warning of warnings) {
      this.output.appendLine(`[warning] ${key}: ${warning}`)
    }
  }

  private async showSuccess(target: vscode.Uri): Promise<void> {
    const choice = await vscode.window.showInformationMessage(
      `Paperify: exported ${path.basename(target.fsPath)}`,
      OPEN_HTML_ACTION
    )
    if (choice === OPEN_HTML_ACTION) {
      void vscode.env.openExternal(target)
    }
  }

  private reportFailure(key: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    this.output.appendLine(`[error] ${key}: HTML export failed: ${message}`)
    if (error instanceof Error && error.stack) {
      this.output.appendLine(error.stack)
    }

    if (error instanceof BrowserLaunchError) {
      void vscode.window
        .showErrorMessage(
          MISSING_HTML_BROWSER_MESSAGE,
          OPEN_SETTINGS_ACTION
        )
        .then((choice) => {
          if (choice === OPEN_SETTINGS_ACTION) {
            void vscode.commands.executeCommand(
              'workbench.action.openSettings',
              'paperify.pdf.browserExecutable'
            )
          }
        })
      return
    }

    const firstLine = message.split('\n', 1)[0]
    void vscode.window
      .showErrorMessage(
        `Paperify: HTML export failed: ${firstLine}`,
        SHOW_OUTPUT_ACTION
      )
      .then((choice) => {
        if (choice === SHOW_OUTPUT_ACTION) this.output.show()
      })
  }
}
