/**
 * actionPicker.ts
 *
 * The single editor-title Paperify button opens this compact command picker.
 * Each item delegates to a contributed command so the same actions remain
 * available from VS Code's regular command palette and can evolve
 * independently of this UI.
 */

import * as vscode from 'vscode'

export interface PaperifyAction extends vscode.QuickPickItem {
  command: string
}

export const PAPERIFY_ACTIONS: readonly PaperifyAction[] = [
  {
    label: '$(open-preview) Open Preview',
    description: 'Open in the current editor group',
    command: 'paperify.openPreview'
  },
  {
    label: '$(split-horizontal) Open Preview to the Side',
    description: 'Open beside the Markdown editor',
    command: 'paperify.openPreviewToSide'
  },
  {
    label: '$(code) Export HTML',
    description: 'Write a portable standalone document',
    command: 'paperify.exportHtml'
  },
  {
    label: '$(file-pdf) Export PDF',
    description: 'Write a print-ready document',
    command: 'paperify.exportPdf'
  }
]

export async function showPaperifyActions(): Promise<void> {
  const selected = await vscode.window.showQuickPick([...PAPERIFY_ACTIONS], {
    title: 'Paperify',
    placeHolder: 'Select an action',
    matchOnDescription: true
  })
  if (selected) await vscode.commands.executeCommand(selected.command)
}
