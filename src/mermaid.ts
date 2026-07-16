/**
 * mermaid.ts
 *
 * Static Mermaid rendering through a Puppeteer-compatible browser supplied by
 * the host. Like paperify/pdf, this module deliberately does not import either
 * `puppeteer` or `puppeteer-core`: the CLI and VS Code extension decide which
 * implementation and browser executable to use.
 */

import { createRequire } from 'node:module'

import { BrowserLaunchError } from './pdf.js'

export interface MermaidRenderValue {
  svg: string
  title?: string
  description?: string
}

export type MermaidRenderOutcome =
  | { ok: true; value: MermaidRenderValue }
  | { ok: false; error: string }

/** Renders a batch in input order. Per-diagram syntax errors stay isolated. */
export type MermaidRenderer = (
  definitions: readonly string[]
) => Promise<MermaidRenderOutcome[]>

export type MermaidFailureMode = 'error' | 'warn'

export interface MermaidConversionOptions {
  renderer: MermaidRenderer
  /** Defaults to `error`; previews can use `warn` while a diagram is edited. */
  failureMode?: MermaidFailureMode
}

/** Structural subset shared by Puppeteer and Puppeteer Core pages. */
export interface MermaidBrowserPage {
  setContent(html: string): Promise<unknown>
  addScriptTag(options: { path: string }): Promise<unknown>
  setOfflineMode(enabled: boolean): Promise<unknown>
  evaluate(
    pageFunction: (...arguments_: any[]) => any,
    ...arguments_: any[]
  ): Promise<any>
  close(): Promise<unknown>
}

export interface MermaidBrowser {
  newPage(): Promise<MermaidBrowserPage>
  close(): Promise<unknown>
}

export type MermaidBrowserLauncher = (options: {
  executablePath?: string
}) => Promise<MermaidBrowser>

export interface MermaidRenderRuntime {
  launch: MermaidBrowserLauncher
  /** Guidance appended when Chromium cannot be found or launched. */
  missingBrowserHelp?: string
}

export interface CreateMermaidRendererOptions {
  /** Local `mermaid.min.js`; defaults to the installed Mermaid package. */
  scriptPath?: string
  /** Optional Chrome/Chromium executable selected by the host. */
  browserExecutablePath?: string
}

export interface MermaidRendererSession {
  /** Lazily launches and reuses a browser; identical diagrams are cached. */
  render: MermaidRenderer
  /** Closes the browser if Mermaid rendering caused one to be launched. */
  dispose(): Promise<void>
}

const DEFAULT_MISSING_BROWSER_HELP =
  'Mermaid rendering needs Chrome or Chromium. Run ' +
  '`npx puppeteer browsers install chrome`, or pass ' +
  '`--browser-executable <path>`, and try again.'

function isMissingBrowserMessage(message: string): boolean {
  return (
    message.includes('Could not find Chrome') ||
    message.includes('Could not find Chromium') ||
    message.includes('Could not find Google Chrome') ||
    message.includes('Browser was not found') ||
    message.includes('Failed to launch the browser process')
  )
}

function asBrowserError(error: unknown, help: string): Error {
  if (error instanceof BrowserLaunchError) return error
  const message = error instanceof Error ? error.message : String(error)
  if (isMissingBrowserMessage(message)) {
    return new BrowserLaunchError(`${message}\n\n${help}`)
  }
  return error instanceof Error ? error : new Error(message)
}

/** Resolve the standalone browser bundle shipped by the Mermaid package. */
export function defaultMermaidScriptPath(): string {
  const require = createRequire(import.meta.url)
  return require.resolve('mermaid/dist/mermaid.min.js')
}

/**
 * Create a lazy renderer session. A fresh page is used for each uncached batch
 * so Mermaid's generated IDs remain deterministic across rebuilds, while the
 * much more expensive browser process is shared by live preview builds.
 */
