// COOP/COEP 가 걸린 실제 브라우저 워커 안에서 툴체인 조각들을 검증한다.
// 결과는 postMessage 로 run.mjs 에 넘긴다.
import '../../src/shims/globals.ts'
import { checkRuntimeSupport } from '../../src/mod.ts'
import { seedNodeModule, seedProject, seedViteInstall } from '../../src/seed.ts'
import vitePkg from 'vite/package.json'
import clientMjs from 'vite/dist/client/client.mjs?raw'
import envMjs from 'vite/dist/client/env.mjs?raw'
// Tailwind v4 의 CSS 진입점들. 툴체인(플러그인)은 번들되지만 이 CSS 들은
// 프로젝트의 node_modules 에서 해석되므로 memfs 에 실물로 심어야 한다.
import twIndexCss from 'tailwindcss/index.css?raw'
import twPreflightCss from 'tailwindcss/preflight.css?raw'
import twThemeCss from 'tailwindcss/theme.css?raw'
import twUtilitiesCss from 'tailwindcss/utilities.css?raw'

// Vite 를 import 하기 **전에** memfs 를 채워야 한다.
// vite/dist/node/chunks/node.js 의 src/node/constants.ts 영역이 모듈 최상단에서
// readFileSync 로 자기 package.json 을 읽기 때문이다.
seedViteInstall({
  packageJson: vitePkg as { version: string },
  clientMjs,
  envMjs,
})
seedProject('/app', {
  'index.html':
    '<!doctype html><div id="root"></div><script type="module" src="/src/main.tsx"></script>',
  'src/main.tsx': 'export const hello: string = "world"\n',
  // Tailwind v4 는 CSS 가 진입점이다. @import 하나로 엔진이 켜진다.
  'src/style.css': '@import "tailwindcss";\n',
  'src/plain.css': '.hello { color: red }\n',
  // oxide 스캐너가 여기서 클래스를 주워야 한다
  'src/App.tsx':
    'export default () => <div className="flex items-center rounded-lg bg-sky-500 p-4 text-white">hi</div>\n',
  'package.json': JSON.stringify({ name: 'app', type: 'module' }),
})

// @import "tailwindcss" 가 프로젝트 node_modules 에서 해석된다
seedNodeModule('/app', 'tailwindcss', {
  'package.json': JSON.stringify({
    name: 'tailwindcss',
    version: '4.3.2',
    style: './index.css',
    exports: {
      '.': { style: './index.css' },
      './index.css': './index.css',
      './preflight.css': './preflight.css',
      './theme.css': './theme.css',
      './utilities.css': './utilities.css',
    },
  }),
  'index.css': twIndexCss,
  'preflight.css': twPreflightCss,
  'theme.css': twThemeCss,
  'utilities.css': twUtilitiesCss,
})

interface Result {
  name: string
  ok: boolean
  detail: string
}

const results: Result[] = []

const t = async (name: string, fn: () => unknown): Promise<void> => {
  try {
    // 개별 타임박스 — 하나가 멈춰도 나머지 결과는 받는다
    const timeout = new Promise((_, rej) =>
      setTimeout(() => rej(new Error('120초 타임아웃 — 여기서 멈춤')), 120_000))
    results.push({ name, ok: true, detail: String(await Promise.race([fn(), timeout])).slice(0, 120) })
    ;(self as unknown as Worker).postMessage([...results, { name: `>>> 다음: ?`, ok: true, detail: '진행중' }])
  } catch (e) {
    const err = e as Error
    results.push({
      name,
      ok: false,
      detail: String(err?.stack || err?.message || e).replace(/\s+/g, ' ').slice(0, 220),
    })
    ;(self as unknown as Worker).postMessage([...results])
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

await t('memfs 에 프로젝트가 실제로 있나', async () => {
  const { fs } = await import('memfs')
  const f = fs as unknown as {
    existsSync(p: string): boolean
    readdirSync(p: string): string[]
    readFileSync(p: string, e: string): string
  }
  return [
    `/app 존재=${f.existsSync('/app')}`,
    `/app/src/main.tsx 존재=${f.existsSync('/app/src/main.tsx')}`,
    `루트=${JSON.stringify(f.readdirSync('/'))}`,
    `내용=${JSON.stringify(f.readFileSync('/app/src/main.tsx', 'utf8'))}`,
  ].join(' | ')
})

let server: Awaited<ReturnType<typeof import('vite').createServer>> | undefined

await t('vite: createServer({ middlewareMode }) + tailwind 플러그인', async () => {
  const { createServer } = await import('vite')
  const { tailwindBrowser } = await import('../../src/tailwind.ts')
  // ⚠️ 서버는 워커당 **하나만** 만든다. 두 개를 만들면 rolldown wasm 인스턴스와
  // wasi 스레드 풀이 둘이 되어 서로를 막는다(데드락).
  server = await createServer({
    configFile: false,
    logLevel: 'silent',
    root: '/app',
    plugins: [tailwindBrowser({ root: '/app' })],
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  })
  return 'server OK: ' + Object.keys(server).slice(0, 10).join(',')
})

await t('vite: pluginContainer.resolveId 가 root 를 붙이나', async () => {
  if (!server) throw new Error('server 없음')
  const env = server.environments.client
  const a = await env.pluginContainer.resolveId('/src/main.tsx', undefined)
  const b = await env.pluginContainer.resolveId('./src/main.tsx', '/app/index.html')
  return `'/src/main.tsx'→${JSON.stringify(a?.id)} | './src/main.tsx'→${JSON.stringify(b?.id)}`
})

await t('vite: .tsx 를 transformRequest 로 변환', async () => {
  if (!server) throw new Error('server 없음')
  const r = await server.transformRequest('/src/main.tsx')
  if (!r) throw new Error('transformRequest 가 null 반환')
  return r.code.replace(/\s+/g, ' ').slice(0, 110)
})

// 먼저: Tailwind 없이 순수 CSS 를 Vite 로 통과시켜본다.
// 이게 멈추면 문제는 Vite 의 CSS 파이프라인이지 Tailwind 가 아니다.
await t('vite: 플레인 CSS 를 transformRequest (Tailwind 없이)', async () => {
  if (!server) throw new Error('server 없음')
  const r = await server.transformRequest('/src/plain.css')
  if (!r) throw new Error('null')
  return r.code.replace(/\s+/g, ' ').slice(0, 90)
})

// @tailwindcss/vite 는 scan() 이 데드락이라 못 쓴다 (src/tailwind.ts 주석 참고).
// 우리 통합으로 대체한다.
await t('tailwind: 브라우저 워커에서 CSS 생성 (자체 통합)', async () => {
  if (!server) throw new Error('server 없음')
  const r = await server.transformRequest('/src/style.css')
  if (!r) throw new Error('CSS transformRequest 가 null')
  const css = r.code
  const found = ['flex', 'items-center', 'rounded-lg', 'bg-sky-500', 'p-4', 'text-white']
    .filter((c) => css.includes(`.${c}`))
  return `${css.length}바이트 | 생성된 유틸: ${found.join(',') || '(없음!)'}`
})

;(self as unknown as Worker).postMessage(results)
