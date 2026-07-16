/**
 * remark plugin: statically renders fenced Mermaid code blocks as semantic
 * image figures. The renderer itself is injected by the host.
 */

import { Buffer } from 'node:buffer'

import { visit } from 'unist-util-visit'
import type { Code, Paragraph, Root } from 'mdast'
import type { Element } from 'hast'
import type { Parent } from 'unist'
import type { VFile } from 'vfile'

import type {
  MermaidConversionOptions,
  MermaidRenderOutcome,
  MermaidRenderValue
} from '../mermaid.js'

interface MermaidInstance {
  node: Code
  index: number
  parent: Parent
}

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
}

function figureNode(result: MermaidRenderValue): Paragraph {
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
    type: 'paragraph',
    children: [],
    data: {
      hName: 'figure',
      hProperties: {
        className: ['image-figure', 'mermaid-figure']
      },
      hChildren: [image]
    }
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

export default function remarkMermaid(
  options?: MermaidConversionOptions
) {
  return async (tree: Root, file: VFile): Promise<void> => {
    const instances: MermaidInstance[] = []
    visit(tree, 'code', (node: Code, index, parent) => {
      if (node.lang?.trim().toLowerCase() !== 'mermaid') return
      if (!parent || typeof index !== 'number') return
      instances.push({ node, index, parent })
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
        instances.map((instance) => instance.node.value)
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
