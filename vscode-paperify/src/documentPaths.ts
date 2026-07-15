/**
 * documentPaths.ts
 *
 * Path helpers shared by the preview manager and the PDF export controller.
 */

import path from 'node:path'
import * as vscode from 'vscode'

/** Absolute path of the document on disk; undefined for untitled files. */
export function documentPath(document: vscode.TextDocument): string | undefined {
  if (document.isUntitled || document.uri.scheme !== 'file') return undefined
  return document.uri.fsPath
}

export function documentDir(document: vscode.TextDocument): string | undefined {
  const filePath = documentPath(document)
  return filePath === undefined ? undefined : path.dirname(filePath)
}

export function fallbackInputDir(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()
}
