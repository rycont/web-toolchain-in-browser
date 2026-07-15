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
  find: string
  replacement: string
}

const shim = (name: string): string =>
  new URL(`./shims/${name}`, import.meta.url).href

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
export function nodeShimAlias(): AliasEntry[] {
  return [
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

    // 순수 JS 기성품으로 충분한 것들
    { find: 'node:path', replacement: 'path-browserify' },
    { find: 'path', replacement: 'path-browserify' },
    { find: 'node:events', replacement: 'events' },
    { find: 'node:buffer', replacement: 'buffer' },
  ]
}
