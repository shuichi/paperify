/**
 * assets.ts
 *
 * Collects local media references (img/video/source src, video poster)
 * from the HTML tree during conversion, and copies them next to the
 * output file when --copy-assets is enabled. Relative paths are
 * preserved so the generated HTML keeps working without edits.
 */

import fs from 'node:fs'
import path from 'node:path'
import { visit } from 'unist-util-visit'
import type { Root, Element } from 'hast'

/** True when the reference points at a local file (not a URL/data/anchor). */
export function isLocalAsset(ref: string): boolean {
  if (!ref) return false
  if (ref.startsWith('#')) return false
  if (ref.startsWith('//')) return false
  if (ref.startsWith('data:')) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) return false
  if (path.isAbsolute(ref)) return false
  return true
}

/**
 * rehype plugin that appends every local asset reference it finds to
 * `options.assets` (deduplicated).
 */
export function collectAssets(options: { assets: string[] }) {
  const seen = new Set(options.assets)
  const add = (ref: unknown) => {
    if (typeof ref !== 'string') return
    if (!isLocalAsset(ref)) return
    if (seen.has(ref)) return
    seen.add(ref)
    options.assets.push(ref)
  }
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName === 'img' || node.tagName === 'source') {
        add(node.properties?.src)
      }
      if (node.tagName === 'video') {
        add(node.properties?.src)
        add(node.properties?.poster)
      }
    })
  }
}

export interface CopyAssetsResult {
  copied: string[]
  missing: string[]
}

/**
 * Copy collected assets from the input document's directory into the
 * output directory, preserving relative paths. Missing files are
 * reported rather than treated as fatal (a video may live on a CDN
 * during authoring, for example).
 */
export function copyAssets(
  assets: string[],
  inputDir: string,
  outputDir: string
): CopyAssetsResult {
  const copied: string[] = []
  const missing: string[] = []

  for (const asset of assets) {
    const normalized = path.normalize(asset)
    if (normalized.startsWith('..')) {
      // Refuse to write outside the output directory.
      missing.push(asset)
      continue
    }
    const from = path.resolve(inputDir, normalized)
    const to = path.resolve(outputDir, normalized)
    if (!fs.existsSync(from)) {
      missing.push(asset)
      continue
    }
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(from, to)
    copied.push(asset)
  }

  return { copied, missing }
}
