// 라이브러리 API 만으로 Todo 앱을 돌린다. 이 파일이 곧 사용 예제다.
import '../../src/shims/globals.ts' // ← Vite 를 import 하기 전에 반드시
import { createBrowserRuntime, serveWorker } from '../../src/runtime.ts'
import { TODO_APP } from './todo-app.ts'
import inlinedPackages from 'virtual:inlined-packages'
import vitePkg from 'vite/package.json'
import clientMjs from 'vite/dist/client/client.mjs?raw'
import envMjs from 'vite/dist/client/env.mjs?raw'

// ⚠️ serveWorker 앞에는 **await 가 하나도 없어야 한다.**
// SW 요청은 워커가 뜨자마자 도착할 수 있는데, 리스너가 없으면 조용히 유실되고
// SW 는 30초 뒤 504 를 뱉으며 iframe 이 빈 채로 남는다.
//
// 그래서 async IIFE 로 감싼다 — 이러면 `ready` 가 **즉시** 프라미스로 잡히고
// serveWorker 가 동기적으로 실행된다. (플러그인 import 를 인자 안에서 await 하면
// 그 await 가 먼저 평가되어 serveWorker 가 늦게 걸린다. 실제로 이걸로 당했다.)
const ready = (async () => {
  const react = (await import('@vitejs/plugin-react')).default
  return createBrowserRuntime({
    files: TODO_APP,
    packages: inlinedPackages as Record<string, Record<string, string>>,
    vite: { packageJson: vitePkg as { version: string }, clientMjs, envMjs },
    plugins: [react()],
  })
})()
serveWorker(ready)

const runtime = await ready

// ── 여기부터는 검증용. 실제 사용에는 필요 없다. ──────────────────────────
interface Result { name: string; ok: boolean; detail: string; ms?: number }
const results: Result[] = []
const t = async (name: string, fn: () => unknown): Promise<void> => {
  const t0 = performance.now()
  try {
    const timeout = new Promise((_, rej) =>
      setTimeout(() => rej(new Error('40초 타임아웃')), 40_000))
    const detail = String(await Promise.race([fn(), timeout])).slice(0, 150)
    results.push({ name, ok: true, ms: Math.round(performance.now() - t0), detail })
  } catch (e) {
    const err = e as Error
    results.push({
      name, ok: false, ms: Math.round(performance.now() - t0),
      detail: String(err?.stack || err?.message || e).replace(/\s+/g, ' ').slice(0, 240),
    })
  }
  ;(self as unknown as Worker).postMessage([...results])
}

await t('App.tsx 변환 (TS + JSX)', async () => {
  const r = await runtime.server.transformRequest('/src/App.tsx')
  if (!r) throw new Error('null')
  return `${r.code.length}바이트 | JSX=${/jsx|createElement/i.test(r.code)} 타입제거=${!r.code.includes('interface Todo')}`
})

await t('main.tsx 변환 (react-dom CJS 프리번들)', async () => {
  const r = await runtime.server.transformRequest('/src/main.tsx')
  if (!r) throw new Error('null')
  return r.code.replace(/\s+/g, ' ').slice(0, 120)
})

await t('Tailwind CSS 생성', async () => {
  const r = await runtime.server.transformRequest('/src/style.css')
  if (!r) throw new Error('null')
  const want = ['min-h-screen', 'bg-slate-100', 'rounded-2xl', 'bg-sky-500', 'line-through']
  const missing = want.filter((c) => !r.code.includes(`.${c}`))
  if (missing.length) throw new Error(`누락: ${missing.join(',')}`)
  return `${r.code.length}바이트 | ${want.join(',')}`
})

await t('편집 루프: writeFile → 재변환', async () => {
  runtime.writeFile('src/App.tsx', TODO_APP['src/App.tsx'].replace('브라우저에서 Vite 띄우기', '★편집됨★'))
  const after = await runtime.server.transformRequest('/src/App.tsx')
  runtime.writeFile('src/App.tsx', TODO_APP['src/App.tsx'])
  if (!after?.code.includes('★편집됨★')) throw new Error(`반영 안 됨: ${after?.code.slice(0, 80)}`)
  return '수정이 재변환에 반영됨'
})

await t('편집 루프: 새 Tailwind 클래스 반영', async () => {
  runtime.writeFile('src/App.tsx',
    TODO_APP['src/App.tsx'].replace('"min-h-screen bg-slate-100 p-8"', '"min-h-screen bg-slate-100 p-8 rotate-3 backdrop-blur-md"'))
  const css = await runtime.server.transformRequest('/src/style.css')
  runtime.writeFile('src/App.tsx', TODO_APP['src/App.tsx'])
  const got = ['rotate-3', 'backdrop-blur-md'].filter((c) => css?.code.includes(`.${c}`))
  if (got.length !== 2) throw new Error(`누락: ${['rotate-3','backdrop-blur-md'].filter(c=>!got.includes(c)).join(',')}`)
  return `새 유틸 생성됨: ${got.join(',')}`
})

;(self as unknown as Worker).postMessage(results)
