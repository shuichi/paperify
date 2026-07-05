/**
 * transforms/figureDirective.ts
 *
 * remark plugin: handles the leaf directive
 *
 *   ::figure{src="images/system.png" alt="System diagram" caption="System overview" wide=true}
 *
 * and turns it into a semantic <figure>, optionally with class="wide"
 * so the print stylesheet can span it across both columns.
 */

import { visit, SKIP } from 'unist-util-visit'
import type { Root } from 'mdast'
import type { LeafDirective } from 'mdast-util-directive'
import type { VFile } from 'vfile'
import { buildFigureChildren } from './figures.js'

/** Directive attributes arrive as strings; interpret booleans leniently. */
export function isTruthyAttribute(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return false
  const v = value.trim().toLowerCase()
  // A bare attribute (`wide`) parses to an empty string: treat as true.
  return v === '' || v === 'true' || v === '1' || v === 'yes'
}

export default function remarkFigureDirective() {
  return (tree: Root, file: VFile) => {
    visit(tree, 'leafDirective', (node: LeafDirective, index, parent) => {
      if (node.name !== 'figure') return
      if (!parent || typeof index !== 'number') return

      const attrs = node.attributes ?? {}
      const src = attrs.src?.trim()
      if (!src) {
        file.message('::figure directive is missing a src attribute', node)
        parent.children.splice(index, 1)
        return [SKIP, index]
      }

      const caption = attrs.caption ?? ''
      const alt = attrs.alt ?? caption
      const wide = isTruthyAttribute(attrs.wide)

      const className = ['image-figure']
      if (wide) className.push('wide')

      node.data = {
        ...node.data,
        hName: 'figure',
        hProperties: { className },
        hChildren: buildFigureChildren(src, alt, caption)
      }
      return SKIP
    })
  }
}
