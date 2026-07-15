/**
 * 워커 안에서 도는 런타임 — Vite dev server 를 브라우저에 띄우고 파일을 관리한다.
 *
 * 이 모듈은 **dedicated worker 안에서** 쓴다. 페이지 쪽은 `./preview.ts` 를 쓴다.
 *
 * ```ts
 * // my-worker.ts
 * import '@rycont/web-toolchain-in-browser/shims/globals'   // ← 반드시 제일 먼저
 * import { createBrowserRuntime } from '@rycont/web-toolchain-in-browser/runtime'
 * import { serveWorker } from '@rycont/web-toolchain-in-browser/runtime'
 * import inlinedPackages from 'virtual:inlined-packages'
 * import vitePkg from 'vite/package.json'
 * import clientMjs from 'vite/dist/client/client.mjs?raw'
 * import envMjs from 'vite/dist/client/env.mjs?raw'
 *
 * const runtime = await createBrowserRuntime({
 *   files: { 'index.html': '...', 'src/main.tsx': '...' },
 *   packages: inlinedPackages,
 *   vite: { packageJson: vitePkg, clientMjs, envMjs },
 * })
 * serveWorker(runtime)
 * ```
 */
import type { BridgeRequest, BridgeResponse } from './sw-bridge.ts'
import { runMiddlewares } from './sw-bridge.ts'
import { seedPackages, seedProject, seedViteInstall, type ViteInstallSeed } from './seed.ts'
import { tailwindBrowser } from './tailwind.ts'

export interface CreateBrowserRuntimeOptions {
  /** 프로젝트 루트. memfs 상의 경로다. 기본 `/app`. */
  root?: string
  /** 사용자 프로젝트 파일들. 경로(root 기준 상대) → 내용. */
  files: Record<string, string>
  /**
   * 앱이 import 하는 패키지들 (react 등). `inlinePackages()` 로 구운 것을 그대로 넘긴다.
   * 툴체인(Vite/Tailwind)은 워커 번들에 이미 구워져 있으므로 여기 넣지 않는다.
   */
  packages?: Record<string, Record<string, string>>
  /**
   * Vite 자기 설치본. Vite 는 런타임에 자기 package.json 을 fs 로 읽으므로 필요하다.
   * (`vite/dist/node/chunks/node.js` 의 constants.ts 영역이 모듈 최상단에서 읽는다.)
   */
  vite: ViteInstallSeed
  /** Vite 플러그인들. `@vitejs/plugin-react` 등. Tailwind 는 자동으로 붙는다. */
  plugins?: unknown[]
  /** Tailwind 어댑터를 붙일지. 기본 true. */
  tailwind?: boolean
  /** Vite 의 inlineConfig 에 병합할 추가 설정. */
  viteConfig?: Record<string, unknown>
}

/** 워커 안에서 도는 Vite dev server 핸들. */
export interface BrowserRuntime {
  /** 프로젝트 루트 (memfs 경로). */
  readonly root: string
  /** Vite 서버 인스턴스. 탈출구로 열어둔다. */
  readonly server: ViteDevServerLike
  /**
   * 파일을 쓰고 Vite 의 모듈 그래프를 무효화한다.
   * 다음 요청부터 새 내용이 나온다 (실측 약 200ms).
   */
  writeFile(relPath: string, content: string): void
  /** 여러 파일을 한 번에. */
  writeFiles(files: Record<string, string>): void
  /** SW 에서 온 요청을 Vite 미들웨어로 처리한다. */
  handleRequest(req: BridgeRequest): Promise<BridgeResponse>
  /** 서버를 닫는다. */
  close(): Promise<void>
}

/** Vite 의 `createServer()` 반환값 중 우리가 쓰는 부분. */
interface ViteDevServerLike {
  middlewares: unknown
  environments: {
    client: {
      moduleGraph: {
        getModuleById(id: string): unknown
        invalidateModule(mod: unknown): void
      }
    }
  }
  transformRequest(url: string): Promise<{ code: string } | null>
  close(): Promise<void>
}

const norm = (p: string): string => p.replace(/\/+/g, '/')

