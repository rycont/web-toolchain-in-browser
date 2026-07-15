/**
 * Vite 8 을 브라우저 워커에서 부팅하기 위한 alias 맵.
 *
 * Vite 8 의 dist 가 실제로 요구하는 node API 는 아래가 전부다 (dist/node 전체 grep 기준):
 *
 *   node:fs           default, `* as ns`, { existsSync, readFileSync }
 *   node:fs/promises  default, { constants }
 *   node:path         default, { basename, dirname, extname, isAbsolute, join,
 *                                normalize, posix, relative, resolve, sep }
 *   node:events       { EventEmitter }
 *   node:url          { URL, fileURLToPath, pathToFileURL }
 *   node:util         { format, formatWithOptions, inspect, parseEnv, promisify,
 *                       stripVTControlCharacters }
 *   node:perf_hooks   { performance }
 *   node:module       { Module, builtinModules, createRequire }
 *
 * 나머지 (node:http, node:net, node:tls, node:child_process, ...) 는
 * `server.middlewareMode: true` 로 켜면 import 만 되고 호출되지 않는다.
 *
 * 주의 — Vite 의 기본 동작은 알 수 없는 node 빌트인을 `module.exports = {}`
 * (빈 객체) 로 치환하는 것이다. 던지지 않기 때문에 빌드는 조용히 통과하고
 * 런타임에 `fs.readFileSync is not a function` 으로 터진다. 빌드 성공은
 * 아무것도 보장하지 않는다.
 */

/** alias 한 항목. Vite 의 `resolve.alias` 배열 형태와 동일하다. */
export interface AliasEntry {
  find: string | RegExp
  replacement: string
}

import { createRequire } from 'node:module'

const shim = (name: string): string =>
  new URL(`./shims/${name}`, import.meta.url).href

/**
 * `@rolldown/browser` 의 dist 파일을 exports 맵을 우회해서 절대경로로 집는다.
 *
 * 왜 필요한가 — @rolldown/browser@1.1.5 의 exports 맵은 `.`, `./experimental`,
 * `./plugins` 에는 "browser" 조건을 주면서 **`./utils` 에는 안 준다**:
 *
 *     "./utils": "./dist/utils-index.mjs"
 *
 * 그런데 `dist/utils-index.browser.mjs` 는 패키지 안에 실제로 존재한다.
 * 즉 상류 버그다. 그대로 두면 Vite 가 `rolldown/utils` 에서 가져가는
 * transformSync/minify 등이 node 용 wasi 바인딩을 물어서 이렇게 죽는다:
 *
 *     TypeError: __nodeWASI is not a constructor
 *
 * TODO: rolldown 에 이슈 보고. 고쳐지면 이 우회는 지운다.
 */
function rolldownBrowserDist(file: string): string {
  const req = createRequire(import.meta.url)
  const pkgJson = req.resolve('@rolldown/browser/package.json')
  return new URL(`./dist/${file}`, new URL(`file://${pkgJson}`)).pathname
}

/**
 * Vite 의 `resolve.alias` 에 그대로 넣을 수 있는 배열을 만든다.
 *
 * 순서가 중요하다. Vite 의 문자열 alias 는 접두사 매칭이라
 * `node:fs` 가 `node:fs/promises` 를 먼저 삼켜버린다. 긴 것부터 넣어야 한다.
 *
 * ```js
 * import { nodeShimAlias } from '@rycont/browser-webapp-runtime/alias'
 *
 * export default {
 *   resolve: { alias: nodeShimAlias(), conditions: ['browser', 'import', 'default'] },
 * }
 * ```
 */
/**
 * Vite 의 `define` 에 넣을 값들.
 *
 * `global` 은 Node 전역이고 브라우저엔 없다. Vite 자신의 dist 안에 남아 있어서
 * 없으면 `ReferenceError: global is not defined` 로 죽는다.
 *
 * ```js
 * export default { define: nodeShimDefine() }
 * ```
 */
export function nodeShimDefine(): Record<string, string> {
  return {
    global: 'globalThis',
    'process.env.NODE_ENV': '"production"',
  }
}

