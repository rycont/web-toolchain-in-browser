// COOP/COEP 가 걸린 실제 브라우저 워커 안에서 툴체인 조각들을 검증한다.
// 결과는 postMessage 로 run.mjs 에 넘긴다.
import '../../src/shims/globals.ts'
import { checkRuntimeSupport } from '../../src/mod.ts'
import { seedProject, seedViteInstall } from '../../src/seed.ts'
import vitePkg from 'vite/package.json'
import clientMjs from 'vite/dist/client/client.mjs?raw'
import envMjs from 'vite/dist/client/env.mjs?raw'

// Vite 를 import 하기 **전에** memfs 를 채워야 한다.
// vite/dist/node/chunks/node.js 의 src/node/constants.ts 영역이 모듈 최상단에서
// readFileSync 로 자기 package.json 을 읽기 때문이다.
seedViteInstall({
  packageJson: vitePkg as { version: string },
  clientMjs,
  envMjs,
})
seedProject('/app', {
  'index.html': '<!doctype html><div id="root"></div><script type="module" src="/src/main.tsx"></script>',
  'src/main.tsx': 'export const hello: string = "world"\n',
})

interface Result {
  name: string
  ok: boolean
  detail: string
}

const results: Result[] = []

const t = async (name: string, fn: () => unknown): Promise<void> => {
  try {
    results.push({ name, ok: true, detail: String(await fn()).slice(0, 120) })
  } catch (e) {
    const err = e as Error
    results.push({
      name,
      ok: false,
      detail: String(err?.stack || err?.message || e).replace(/\s+/g, ' ').slice(0, 220),
    })
  }
}

await t('런타임 지원 (COOP/COEP, SAB, 중첩 Worker, shared wasm memory)', () => {
  const s = checkRuntimeSupport()
  if (!s.ok) throw new Error(JSON.stringify(s))
  return JSON.stringify(s)
})

await t('lightningcss-wasm: init + transform', async () => {
  const m = await import('lightningcss-wasm')
  await m.default()
  const r = m.transform({
    filename: 'a.css',
    code: new TextEncoder().encode('.a{color:#ff0000;}.b{color:red}'),
    minify: true,
  })
  return new TextDecoder().decode(r.code)
})

await t('@rolldown/browser: 가상 모듈 번들', async () => {
  const { rolldown } = await import('@rolldown/browser')
  const b = await rolldown({
    input: 'v:entry',
    plugins: [{
      name: 'v',
      resolveId: (id: string) => (id.startsWith('v:') ? id : null),
      load: (id: string) =>
        id === 'v:entry'
          ? `import {x} from 'v:dep'\nexport default x*2`
          : id === 'v:dep'
          ? `export const x=21`
          : null,
    }],
  })
  const o = await b.generate({ format: 'esm' })
  return o.output[0].code.replace(/\s+/g, ' ').slice(0, 70)
})

await t('@tailwindcss/oxide-wasm32-wasi: 로드', async () => {
  const m = await import('@tailwindcss/oxide-wasm32-wasi')
  return 'exports: ' + Object.keys(m).slice(0, 8).join(',')
})

// 본편 — 아직 실패한다
await t('vite: createServer({ middlewareMode })', async () => {
  const { createServer } = await import('vite')
  const s = await createServer({
    configFile: false,
    logLevel: 'silent',
    root: '/app',
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  })
  return 'server OK: ' + Object.keys(s).slice(0, 10).join(',')
})

;(self as unknown as Worker).postMessage(results)
