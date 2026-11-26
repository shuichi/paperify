/**
 * Render Mermaid code blocks after raw HTML sanitization so that generated
 * image data URIs can be trusted without permitting data URIs in raw HTML.
 */

import { Buffer } from 'node:buffer'

import { visit } from 'unist-util-visit'
import type { Element, Root } from 'hast'
import type { VFile } from 'vfile'

import type {
  MermaidConversionOptions,
  MermaidRenderOutcome,
  MermaidRenderValue
} from '../mermaid.js'

interface MermaidInstance {
  node: Element
  definition: string
  index: number
  parent: Element | Root
}

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
}

function figureNode(result: MermaidRenderValue): Element {
  const description = result.description?.trim()
  const title = result.title?.trim()
  const image: Element = {
    type: 'element',
    tagName: 'img',
    properties: {
      src: svgDataUri(result.svg),
      alt: description || title || 'Mermaid diagram',
      ...(title ? { title } : {})
    },
    children: []
  }

  return {
    type: 'element',
    tagName: 'figure',
    properties: { className: ['image-figure', 'mermaid-figure'] },
    children: [image]
  }
}

function renderFailure(
  file: VFile,
  instance: MermaidInstance,
  reason: string,
  failureMode: 'error' | 'warn'
): void {
  const message = file.message(
    `Mermaid diagram could not be rendered: ${reason}`,
    instance.node
  )
  if (failureMode === 'error') {
    message.fatal = true
    throw message
  }
}

export default function rehypeMermaid(
  options?: MermaidConversionOptions
) {
  return async (tree: Root, file: VFile): Promise<void> => {
    const instances: MermaidInstance[] = []
    visit(tree, 'element', (node, index, parent) => {
      if (node.tagName !== 'pre' || !parent || typeof index !== 'number') return
      if (node.children.length !== 1) return
      const [code] = node.children
      if (code?.type !== 'element' || code.tagName !== 'code') return
      const classes = code.properties.className
      if (!Array.isArray(classes) || !classes.some(
        (value) => String(value).toLowerCase() === 'language-mermaid'
      )) return
      const [text] = code.children
      if (text && (text.type !== 'text' || code.children.length !== 1)) return
      // remark-rehype adds one terminal newline to nonempty fenced code.
      const definition = text?.value.replace(/\n$/, '') ?? ''
      instances.push({ node, definition, index, parent })
    })

    if (instances.length === 0) return

    if (!options) {
      for (const instance of instances) {
        file.message(
          'Mermaid code block was not rendered because no Mermaid renderer was provided',
          instance.node
        )
      }
      return
    }

    const failureMode = options.failureMode ?? 'error'
    let outcomes: MermaidRenderOutcome[]
    try {
      outcomes = await options.renderer(
        instances.map((instance) => instance.definition)
      )
    } catch (error) {
      // Infrastructure failures (most importantly, a missing browser) retain
      // their original error class in strict builds so hosts can show their
      // specialized recovery UI. Live preview still degrades to warnings.
      if (failureMode === 'error') throw error
      const reason = error instanceof Error ? error.message : String(error)
      for (const instance of instances) {
        renderFailure(file, instance, reason, failureMode)
      }
      return
    }

    for (let index = 0; index < instances.length; index++) {
      const instance = instances[index]
      const outcome = outcomes[index]
      if (!outcome) {
        renderFailure(
          file,
          instance,
          'renderer returned no result',
          failureMode
        )
        continue
      }
      if (!outcome.ok) {
        renderFailure(file, instance, outcome.error, failureMode)
        continue
      }
      instance.parent.children[instance.index] = figureNode(outcome.value)
    }
  }
}
