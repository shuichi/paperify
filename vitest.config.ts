import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Only the core suite; vscode-paperify/ runs its own vitest project
    // with a mocked `vscode` module.
    include: ['test/**/*.test.ts']
  }
})
