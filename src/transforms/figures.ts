/**
 * transforms/figures.ts
 *
 * remark plugin: any paragraph whose only meaningful child is an image
 * is promoted to a semantic <figure>. The image alt text doubles as the
 * visible <figcaption>; the alt attribute itself is always preserved on
 * the <img> for accessibility. Images with no alt text produce a figure
 * without a visible (empty) caption.
 */

import { visit, SKIP } from 'unist-util-visit'
import type { Root, Paragraph, Image, ImageReference, PhrasingContent } from 'mdast'
import type { Element, ElementContent } from 'hast'

function onlyImage(node: Paragraph): Image | ImageReference | undefined {
  const meaningful: PhrasingContent[] = node.children.filter(
    (child) => !(child.type === 'text' && child.value.trim() === '')
  )
  const [child] = meaningful
  return meaningful.length === 1 && (child.type === 'image' || child.type === 'imageReference')
    ? child
    : undefined
}

export function buildFigureChildren(
  src: string,
  alt: string,
  caption: string
): ElementContent[] {
  const img: Element = {
    type: 'element',
    tagName: 'img',
    properties: {
      src,
      alt
    },
    children: []
  }
  const children: ElementContent[] = [img]
  if (caption.trim().length > 0) {
    children.push({
      type: 'element',
      tagName: 'figcaption',
      properties: {},
      children: [{ type: 'text', value: caption }]
    })
  }
  return children
}

export default function remarkImageFigures() {
  return (tree: Root) => {
    visit(tree, 'paragraph', (node: Paragraph, index, parent) => {
      if (!parent || typeof index !== 'number') return
      const image = onlyImage(node)
      if (!image) return

      // Let remark-rehype resolve the image itself, including reference
      // definitions, titles and URL normalization.
      node.children = [image]
      if (image.alt?.trim()) {
        node.children.push({
          type: 'text',
          value: image.alt,
          data: { hName: 'figcaption' }
        })
      }
      node.data = {
        ...node.data,
        hName: 'figure',
        hProperties: { className: ['image-figure'] }
      }
      return SKIP
    })
  }
}
