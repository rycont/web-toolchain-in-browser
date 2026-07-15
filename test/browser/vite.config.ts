import { defineConfig } from 'vite'
import { nodeShimAlias, nodeShimDefine } from '../../src/alias.ts'
import { inlinePackages } from '../../src/inline-packages-plugin.ts'

/** 사용자 앱(Todo)이 import 하는 것들. memfs 의 node_modules 에 심긴다. */
const APP_TREE = ['react', 'react-dom', 'scheduler', 'tailwindcss']

export default defineConfig({
  root: import.meta.dirname,
  plugins: [inlinePackages(APP_TREE, import.meta.url)],
  // 사용자 앱이 import 할 것들 = 앱 트리. memfs 에 실재해야 하므로 번들에 인라인해둔다.
  build: { target: 'esnext', minify: false, outDir: 'dist', emptyOutDir: true, rolldownOptions: { input: { index: 'index.html', sw: 'sw.js' }, output: { entryFileNames: (c) => c.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js' } } },
  // ⚠️ 워커 번들은 **플러그인 파이프라인이 별도다.** 여기에도 안 넣으면
  // worker.ts 의 `import 'virtual:inlined-packages'` 가 해석되지 않는다.
  worker: {
    format: 'es',
    plugins: () => [inlinePackages(APP_TREE, import.meta.url)],
  },
  resolve: {
    alias: nodeShimAlias(),
    // @rolldown/browser 등이 exports 맵의 "browser" 조건으로 wasm 엔트리를 준다
    conditions: ['browser', 'import', 'default'],
  },
  define: nodeShimDefine(),
})
