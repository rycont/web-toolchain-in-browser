import { defineConfig } from 'vite'
import { nodeShimAlias, nodeShimDefine } from '../../src/alias.ts'

export default defineConfig({
  root: import.meta.dirname,
  build: { target: 'esnext', minify: false, outDir: 'dist', emptyOutDir: true, rolldownOptions: { input: { index: 'index.html', probe: 'probe.html' } } },
  worker: { format: 'es' },
  resolve: {
    alias: nodeShimAlias(),
    // @rolldown/browser 등이 exports 맵의 "browser" 조건으로 wasm 엔트리를 준다
    conditions: ['browser', 'import', 'default'],
  },
  define: nodeShimDefine(),
})
