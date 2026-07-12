/**
 * esbuild.mjs
 *
 * Bundles the extension into a single CommonJS file for the VS Code
 * extension host. The Paperify pipeline (paperify/api) is compiled into the
 * bundle, so the extension has no runtime dependency on the parent package.
 *
 * Two things are resolved at runtime instead of being bundled:
 *
 * - `katex/dist/katex.min.css` and its fonts: `compileHtml()` locates them
 *   with `createRequire`, so `katex` stays a production dependency that vsce
 *   packages into the VSIX under `node_modules/katex`.
 * - The citation stack (citation-js, citeproc): `convert()` only imports it
 *   when a bibliography is supplied, which the preview never does.
 *
 * Paperify source uses `import.meta.url`; the inject/define pair below maps
 * it onto the bundled file's own URL so `createRequire` keeps working in the
 * CommonJS output.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import esbuild from 'esbuild'

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

// Ship the Paperify stylesheet inside the extension so it resolves from the
// packaged VSIX, where the parent package is not installed.
const cssSource = require.resolve('paperify/styles/paperify.css')
const assetsDir = path.join(here, 'assets')
fs.mkdirSync(assetsDir, { recursive: true })
fs.copyFileSync(cssSource, path.join(assetsDir, 'paperify.css'))

await esbuild.build({
  entryPoints: [path.join(here, 'src', 'extension.ts')],
  outfile: path.join(here, 'dist', 'extension.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  minify: true,
  sourcemap: false,
  logLevel: 'info',
  define: { 'import.meta.url': '__paperify_import_meta_url' },
  inject: [path.join(here, 'scripts', 'import-meta-url.js')]
})
