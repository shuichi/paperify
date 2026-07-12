// Injected by esbuild.mjs: substitutes `import.meta.url` in the CommonJS
// bundle with the bundled file's own file:// URL, so runtime helpers such as
// `createRequire(import.meta.url)` resolve relative to dist/extension.js.
import { pathToFileURL } from 'node:url'

export const __paperify_import_meta_url = pathToFileURL(__filename).href
