// COOP/COEP 가 걸린 실제 브라우저 워커 안에서 툴체인 조각들을 검증한다.
// 결과는 postMessage 로 run.mjs 에 넘긴다.
import '../../src/shims/process.ts'
import { checkRuntimeSupport } from '../../src/mod.ts'

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
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  })
  return 'server OK: ' + Object.keys(s).slice(0, 10).join(',')
})

;(self as unknown as Worker).postMessage(results)
