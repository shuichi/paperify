import { describe, it, expect } from 'vitest'

import {
  createMermaidRenderer,
  type MermaidBrowser,
  type MermaidBrowserPage,
  type MermaidRenderOutcome
} from '../src/mermaid.js'
import { BrowserLaunchError } from '../src/pdf.js'

interface FakeBrowserRun {
  browser: MermaidBrowser
  launches: number
  pages: number
  closes: number
  pageCloses: number
  offlineCalls: boolean[]
  scriptPaths: string[]
  definitions: string[][]
}

function fakeBrowser(): FakeBrowserRun {
  const run: FakeBrowserRun = {
    launches: 0,
    pages: 0,
    closes: 0,
    pageCloses: 0,
    offlineCalls: [],
    scriptPaths: [],
    definitions: [],
    browser: undefined as never
  }
  run.browser = {
    async newPage(): Promise<MermaidBrowserPage> {
      run.pages++
      return {
        setContent: async () => {},
        addScriptTag: async ({ path }) => {
          run.scriptPaths.push(path)
        },
        setOfflineMode: async (enabled) => {
          run.offlineCalls.push(enabled)
        },
        evaluate: async (_callback, definitions: readonly string[]) => {
          run.definitions.push([...definitions])
          return definitions.map(
            (definition): MermaidRenderOutcome => ({
              ok: true,
              value: {
                svg: `<svg><desc>${definition}</desc></svg>`,
                description: definition
              }
            })
          )
        },
        close: async () => {
          run.pageCloses++
        }
      }
    },
    close: async () => {
      run.closes++
    }
  }
  return run
}

describe('Mermaid browser renderer', () => {
  it('launches lazily, renders offline, and caches identical diagrams', async () => {
    const run = fakeBrowser()
    const session = createMermaidRenderer(
      { scriptPath: '/assets/mermaid.min.js' },
      {
        launch: async () => {
          run.launches++
          return run.browser
        }
      }
    )

    expect(run.launches).toBe(0)
    const first = await session.render(['graph TD\nA-->B', 'graph TD\nA-->B'])
    const second = await session.render(['graph TD\nA-->B'])

    expect(first).toHaveLength(2)
    expect(second).toHaveLength(1)
    expect(run.launches).toBe(1)
    expect(run.pages).toBe(1)
    expect(run.definitions).toEqual([['graph TD\nA-->B']])
    expect(run.scriptPaths).toEqual(['/assets/mermaid.min.js'])
    expect(run.offlineCalls).toEqual([true])
    expect(run.pageCloses).toBe(1)

    await session.dispose()
    expect(run.closes).toBe(1)
  })

  it('adds actionable guidance to browser launch failures', async () => {
    const session = createMermaidRenderer(
      { scriptPath: '/assets/mermaid.min.js' },
      {
        launch: async () => {
          throw new Error('Could not find Chrome')
        },
        missingBrowserHelp: 'Install a browser for this host.'
      }
    )

    const error = await session.render(['graph TD\nA-->B']).catch((reason) => reason)
    expect(error).toBeInstanceOf(BrowserLaunchError)
    expect((error as Error).message).toContain('Install a browser for this host.')
  })

  it.runIf(Boolean(process.env['PAPERIFY_TEST_BROWSER']))(
    'accepts HTML line breaks emitted inside SVG foreignObject labels',
    async () => {
      const { default: puppeteer } = await import('puppeteer')
      const session = createMermaidRenderer(
        {
          browserExecutablePath: process.env['PAPERIFY_TEST_BROWSER']
        },
        {
          launch: (options) => puppeteer.launch(options)
        }
      )

      try {
        const outcomes = await session.render([
          'flowchart TD\nA["line 1<br/>line 2"] --> B',
          `flowchart TD
    A["TouchEvent<br/>{id, x, y}, 時刻, 操作面サイズ"] --> R{"指の本数による<br/>UI ルーティング"}
    R -->|"1 本または 2 本"| T["TouchpadEngine<br/>相対差分・速度・基礎ゲイン"]
    T --> K{"Touchpad の action"}
    K -->|"pointer-move<br/>pointer / drag"| D["方向安定化<br/>時間減衰・コヒーレンス・一致度"]`
        ])

        expect(outcomes).toHaveLength(2)
        for (const outcome of outcomes) {
          expect(outcome.ok).toBe(true)
          if (!outcome.ok) continue
          expect(outcome.value.svg).toMatch(/^<svg\b/)
          expect(outcome.value.svg).toContain('<foreignObject')
          expect(outcome.value.svg).toContain('<br')
        }
      } finally {
        await session.dispose()
      }
    },
    30_000
  )
})
