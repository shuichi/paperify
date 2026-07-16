import { beforeEach, describe, expect, it } from 'vitest'

import {
  PAPERIFY_ACTIONS,
  showPaperifyActions
} from '../src/actionPicker'
import { __mock } from './mocks/vscode'

beforeEach(() => {
  __mock.reset()
})

describe('Paperify action picker', () => {
  it('shows every supported action in a stable order', async () => {
    await showPaperifyActions()

    expect(__mock.quickPickCalls).toHaveLength(1)
    const call = __mock.quickPickCalls[0]
    expect(
      call.items.map((item) => (item as { command: string }).command)
    ).toEqual([
      'paperify.openPreview',
      'paperify.openPreviewToSide',
      'paperify.exportHtml',
      'paperify.exportPdf'
    ])
    expect(call.options).toMatchObject({
      title: 'Paperify',
      placeHolder: 'Select an action'
    })
  })

  it('delegates the selected item to its contributed command', async () => {
    __mock.quickPickResult = PAPERIFY_ACTIONS[2]

    await showPaperifyActions()

    expect(__mock.executedCommands).toEqual([['paperify.exportHtml']])
  })

  it('does nothing when the picker is cancelled', async () => {
    __mock.quickPickResult = undefined

    await showPaperifyActions()

    expect(__mock.executedCommands).toEqual([])
  })
})
