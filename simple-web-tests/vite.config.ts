import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: [
      // More specific paths first
      { find: '@bsv/simple/browser', replacement: path.resolve(__dirname, '../src/browser.ts') },
      { find: '@bsv/simple', replacement: path.resolve(__dirname, '../src/index.ts') }
    ]
  },
  server: {
    port: 3333,
    open: true
  }
})
