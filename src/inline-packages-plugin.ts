/**
 * **빌드 타임** Vite 플러그인 — npm 패키지를 통째로 워커 번들 안에 인라인해서
 * 런타임에 memfs 로 심을 수 있게 한다.
 *
 * 이건 브라우저에서 도는 코드가 아니라, **워커 번들을 만들 때** 쓰는 플러그인이다.
 *
 * ## 왜 필요한가 — 툴체인 트리 / 앱 트리
 *
 * 툴체인(Vite, Tailwind 어댑터)은 워커 번들에 구워지지만, **사용자 앱이 import 하는
 * 것들(react, react-dom …)은 memfs 의 node_modules 에 실재해야 한다.** Vite 가
 * 그것들을 fs 로 resolve 하고 프리번들하기 때문이다.
 *
 * `?raw` 를 파일마다 쓰는 건 현실적이지 않다 (react-dom 만 수십 개). 그래서
 * 빌드 타임에 패키지 디렉터리를 통째로 읽어 `{ 경로: 내용 }` 맵으로 굽는다.
 *
 * ## 사용
 *
 * ```ts
 * // vite.config.ts (워커 번들 빌드용)
 * import { inlinePackages } from '@rycont/web-toolchain-in-browser/inline-packages-plugin'
 * export default { plugins: [inlinePackages(['react', 'react-dom', 'tailwindcss'])] }
 * ```
 *
 * ```ts
 * // 워커 안에서
 * import packages from 'virtual:inlined-packages'
 * seedPackages('/app', packages)
 * ```
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'

const VIRTUAL_ID = 'virtual:inlined-packages'
const RESOLVED_ID = '\0' + VIRTUAL_ID

/** 인라인할 파일 확장자. 바이너리/맵/문서는 뺀다 — 크기만 키우고 안 쓰인다. */
const KEEP = /\.(js|mjs|cjs|json|css|ts|tsx|jsx)$/
const SKIP_FILE = /\.(map|d\.ts|d\.mts|d\.cts)$/
const SKIP_DIR = /^(node_modules|\.git|umd|__tests__|test|tests|docs)$/

/** 인라인된 패키지들. `{ 패키지명: { 상대경로: 내용 } }`. */
export type InlinedPackages = Record<string, Record<string, string>>

function readPackageFiles(pkgDir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      let st: ReturnType<typeof statSync>
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        if (!SKIP_DIR.test(name)) walk(full)
        continue
      }
      if (!KEEP.test(name) || SKIP_FILE.test(name)) continue
      out[relative(pkgDir, full).split('\\').join('/')] = readFileSync(full, 'utf8')
    }
  }
  walk(pkgDir)
  return out
}

/** 최소 Vite 플러그인 형태. vite 를 타입 의존성으로 끌어오지 않는다. */
export interface InlinePackagesPlugin {
  name: string
  resolveId(id: string): string | undefined
  load(id: string): string | undefined
}

/**
 * 지정한 패키지들을 `virtual:inlined-packages` 로 인라인한다.
 *
 * @param packages 인라인할 패키지 이름들 (예: `['react', 'react-dom']`)
 * @param from 해석 기준 경로. 기본은 이 플러그인이 실행되는 위치.
 */
export function inlinePackages(
  packages: string[],
  from: string = import.meta.url,
): InlinePackagesPlugin {
  return {
    name: 'web-toolchain-in-browser:inline-packages',
    resolveId(id: string) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined
    },
    load(id: string) {
      if (id !== RESOLVED_ID) return undefined
      const req = createRequire(from)
      const out: InlinedPackages = {}
      for (const pkg of packages) {
        // package.json 은 거의 항상 exports 에 열려 있어서 디렉터리를 찾는 열쇠가 된다
        const pkgJson = req.resolve(`${pkg}/package.json`)
        out[pkg] = readPackageFiles(dirname(pkgJson))
      }
      return `export default ${JSON.stringify(out)}`
    },
  }
}
