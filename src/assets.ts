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
import { fileURLToPath, pathToFileURL } from 'node:url'
import { visit } from 'unist-util-visit'
import type { Root, Element } from 'hast'

/** True when the reference points at a local file (not a URL/data/anchor). */
export function isLocalAsset(ref: string): boolean {
  const value = ref.replace(/[\t\n\r]/g, '').trim()
  return value !== '' && !/^[#?/\\]|^[a-z][a-z0-9+.-]*:/i.test(value)
}

/** Resolve a document-relative URL, retaining the suffix for rewritten media. */
export function resolveLocalAsset(ref: string, inputDir: string) {
  if (!isLocalAsset(ref)) return undefined
  try {
    const base = pathToFileURL(path.resolve(inputDir) + path.sep)
    const url = new URL(ref, base)
    // A literal percent sign is valid in a filename such as "50%.svg".
    url.pathname = url.pathname.replace(/%(?![\da-f]{2})/gi, '%25')
    const filePath = fileURLToPath(url)
    if (filePath.includes('\0')) return undefined
    return { filePath, search: url.search, hash: url.hash }
  } catch {
    return undefined
  }
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

function outsideDirectory(relativePath: string): boolean {
  return relativePath === '..' ||
    relativePath.startsWith('..' + path.sep) ||
    path.isAbsolute(relativePath)
}

function canWriteDestination(root: string, destination: string): boolean {
  // Resolve the closest existing ancestor before creating any subdirectories.
  // A dangling link has no verifiable target.
  let ancestor = destination
  while (!fs.lstatSync(ancestor, { throwIfNoEntry: false })) {
    ancestor = path.dirname(ancestor)
  }
  try {
    return !outsideDirectory(path.relative(root, fs.realpathSync(ancestor)))
  } catch {
    return false
  }
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
    const resolved = resolveLocalAsset(asset, inputDir)
    const sourceStat = resolved && fs.statSync(resolved.filePath, { throwIfNoEntry: false })
    if (!resolved || !sourceStat?.isFile()) {
      missing.push(asset)
      continue
    }
    const relativePath = path.relative(inputDir, resolved.filePath)
    if (outsideDirectory(relativePath)) {
      missing.push(asset)
      continue
    }
    fs.mkdirSync(outputDir, { recursive: true })
    const root = fs.realpathSync(outputDir)
    const to = path.join(root, relativePath)
    if (!canWriteDestination(root, to)) {
      missing.push(asset)
      continue
    }
    const targetStat = fs.statSync(to, { throwIfNoEntry: false })
    if (targetStat?.dev === sourceStat.dev && targetStat.ino === sourceStat.ino) {
      copied.push(asset)
      continue
    }
    if (targetStat && (!targetStat.isFile() || targetStat.nlink > 1)) {
      // Writing a hard-linked file could overwrite another directory's copy.
      missing.push(asset)
      continue
    }
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(resolved.filePath, to)
    copied.push(asset)
  }

  return { copied, missing }
}
