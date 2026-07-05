/**
 * transforms/videoDirective.ts
 *
 * remark plugin: handles the leaf directive
 *
 *   ::video{src="media/demo.mp4" poster="media/demo-poster.png" caption="Demo video" controls=true}
 *
 * Emits a semantic media figure:
 *
 *   <figure class="media-figure video-figure">
 *     <video controls poster="...">
 *       <source src="..." type="video/mp4">
 *     </video>
 *     <span class="video-print-fallback">…poster image or placeholder…</span>
 *     <figcaption>…</figcaption>
 *   </figure>
 *
 * The `.video-print-fallback` element is hidden on screen. In print the
 * CSS hides the <video> and shows the fallback instead: the poster image
 * when one exists, otherwise a clean placeholder box carrying the video
 * filename, plus a readable source line so the video remains reachable
 * from paper.
 */

import { visit, SKIP } from 'unist-util-visit'
import type { Root } from 'mdast'
import type { LeafDirective } from 'mdast-util-directive'
import type { Element, ElementContent } from 'hast'
import type { VFile } from 'vfile'
import { isTruthyAttribute } from './figureDirective.js'

const VIDEO_MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'video/ogg',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime'
}

/** Infer a MIME type from the file extension when possible. */
export function inferVideoType(src: string): string | undefined {
  const clean = src.split(/[?#]/)[0]
  const dot = clean.lastIndexOf('.')
  if (dot === -1) return undefined
  return VIDEO_MIME[clean.slice(dot).toLowerCase()]
}

function text(value: string): ElementContent {
  return { type: 'text', value }
}

function el(
  tagName: string,
  properties: Element['properties'],
  children: ElementContent[] = []
): Element {
  return { type: 'element', tagName, properties, children }
}

export default function remarkVideoDirective() {
  return (tree: Root, file: VFile) => {
    visit(tree, 'leafDirective', (node: LeafDirective, index, parent) => {
      if (node.name !== 'video') return
      if (!parent || typeof index !== 'number') return

      const attrs = node.attributes ?? {}
      const src = attrs.src?.trim()
      if (!src) {
        file.message('::video directive is missing a src attribute', node)
        parent.children.splice(index, 1)
        return [SKIP, index]
      }

      const poster = attrs.poster?.trim()
      const caption = attrs.caption ?? ''
      const wide = isTruthyAttribute(attrs.wide)

      // `controls` defaults to on; everything else defaults to off.
      const controls =
        attrs.controls === undefined ? true : isTruthyAttribute(attrs.controls)
      const loop = isTruthyAttribute(attrs.loop)
      const muted = isTruthyAttribute(attrs.muted)
      const autoplay = isTruthyAttribute(attrs.autoplay)

      const mime = inferVideoType(src)

      const video = el(
        'video',
        {
          ...(controls ? { controls: true } : {}),
          ...(loop ? { loop: true } : {}),
          ...(muted ? { muted: true } : {}),
          ...(autoplay ? { autoPlay: true, playsInline: true } : {}),
          ...(poster ? { poster } : {}),
          preload: 'metadata'
        },
        [
          el('source', { src, ...(mime ? { type: mime } : {}) }),
          text('Your browser does not support embedded video. '),
          el('a', { href: src }, [text(src)])
        ]
      )

      // Print fallback: poster image if available, placeholder box otherwise,
      // followed by a readable source line either way.
      const fallbackChildren: ElementContent[] = []
      if (poster) {
        fallbackChildren.push(
          el('img', { src: poster, alt: caption || 'Video poster frame' })
        )
      } else {
        fallbackChildren.push(
          el('span', { className: ['video-placeholder'] }, [
            text(`Video: ${src}`)
          ])
        )
      }
      fallbackChildren.push(
        el('span', { className: ['video-source'] }, [
          text('Video available at: '),
          el('a', { href: src }, [text(src)])
        ])
      )
      const fallback = el(
        'span',
        { className: ['video-print-fallback'] },
        fallbackChildren
      )

      const children: ElementContent[] = [video, fallback]
      if (caption.trim().length > 0) {
        children.push(el('figcaption', {}, [text(caption)]))
      }

      const className = ['media-figure', 'video-figure']
      if (wide) className.push('wide')

      node.data = {
        ...node.data,
        hName: 'figure',
        hProperties: { className },
        hChildren: children
      }
      return SKIP
    })
  }
}