export function nodeShimAlias(): AliasEntry[] {
  return [
    // ── 네이티브 → wasm 스왑 ────────────────────────────────────────────
    // Vite 8 은 rolldown 을 코어 의존성으로 쓴다. 네이티브 rolldown 은 .node
    // 바이너리를 찾으려다 브라우저에서 이렇게 죽는다:
    //     Error: Cannot find native binding. npm has a bug related to optional
    //     dependencies (https://github.com/npm/cli/issues/4828) ...
    //
    // @rolldown/browser 는 같은 버전으로 `.`, `/experimental`, `/plugins`,
    // `/filter`, `/utils` 를 전부 제공하고 exports 맵에 "browser" 조건이 있다.
    // alias 가 접두사 매칭이므로 한 줄로 5개 서브패스가 모두 잡힌다.
    //
    // Vite 8 이 실제로 쓰는 것:
    //   rolldown              { VERSION, rolldown }
    //   rolldown/experimental
    //   rolldown/filter       { exactRegex, makeIdFiltersToMatchWithQuery, prefixRegex, withFilter }
    //   rolldown/plugins      { esmExternalRequirePlugin }
    //   rolldown/utils        { TsconfigCache, Visitor, minify, minifySync, parse, parseSync, transformSync }
    //
    // @rolldown/browser 안에는 평행한 두 그래프가 들어있다:
    //   브라우저: dist/index.browser.mjs → dist/error-*.js  → rolldown-binding.wasi-browser.js
    //   node   : dist/index.mjs         → dist/shared/*.mjs → rolldown-binding.wasi.cjs
    //
    // exports 맵의 "browser" 조건은 `.`, `./experimental`, `./plugins` 에만 있고
    // `./utils`, `./parseAst` 에는 없다. 그래서 Vite 가 쓰는 `rolldown/parseAst` 가
    // node 그래프를 끌고 들어와 wasi.cjs 를 물고, 그게 `require('node:wasi')` 를
    // 하는데 Vite 는 그걸 빈 객체로 스텁하므로:
    //
    //     TypeError: __nodeWASI is not a constructor
    //
    // 개별 진입점을 하나씩 우회하는 대신, **바인딩 자체를 갈아끼운다**.
    // 어느 그래프를 타고 들어오든 브라우저 바인딩에 도달하게 된다.
    // 정규식은 **specifier 전체**를 매칭해야 한다. 꼬리만 매칭하면 alias 가
    // 매칭된 부분만 치환해서 `../rolldown-binding.wasi.cjs` → `..//abs/path` 처럼
    // 접두사가 남는다.
    {
      find: /^.*rolldown-binding\.wasi\.cjs$/,
      replacement: rolldownBrowserDist('rolldown-binding.wasi-browser.js'),
    },
    // ./utils 는 exports 맵에 browser 조건이 없으므로 절대경로로 우회.
    // 반드시 일반 'rolldown' alias 보다 먼저 와야 한다 — 접두사 매칭이라 뒤에 두면 삼켜진다.
    { find: 'rolldown/utils', replacement: rolldownBrowserDist('utils-index.browser.mjs') },
    { find: 'rolldown', replacement: '@rolldown/browser' },

    // ── node 빌트인 ─────────────────────────────────────────────────────
    // 긴 specifier 부터 — 접두사 매칭이 짧은 쪽에 먹히는 것을 막는다
    { find: 'node:fs/promises', replacement: shim('fs-promises.ts') },
    { find: 'fs/promises', replacement: shim('fs-promises.ts') },

    { find: 'node:fs', replacement: shim('fs.ts') },
    { find: 'fs', replacement: shim('fs.ts') },

    { find: 'node:perf_hooks', replacement: shim('perf-hooks.ts') },
    { find: 'perf_hooks', replacement: shim('perf-hooks.ts') },

    { find: 'node:module', replacement: shim('module.ts') },
    { find: 'module', replacement: shim('module.ts') },

    { find: 'node:url', replacement: shim('url.ts') },
    { find: 'url', replacement: shim('url.ts') },

    { find: 'node:util', replacement: shim('util.ts') },
    { find: 'node:process', replacement: shim('process.ts') },

    // Vite 로거가 색상 지원 판단에 tty.isatty() 를 부른다
    { find: 'node:tty', replacement: shim('tty.ts') },
    { find: 'tty', replacement: shim('tty.ts') },
    { find: 'node:os', replacement: shim('os.ts') },
    { find: 'os', replacement: shim('os.ts') },

    // 빈 객체 스텁이면 안 된다 — Vite 가 모듈 최상단에서
    // `promisify(childProcess.execFile)` 을 해서 import 시점에 죽는다.
    { find: 'node:child_process', replacement: shim('child-process.ts') },
    { find: 'child_process', replacement: shim('child-process.ts') },

    // Vite 의 resolveHostname() 이 dns.getDefaultResultOrder() 를 부른다
    { find: 'node:dns', replacement: shim('dns.ts') },
    { find: 'dns', replacement: shim('dns.ts') },

    // Vite 의 resolveConfig() 가 crypto.getRandomValues() 를 부른다
    { find: 'node:crypto', replacement: shim('crypto.ts') },
    { find: 'crypto', replacement: shim('crypto.ts') },

    // connect 의 app.use() 가 `fn instanceof http.Server` 를 한다 —
    // Server 가 prototype 있는 클래스여야 한다. 빈 객체 스텁으로는 안 된다.
    { find: 'node:http', replacement: shim('http.ts') },
    { find: 'node:https', replacement: shim('http.ts') },

    // path-browserify 를 직접 alias 하지 않는다 — win32 가 null 이라 Vite 의
    // normalizePath 가 죽는다. shims/path.ts 가 그걸 메운다.
    { find: 'node:path', replacement: shim('path.ts') },
    { find: 'path', replacement: shim('path.ts') },

    // 순수 JS 기성품으로 충분한 것들
    { find: 'node:events', replacement: 'events' },
    { find: 'events', replacement: 'events' },
    // 'buffer' 패키지를 직접 alias 하지 않는다 — base64url 인코딩을 모른다.
    // shims/buffer.ts 가 그걸 메운다.
    { find: 'node:buffer', replacement: shim('buffer.ts') },

    // memfs → @jsonjoy.com/fs-node → @jsonjoy.com/fs-node-builtins 가
    // node:stream 의 { Readable, Writable } 을 re-export 하고, fs-node 의
    // FSWatcher / FileHandle / StatWatcher 가 그걸 extends 한다.
    // 빠뜨리면 Vite 가 빈 객체로 스텁해서 다음으로 죽는다:
    //     TypeError: The super constructor to inherit from is not defined
    { find: 'node:stream', replacement: 'stream-browserify' },
    { find: 'stream', replacement: 'stream-browserify' },
  ]
}
