/**
 * Vite 가 런타임에 자기 설치본을 찾을 수 있도록 memfs 를 채운다.
 *
 * Vite 의 `src/node/constants.ts` 는 모듈 최상단에서 이런 짓을 한다:
 *
 *     const { version } = JSON.parse(readFileSync(
 *       new URL("../../package.json", new URL("../../../src/node/constants.ts", import.meta.url))
 *     ).toString())
 *
 *     const VITE_PACKAGE_DIR = resolve(
 *       fileURLToPath(new URL("../../../src/node/constants.ts", import.meta.url)), "../../..")
 *     const CLIENT_ENTRY = resolve(VITE_PACKAGE_DIR, "dist/client/client.mjs")
 *
 * 브라우저에서 `import.meta.url` 은 `http://host/assets/node-xxx.js` 다. URL 연산을 따라가면:
 *
 *     new URL("../../../src/node/constants.ts", "http://host/assets/node-xxx.js")
 *       → http://host/src/node/constants.ts        (루트 위로는 클램프된다)
 *     new URL("../../package.json", 그것)
 *       → http://host/package.json
 *
 * shims/fs.ts 의 toVirtualPath() 가 저걸 pathname 으로 눌러주므로 Vite 는
 * 결국 `/package.json` 과 `/dist/client/client.mjs` 를 읽으려 한다.
 *
 * ⚠️ 저 경로들은 번들 에셋이 `/assets/` 깊이에 있다는 것에 의존한다.
 *    출력 경로 깊이를 바꾸면 여기도 같이 바꿔야 한다. 취약한 결합이고,
 *    나중에 fs 셤에서 명시적 매핑 테이블로 대체하는 게 낫다.
 */
import { fs } from 'memfs'

/** Vite 설치본을 흉내내기 위해 memfs 에 심을 내용. */
export interface ViteInstallSeed {
  /** vite 의 package.json 내용. 최소한 `version` 이 있어야 한다. */
  packageJson: { version: string; [k: string]: unknown }
  /** `vite/dist/client/client.mjs` 원문. HMR 클라이언트. */
  clientMjs?: string
  /** `vite/dist/client/env.mjs` 원문. */
  envMjs?: string
}

/** Vite 가 자기 설치본을 찾을 수 있도록 memfs 를 채운다. */
export function seedViteInstall(seed: ViteInstallSeed): void {
  const f = fs as unknown as {
    mkdirSync(p: string, o?: unknown): void
    writeFileSync(p: string, d: string): void
  }
  f.mkdirSync('/dist/client', { recursive: true })
  f.writeFileSync('/package.json', JSON.stringify(seed.packageJson))
  f.writeFileSync('/dist/client/client.mjs', seed.clientMjs ?? '')
  f.writeFileSync('/dist/client/env.mjs', seed.envMjs ?? '')
}

/** 사용자 프로젝트를 memfs 에 올린다. 경로 → 내용. */
export function seedProject(root: string, files: Record<string, string>): void {
  const f = fs as unknown as {
    mkdirSync(p: string, o?: unknown): void
    writeFileSync(p: string, d: string): void
  }
  f.mkdirSync(root, { recursive: true })
  for (const [rel, content] of Object.entries(files)) {
    const full = `${root}/${rel}`.replace(/\/+/g, '/')
    const dir = full.slice(0, full.lastIndexOf('/'))
    if (dir) f.mkdirSync(dir, { recursive: true })
    f.writeFileSync(full, content)
  }
}

/**
 * 프로젝트의 `node_modules/<name>/` 에 패키지를 심는다.
 *
 * 왜 필요한가 — 툴체인(Vite, Tailwind 플러그인)은 워커 번들에 구워져 있지만,
 * **프로젝트가 참조하는 것들은 memfs 에 실재해야 한다**. 예를 들어 Tailwind v4 의
 * `@import "tailwindcss"` 는 프로젝트의 node_modules 에서 CSS 를 찾는다:
 *
 *     Error: Can't resolve 'tailwindcss' in '/app/src'
 *
 * 이게 앞서 정리한 "툴체인 트리 / 앱 트리" 구분이 실제로 드러나는 지점이다.
 * 툴체인은 굽고, 앱 트리는 memfs 에 심는다.
 */
export function seedNodeModule(
  root: string,
  name: string,
  files: Record<string, string>,
): void {
  seedProject(`${root}/node_modules/${name}`, files)
}
