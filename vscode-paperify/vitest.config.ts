import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const here = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      // The real `vscode` module only exists inside the extension host.
      vscode: path.resolve(here, 'test', 'mocks', 'vscode.ts')
    }
  },
  test: {
    include: ['test/**/*.test.ts']
  }
})