/**
 * 브라우저 워커 안에 Vite dev server 를 띄운다.
 *
 * ⚠️ 이 함수를 부르기 전에 `shims/globals` 를 import 해야 한다. Vite 의 dist 가
 * 모듈 최상단에서 `process` 와 `Buffer` 를 건드리기 때문이다.
 *
 * ⚠️ **워커당 하나만 만들 것.** 두 개면 rolldown wasm 인스턴스가 둘이 된다.
 */
export async function createBrowserRuntime(
  options: CreateBrowserRuntimeOptions,
): Promise<BrowserRuntime> {
  const root = options.root ?? '/app'

  // ⚠️ 순서가 중요하다 — Vite 를 import 하기 **전에** memfs 를 채워야 한다.
  // vite/dist/node/chunks/node.js 의 src/node/constants.ts 영역이 모듈 최상단에서
  // readFileSync 로 자기 package.json 을 읽는다.
  seedViteInstall(options.vite)
  seedProject(root, options.files)
  if (options.packages) seedPackages(root, options.packages)

  const { createServer } = await import('vite')

  const plugins = [...(options.plugins ?? [])]
  if (options.tailwind !== false) plugins.push(tailwindBrowser({ root }))

  const server = (await createServer({
    configFile: false,
    logLevel: 'silent',
    root,
    plugins,
    // 브라우저엔 포트가 없다. middlewareMode 로 켜면 Vite 가 http 서버를 만들지
    // 않고 connect 미들웨어 스택만 남긴다 — 그건 그냥 (req, res, next) 함수다.
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    ...options.viteConfig,
  } as never)) as unknown as ViteDevServerLike

  const invalidate = (fullPath: string): void => {
    const g = server.environments.client.moduleGraph
    const mod = g.getModuleById(fullPath)
    if (mod) g.invalidateModule(mod)
  }

  const writeFile = (relPath: string, content: string): void => {
    const full = norm(`${root}/${relPath}`)
    seedProject(root, { [relPath]: content })
    invalidate(full)
    // CSS 진입점도 무효화한다 — 소스가 바뀌면 Tailwind 후보 집합이 달라진다.
    // (이게 없으면 새로 등장한 유틸이 CSS 에 안 나온다.)
    for (const p of Object.keys(options.files)) {
      if (p.endsWith('.css')) invalidate(norm(`${root}/${p}`))
    }
  }

  return {
    root,
    server,
    writeFile,
    writeFiles(files) {
      for (const [p, c] of Object.entries(files)) writeFile(p, c)
    },
    handleRequest(req) {
      return runMiddlewares(
        server.middlewares as Parameters<typeof runMiddlewares>[0],
        req,
      )
    },
    close: () => server.close(),
  }
}

/**
 * 워커의 메시지 핸들러를 건다. 페이지(`./preview.ts`)가 SW 로부터 받은 요청을
 * 여기로 넘긴다.
 *
 * ⚠️ **이 함수는 워커 스크립트의 톱레벨 await 보다 먼저 불려야 한다.**
 * 리스너를 늦게 걸면 그 사이 도착한 메시지가 유실되고 (핸들러가 없으므로)
 * SW 는 응답을 영영 못 받아 iframe 이 빈 채로 남는다. 그래서 이 함수는
 * **런타임이 준비되기 전에** 부를 수 있도록 Promise 를 받는다.
 *
 * ```ts
 * const ready = createBrowserRuntime({...})   // await 하지 않는다
 * serveWorker(ready)                          // 리스너를 먼저 건다
 * const runtime = await ready
 * ```
 */
export function serveWorker(runtime: BrowserRuntime | Promise<BrowserRuntime>): void {
  const ready = Promise.resolve(runtime)
  self.addEventListener('message', (e: MessageEvent) => {
    const data = e.data as { type?: string; request?: BridgeRequest }
    if (data?.type !== 'vite-request' || !data.request) return
    const port = e.ports[0]
    if (!port) return
    void ready.then(
      async (rt) => port.postMessage(await rt.handleRequest(data.request!)),
      (err) =>
        port.postMessage({
          id: data.request!.id,
          status: 500,
          headers: {},
          body: `런타임 초기화 실패: ${String((err as Error)?.stack ?? err)}`,
        } satisfies BridgeResponse),
    )
  })
}
