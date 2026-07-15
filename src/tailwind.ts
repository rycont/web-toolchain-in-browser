/**
 * 브라우저 워커용 Tailwind v4 통합.
 *
 * ## 두 가지 제약이 이 설계를 강제한다
 *
 * ### 1. `Scanner.scan()` 은 브라우저에서 구조적으로 불가능하다
 *
 * fs 를 걷느라 rayon 스레드를 띄우는데, napi-rs 의 wasi-browser 템플릿 구조상
 * 두 컨텍스트 모두 막힌다:
 *
 *   - 메인 스레드: `RuntimeError: Atomics.wait cannot be called in this context`
 *   - 워커: **데드락**. 부모가
 *       `worker.addEventListener('message', __wasmCreateOnMessageForFsProxy(__fs))`
 *     로 "내 이벤트루프로 자식의 fs 요청에 답하겠다" 고 등록해놓고 곧바로
 *     `Atomics.wait()` 으로 그 이벤트루프를 멈춘다.
 *
 *   → 그래서 **fs 걷기는 우리가 JS 로** 하고(memfs 는 동기라 공짜다),
 *     wasm 에는 `scanFiles(contents)` 로 내용만 넘긴다.
 *
 * ### 2. rolldown 과 oxide 는 한 realm 에 공존할 수 없다
 *
 * 둘 다 `__emnapiGetDefaultContext()` 로 같은 emnapi 전역 컨텍스트에 등록하고
 * 각자 1 GiB / asyncWorkPoolSize:4 를 잡는다. 실측:
 *
 *     oxide 단독 (Vite 없음)     → ✅ 동작
 *     oxide + rolldown 같은 워커  → ❌ 멈춤
 *
 *   → 그래서 **Tailwind 를 별도 워커로 분리**한다 (`./tailwind-worker.ts`).
 *     realm 이 갈리면 emnapi 컨텍스트도 갈린다. Vite 의 transform 훅은 async 라
 *     postMessage 왕복이 자연스럽게 들어간다.
 *
 * 결과적으로 `@tailwindcss/vite` 와 `@tailwindcss/node` 를 둘 다 대체한다.
 * (후자는 버그라서가 아니라 **Node 어댑터**라서 — `registerHooks` 같은 Node ESM
 * 로더 훅을 쓰는데 브라우저엔 대응물이 없다. Tailwind 의 순수 JS 코어인
 * `compile(css, { loadStylesheet, loadModule })` 이 곧 호스트를 꽂는 자리이고,
 * 우리는 거기에 memfs 를 꽂는다.)
 */
import { fs } from 'memfs'
import type { ScanInput, TailwindRequest, TailwindResponse } from './tailwind-worker.ts'

const f = fs as unknown as {
  existsSync(p: string): boolean
  readFileSync(p: string, e: string): string
  readdirSync(p: string, o?: unknown): Array<{ name: string; isDirectory(): boolean }>
  statSync(p: string): { isDirectory(): boolean }
}

const dirname = (p: string): string => p.slice(0, p.lastIndexOf('/')) || '/'
const norm = (p: string): string => p.replace(/\/+/g, '/')

/** Tailwind 가 후보를 주울 수 있는 확장자들. */
const SCANNABLE = /\.(html?|jsx?|tsx?|mjs|cjs|vue|svelte|astro|md|mdx)$/

/** 걷지 않을 디렉터리. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.vite'])

/** 프로젝트를 JS 로 걷는다 — wasm 의 fs 걷기(=데드락)를 피하는 핵심. */
function collectProjectFiles(root: string): ScanInput[] {
  const out: ScanInput[] = []
  const walk = (dir: string): void => {
    let entries: Array<{ name: string; isDirectory(): boolean }>
    try {
      entries = f.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = norm(`${dir}/${e.name}`)
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(full)
        continue
      }
      if (!SCANNABLE.test(e.name)) continue
      try {
        out.push({
          content: f.readFileSync(full, 'utf8'),
          extension: e.name.slice(e.name.lastIndexOf('.') + 1),
        })
      } catch {
        /* 읽기 실패는 무시 */
      }
    }
  }
  walk(root)
  return out
}

function resolveStylesheet(
  id: string,
  base: string,
): { path: string; base: string; content: string } | undefined {
  const candidates: string[] = []
  if (id.startsWith('.') || id.startsWith('/')) {
    candidates.push(id.startsWith('/') ? id : `${base}/${id}`)
  } else {
    let dir = base
    for (let i = 0; i < 20; i++) {
      candidates.push(`${dir}/node_modules/${id}`)
      candidates.push(`${dir}/node_modules/${id}/index.css`)
      candidates.push(`${dir}/node_modules/${id}.css`)
      if (dir === '/' || dir === '') break
      dir = dirname(dir)
    }
  }
  for (const raw of candidates) {
    const p = norm(raw)
    try {
      if (f.existsSync(p) && !f.statSync(p).isDirectory()) {
        return { path: p, base: dirname(p), content: f.readFileSync(p, 'utf8') }
      }
    } catch {
      /* 다음 후보 */
    }
  }
  return undefined
}

