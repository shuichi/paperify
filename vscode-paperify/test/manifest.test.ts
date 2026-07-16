import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

interface CommandContribution {
  command: string
  icon?: string | { light: string; dark: string }
}

interface MenuContribution {
  command: string
  when?: string
  group?: string
}

interface ExtensionManifest {
  contributes: {
    commands: CommandContribution[]
    menus: Record<string, MenuContribution[]>
  }
}

const manifest = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')
) as ExtensionManifest

describe('extension manifest', () => {
  it('contributes one Paperify editor-title action button', () => {
    expect(manifest.contributes.menus['editor/title']).toEqual([
      {
        command: 'paperify.showActions',
        when: 'editorLangId == markdown && paperify.isPaperifyDocument',
        group: 'navigation'
      }
    ])

    const actionCommand = manifest.contributes.commands.find(
      ({ command }) => command === 'paperify.showActions'
    )
    expect(actionCommand?.icon).toEqual({
      light: 'media/paperify-action-light.svg',
      dark: 'media/paperify-action-dark.svg'
    })
  })

  it('contributes standalone HTML export', () => {
    expect(
      manifest.contributes.commands.some(
        ({ command }) => command === 'paperify.exportHtml'
      )
    ).toBe(true)
  })
})
