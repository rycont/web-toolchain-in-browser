/**
 * 브라우저 워커용 Tailwind v4 통합.
 *
 * ## 왜 @tailwindcss/vite 를 못 쓰나
 *
 * `@tailwindcss/oxide-wasm32-wasi` 의 `Scanner.scan()` 은 **브라우저에서 절대 못 쓴다.**
 * fs 를 걷느라 rayon 스레드를 띄우는데, napi-rs 의 wasi-browser 템플릿 구조상
 * 두 컨텍스트 모두 막힌다:
 *
 *   - 메인 스레드: `RuntimeError: Atomics.wait cannot be called in this context`
 *     (브라우저가 메인 스레드 블로킹을 금지한다)
 *
 *   - 워커: **데드락**. 부모가 자식 워커를 띄우면서
 *         `worker.addEventListener('message', __wasmCreateOnMessageForFsProxy(__fs))`
 *     로 "내 이벤트루프로 자식의 fs 요청에 답하겠다" 고 등록해놓고,
 *     곧바로 `Atomics.wait()` 으로 자기 이벤트루프를 멈춘다. 자식은 fs 를
 *     요청하고 부모는 영원히 답하지 못한다.
 *
 *   요구사항이 상호배타적이라 설정으로 풀 수 있는 문제가 아니다.
 *
 * ## 우회
 *
 * 데드락은 **fs 를 걷는 `scan()` 에만** 있다. `scanFiles(contents)` 는 내용을
 * 직접 받으므로 fs 도 스레드도 건드리지 않고 잘 돈다. 그래서:
 *
 *   1. 프로젝트 파일 걷기 → **우리가 JS 로** (memfs 는 동기라 공짜다)
 *   2. 후보 추출 → `scanner.scanFiles(contents)`  (wasm, 단일 스레드, 안전)
 *   3. CSS 생성 → `compile(css).build(candidates)`  (순수 JS)
 *
 * @tailwindcss/vite 와 @tailwindcss/node 를 통째로 건너뛴다.
 */
import { fs } from 'memfs'
import { compile } from 'tailwindcss'
import { Scanner } from '@tailwindcss/oxide'

const f = fs as unknown as {
  existsSync(p: string): boolean
  readFileSync(p: string, e: string): string
  readdirSync(p: string, o?: unknown): Array<{ name: string; isDirectory(): boolean }>
  statSync(p: string): { isDirectory(): boolean }
}

const dirname = (p: string): string => p.slice(0, p.lastIndexOf('/')) || '/'

/** Tailwind 가 후보를 주울 수 있는 확장자들. */
const SCANNABLE = /\.(html?|jsx?|tsx?|mjs|cjs|vue|svelte|astro|md|mdx)$/

/** 걷지 않을 디렉터리. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.vite'])

interface ScanInput {
  content: string
  extension: string
}

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
      const full = `${dir}/${e.name}`.replace(/\/+/g, '/')
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

/** memfs 에서 `@import "..."` 를 해석한다. Tailwind 의 loadStylesheet 훅용. */
async function loadStylesheetFromMemfs(
  id: string,
  base: string,
): Promise<{ path: string; base: string; content: string }> {
  const candidates: string[] = []
  if (id.startsWith('.') || id.startsWith('/')) {
    candidates.push(id.startsWith('/') ? id : `${base}/${id}`)
  } else {
    // bare specifier — 프로젝트 node_modules 를 위로 훑는다
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
    const p = raw.replace(/\/+/g, '/')
    try {
      if (f.existsSync(p) && !f.statSync(p).isDirectory()) {
        return { path: p, base: dirname(p), content: f.readFileSync(p, 'utf8') }
      }
    } catch {
      /* 다음 후보 */
    }
  }
  throw new Error(`Tailwind: '${id}' 를 '${base}' 에서 찾을 수 없습니다 (memfs)`)
}

export interface TailwindBrowserOptions {
  /** 후보를 스캔할 프로젝트 루트. Vite 의 root 와 같게 둔다. */
  root: string
}

/** Vite 플러그인 최소 형태. vite 를 타입 의존성으로 끌어오지 않기 위해 직접 정의한다. */
export interface TailwindBrowserPlugin {
  name: string
  transform(
    code: string,
    id: string,
  ): Promise<{ code: string; map: null } | undefined>
}

/**
 * Tailwind v4 를 브라우저 워커 안 Vite 에 물린다. `@tailwindcss/vite` 대신 쓴다.
 *
 * ```ts
 * createServer({ root: '/app', plugins: [tailwindBrowser({ root: '/app' })] })
 * ```
 */
export function tailwindBrowser(options: TailwindBrowserOptions): TailwindBrowserPlugin {
  const { root } = options
  return {
    name: 'browser-webapp-runtime:tailwind',
    async transform(code: string, id: string) {
      const path = id.split('?')[0]
      if (!path.endsWith('.css')) return undefined
      if (!/@import\s+["']tailwindcss|@tailwind\s|@reference\s/.test(code)) return undefined

      const compiler = await compile(code, {
        base: dirname(path),
        from: path,
        loadStylesheet: loadStylesheetFromMemfs,
      })

      // 걷기는 JS, 후보 추출만 wasm — scan() 을 절대 부르지 않는다
      const files = collectProjectFiles(root)
      const candidates = new Scanner({}).scanFiles(files)

      return { code: compiler.build(candidates), map: null }
    },
  }
}