export function createMermaidRenderer(
  options: CreateMermaidRendererOptions,
  runtime: MermaidRenderRuntime
): MermaidRendererSession {
  const scriptPath = options.scriptPath ?? defaultMermaidScriptPath()
  const help = runtime.missingBrowserHelp ?? DEFAULT_MISSING_BROWSER_HELP
  const cache = new Map<string, MermaidRenderValue>()
  let browserPromise: Promise<MermaidBrowser> | undefined

  const getBrowser = (): Promise<MermaidBrowser> => {
    if (!browserPromise) {
      browserPromise = runtime
        .launch({ executablePath: options.browserExecutablePath })
        .catch((error) => {
          browserPromise = undefined
          throw asBrowserError(error, help)
        })
    }
    return browserPromise
  }

  const renderUncached = async (
    definitions: readonly string[]
  ): Promise<MermaidRenderOutcome[]> => {
    const browser = await getBrowser()
    const page = await browser.newPage()
    try {
      await page.setContent(
        '<!doctype html><html><head><meta charset="utf-8"></head>' +
          '<body><div id="paperify-mermaid-container"></div></body></html>'
      )
      await page.addScriptTag({ path: scriptPath })
      // Rendering is deliberately offline. The compiled document must not
      // depend on a CDN, remote fonts, or images fetched while building.
      await page.setOfflineMode(true)

      return (await page.evaluate(
        async (diagramDefinitions) => {
          // This callback executes inside Chromium, not Node. The project does
          // not include DOM types, so keep the browser-global surface explicit.
          const scope = globalThis as any
          const mermaid = scope.mermaid
          const container = scope.document.getElementById(
            'paperify-mermaid-container'
          )

          if (!mermaid || !container) {
            throw new Error('Mermaid browser bundle did not initialize')
          }

          mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            deterministicIds: true,
            deterministicIDSeed: 'paperify',
            fontFamily: 'Arial, sans-serif'
          })

          const outcomes: MermaidRenderOutcome[] = []
          for (let index = 0; index < diagramDefinitions.length; index++) {
            const definition = diagramDefinitions[index]
            const id = `paperify-mermaid-${index + 1}`
            try {
              const rendered = await mermaid.render(id, definition, container)
              // Mermaid labels are HTML inside SVG foreignObject elements.
              // Its serialized output can therefore contain valid HTML void
              // elements such as `<br>`, which an XML parser rejects. Parse
              // the result as an inert HTML fragment first, then serialize
              // the sanitized DOM back to well-formed XML below.
              const template = scope.document.createElement('template')
              template.innerHTML = rendered.svg.trim()
              const roots = [...template.content.children]
              const root = roots.length === 1 ? roots[0] : undefined
              if (
                !root ||
                root.localName !== 'svg' ||
                root.namespaceURI !== 'http://www.w3.org/2000/svg'
              ) {
                throw new Error('Mermaid returned a non-SVG fragment')
              }

              // SVG is embedded as an image (and is therefore already inert),
              // but also remove active content and external references before
              // it reaches the final standalone document.
              for (const element of root.querySelectorAll(
                'script, iframe, object, embed'
              )) {
                element.remove()
              }
              for (const element of [root, ...root.querySelectorAll('*')]) {
                for (const attribute of [...element.attributes]) {
                  const name = attribute.name.toLowerCase()
                  const value = attribute.value.trim()
                  if (name.startsWith('on')) {
                    element.removeAttribute(attribute.name)
                    continue
                  }
                  if (
                    (name === 'href' || name === 'xlink:href') &&
                    !value.startsWith('#') &&
                    !/^data:image\//i.test(value)
                  ) {
                    element.removeAttribute(attribute.name)
                  }
                }
              }
              for (const style of root.querySelectorAll('style')) {
                style.textContent = (style.textContent ?? '')
                  .replace(/@import\s+[^;]+;?/gi, '')
                  .replace(
                    /url\(\s*(['"]?)(.*?)\1\s*\)/gi,
                    (match: string, _quote: string, target: string) => {
                      const value = target.trim()
                      return value.startsWith('#') || /^data:image\//i.test(value)
                        ? match
                        : 'none'
                    }
                  )
              }

              const directChildren = [...root.children]
              const title = directChildren.find(
                (child) => child.localName === 'title'
              )?.textContent
              const description = directChildren.find(
                (child) => child.localName === 'desc'
              )?.textContent
              const svg = new scope.XMLSerializer().serializeToString(root)

              outcomes.push({
                ok: true,
                value: {
                  svg,
                  ...(title?.trim() ? { title: title.trim() } : {}),
                  ...(description?.trim()
                    ? { description: description.trim() }
                    : {})
                }
              })
            } catch (error) {
              const message =
                error && typeof error === 'object' && 'message' in error
                  ? String((error as { message: unknown }).message)
                  : String(error)
              outcomes.push({ ok: false, error: message })
            } finally {
              container.replaceChildren()
              for (const temporary of scope.document.querySelectorAll(
                '[id^="dpaperify-mermaid-"]'
              )) {
                temporary.remove()
              }
            }
          }
          return outcomes
        },
        definitions
      )) as MermaidRenderOutcome[]
    } finally {
      await page.close()
    }
  }

  const render: MermaidRenderer = async (definitions) => {
    const outcomes: Array<MermaidRenderOutcome | undefined> = new Array(
      definitions.length
    )
    const missingDefinitions: string[] = []
    const missingIndexes = new Map<string, number[]>()

    for (let index = 0; index < definitions.length; index++) {
      const definition = definitions[index]
      const cached = cache.get(definition)
      if (cached) {
        outcomes[index] = { ok: true, value: cached }
        continue
      }
      const indexes = missingIndexes.get(definition)
      if (indexes) {
        indexes.push(index)
      } else {
        missingIndexes.set(definition, [index])
        missingDefinitions.push(definition)
      }
    }

    if (missingDefinitions.length > 0) {
      const rendered = await renderUncached(missingDefinitions)
      for (let index = 0; index < missingDefinitions.length; index++) {
        const definition = missingDefinitions[index]
        const outcome = rendered[index] ?? {
          ok: false as const,
          error: 'Mermaid renderer returned no result'
        }
        if (outcome.ok) cache.set(definition, outcome.value)
        for (const target of missingIndexes.get(definition) ?? []) {
          outcomes[target] = outcome
        }
      }
    }

    return outcomes.map(
      (outcome) =>
        outcome ?? {
          ok: false,
          error: 'Mermaid renderer returned no result'
        }
    )
  }

  return {
    render,
    async dispose() {
      const pending = browserPromise
      browserPromise = undefined
      cache.clear()
      if (pending) {
        try {
          const browser = await pending
          await browser.close()
        } catch {
          // A failed launch is already reported to the render caller.
        }
      }
    }
  }
}