/**
 * `@import` 를 재귀적으로 미리 해석해서 Tailwind 워커에 통째로 넘긴다.
 * 워커에는 memfs 가 없으므로 (realm 이 다르다) 필요한 내용을 다 실어보내야 한다.
 */
function collectStylesheets(
  css: string,
  base: string,
): Record<string, { path: string; base: string; content: string }> {
  const out: Record<string, { path: string; base: string; content: string }> = {}
  const seen = new Set<string>()

  const visit = (source: string, from: string): void => {
    const re = /@import\s+["']([^"']+)["']/g
    let m: RegExpExecArray | null
    while ((m = re.exec(source)) !== null) {
      const id = m[1].replace(/\s+(layer|source|theme)\(.*$/, '').trim()
      const key = `${from} ${id}`
      if (seen.has(key)) continue
      seen.add(key)
      const hit = resolveStylesheet(id, from)
      if (!hit) continue
      out[key] = hit
      out[id] ??= hit
      visit(hit.content, hit.base)
    }
  }
  visit(css, base)
  return out
}

export interface TailwindBrowserOptions {
  /** 후보를 스캔할 프로젝트 루트. Vite 의 root 와 같게 둔다. */
  root: string
  /**
   * Tailwind 워커를 만드는 함수. 번들러가 워커 엔트리를 알아야 하므로
   * 호출부에서 넘긴다:
   *
   * ```ts
   * tailwindBrowser({
   *   root: '/app',
   *   createWorker: () => new Worker(
   *     new URL('@rycont/browser-webapp-runtime/tailwind-worker', import.meta.url),
   *     { type: 'module' },
   *   ),
   * })
   * ```
   */
  createWorker: () => Worker
}

/** Vite 플러그인 최소 형태. vite 를 타입 의존성으로 끌어오지 않기 위해 직접 정의한다. */
export interface TailwindBrowserPlugin {
  name: string
  transform(code: string, id: string): Promise<{ code: string; map: null } | undefined>
}

/**
 * Tailwind v4 를 브라우저 워커 안 Vite 에 물린다. `@tailwindcss/vite` 대신 쓴다.
 * Tailwind 자체는 별도 워커에서 돈다 (위 주석의 emnapi 컨텍스트 충돌 참고).
 */
export function tailwindBrowser(options: TailwindBrowserOptions): TailwindBrowserPlugin {
  const { root, createWorker } = options

  let worker: Worker | undefined
  let seq = 0
  const pending = new Map<number, (r: TailwindResponse) => void>()

  const ensureWorker = (): Worker => {
    if (worker) return worker
    worker = createWorker()
    worker.onmessage = (e: MessageEvent<TailwindResponse>) => {
      pending.get(e.data.id)?.(e.data)
      pending.delete(e.data.id)
    }
    // ⚠️ 반드시 필요하다 — 워커가 로드에 실패하면 응답이 영영 안 오고
    // await 이 조용히 영원히 멈춘다 (타임아웃도 없이). 대기 중인 요청을 전부 깨운다.
    worker.onerror = (e: ErrorEvent) => {
      const msg = `Tailwind 워커 로드/실행 실패: ${e.message} @ ${e.filename}:${e.lineno}`
      for (const [id, resolve] of pending) resolve({ id, error: msg })
      pending.clear()
    }
    worker.onmessageerror = () => {
      for (const [id, resolve] of pending) resolve({ id, error: 'Tailwind 워커: 메시지 직렬화 실패' })
      pending.clear()
    }
    return worker
  }

  return {
    name: 'browser-webapp-runtime:tailwind',
    async transform(code: string, id: string) {
      const path = id.split('?')[0]
      if (!path.endsWith('.css')) return undefined
      if (!/@import\s+["']tailwindcss|@tailwind\s|@reference\s/.test(code)) return undefined

      const base = dirname(path)
      const req: TailwindRequest = {
        id: ++seq,
        css: code,
        base,
        from: path,
        // fs 접근은 전부 여기(메인 워커)서 끝낸다. Tailwind 워커는 fs 를 모른다.
        files: collectProjectFiles(root),
        stylesheets: collectStylesheets(code, base),
      }

      const res = await new Promise<TailwindResponse>((resolve) => {
        pending.set(req.id, resolve)
        ensureWorker().postMessage(req)
      })

      if (res.error) throw new Error(res.error)
      return { code: res.css ?? '', map: null }
    },
  }
}
