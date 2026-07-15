/**
 * 브라우저 워커용 Tailwind v4 통합. `@tailwindcss/vite` 를 대체한다.
 *
 * **oxide(wasm)를 쓰지 않는다.** 그래서 별도 워커도 필요 없고, SharedArrayBuffer 도
 * 요구하지 않으며, rolldown 과 충돌하지도 않는다. 전부 순수 JS 다:
 *
 *   1. 프로젝트 파일 걷기 → memfs (동기라 공짜)
 *   2. 후보 추출        → `./extract-candidates.ts` (정규식, oxide 와 출력 동일)
 *   3. CSS 생성         → `tailwindcss` 의 `compile().build(candidates)` (순수 JS)
 *
 * ## 왜 oxide 를 버렸나 — 브라우저에서 못 쓴다
 *
 * `Scanner.scan()` 은 fs 를 걷느라 rayon 스레드를 띄우는데, napi-rs 의
 * wasi-browser 템플릿 구조상 두 컨텍스트 모두 막힌다:
 *
 *   - 메인 스레드: `RuntimeError: Atomics.wait cannot be called in this context`
 *   - 워커: **데드락**. 부모가
 *       `worker.addEventListener('message', __wasmCreateOnMessageForFsProxy(__fs))`
 *     로 "내 이벤트루프로 자식의 fs 요청에 답하겠다" 고 등록해놓고 곧바로
 *     `Atomics.wait()` 으로 그 이벤트루프를 멈춘다. 요구사항이 상호배타적이다.
 *
 * `scanFiles(contents)` 는 fs 를 안 건드려서 그 데드락은 피하지만, oxide wasm 을
 * 로드하는 것만으로 rolldown 과 충돌해 멈춘다 (원인 미상, README 참고).
 *
 * 그래서 oxide 를 **아예 안 쓴다.** `build(candidates)` 가 모르는 후보를 무시하므로
 * 정규식 과추출로 충분하고, 실측상 oxide 와 **바이트 단위로 같은 CSS** 가 나온다.
 * 덤으로 wasm 1.7 MB 와 Tailwind 쪽 SAB 요구가 같이 사라진다.
 *
 * ## `@tailwindcss/node` 를 안 쓰는 이유는 다르다
 *
 * 그건 버그가 아니라 **Node 어댑터**라서다 — `registerHooks`(Node ESM 로더 훅) 등
 * 브라우저에 대응물이 없는 것들을 쓴다. Tailwind 의 순수 JS 코어인
 * `compile(css, { loadStylesheet, loadModule })` 이 곧 호스트를 꽂는 자리이고,
 * 이 파일은 거기에 memfs 를 꽂는다. 대체이지 우회가 아니다.
 *
 * ## `@tailwindcss/browser` 를 안 쓰는 이유
 *
 * 그건 **DOM 스캐너**다 (`querySelectorAll('[class]')` + MutationObserver 로
 * 렌더된 class 속성을 긁어 `<style>` 을 head 에 꽂는다. wasm 은 0건).
 * 렌더된 것만 보므로 아직 마운트 안 된 컴포넌트의 클래스가 누락되고, 첫 페인트에
 * 깜빡임이 생기며, 소스를 스캔하는 프로덕션 빌드와 결과가 갈린다.
 * 프리뷰용으론 쓸 만하지만 "수정 없이 그대로 돌아간다" 를 목표로 하면 함정이다.
 */
import { fs } from 'memfs'
import { compile } from 'tailwindcss'
import { extractCandidatesFrom } from './extract-candidates.ts'

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

/** 프로젝트 소스를 memfs 에서 걷어 모은다. */
function collectSources(root: string): string[] {
  const out: string[] = []
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
        out.push(f.readFileSync(full, 'utf8'))
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
    const p = norm(raw)
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
  transform(code: string, id: string): Promise<{ code: string; map: null } | undefined>
}

/**
 * Tailwind v4 를 브라우저 워커 안 Vite 에 물린다. `@tailwindcss/vite` 대신 쓴다.
 *
 * 사용자 앱은 손댈 필요가 없다 — 모듈 레지스트리에서 `@tailwindcss/vite` 를
 * 이 함수로 바꿔치기하면 사용자의 `plugins: [tailwindcss()]` 가 그대로 동작한다.
 */
export function tailwindBrowser(options: TailwindBrowserOptions): TailwindBrowserPlugin {
  const { root } = options
  return {
    name: 'web-toolchain-in-browser:tailwind',
    async transform(code: string, id: string) {
      const path = id.split('?')[0]
      if (!path.endsWith('.css')) return undefined
      if (!/@import\s+["']tailwindcss|@tailwind\s|@reference\s/.test(code)) return undefined

      const compiler = await compile(code, {
        base: dirname(path),
        from: path,
        loadStylesheet: loadStylesheetFromMemfs,
      })

      const candidates = extractCandidatesFrom(collectSources(root))
      return { code: compiler.build(candidates), map: null }
    },
  }
}
