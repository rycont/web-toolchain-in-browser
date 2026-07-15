import { defineConfig } from 'vite'
import { nodeShimAlias } from '../../src/alias.ts'

export default defineConfig({
  root: import.meta.dirname,
  build: { target: 'esnext', minify: false, outDir: 'dist', emptyOutDir: true },
  worker: { format: 'es' },
  resolve: {
    alias: nodeShimAlias(),
    // @rolldown/browser 등이 exports 맵의 "browser" 조건으로 wasm 엔트리를 준다
    conditions: ['browser', 'import', 'default'],
  },
  define: { 'process.env.NODE_ENV': '"production"' },
})
