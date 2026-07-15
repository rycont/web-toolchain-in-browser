/**
 * `node:module` 셤.
 *
 * Vite 는 `createRequire(import.meta.url)('fs')` 같은 호출을 실제로 한다.
 * (초기엔 이 셤이 무조건 throw 했고, 그래서 createServer 가
 *  `createRequire is not supported in the browser: fs` 로 죽었다.)
 *
 * 브라우저엔 동기 모듈 로더가 없으므로 임의의 specifier 는 지원할 수 없다.
 * 대신 **우리가 셤을 갖고 있는 빌트인 집합은 유한**하므로 정적 레지스트리로 푼다.
 * 레지스트리에 없는 것을 require 하면 명확한 메시지와 함께 throw 한다 —
 * 조용히 `{}` 를 돌려주면 (Vite 의 기본 스텁이 그러듯) 호출부에서 한참 뒤에
 * 엉뚱한 방식으로 터진다.
 */
import * as fsShim from './fs.ts'
import * as fsPromisesShim from './fs-promises.ts'
import * as urlShim from './url.ts'
import * as utilShim from './util.ts'
import * as perfHooksShim from './perf-hooks.ts'
import * as pathShim from './path.ts'
import * as ttyShim from './tty.ts'
import * as osShim from './os.ts'
import * as childProcessShim from './child-process.ts'
import * as dnsShim from './dns.ts'
import * as cryptoShim from './crypto.ts'
import * as httpShim from './http.ts'
import processShim from './process.ts'
import * as eventsShim from 'events'
import * as streamShim from 'stream-browserify'
import * as bufferShim from './buffer.ts'

// Vite 8 이 createRequire 로 가져가는 **비-빌트인** 패키지는 딱 7개다
// (vite/dist/node/chunks/*.js 의 require("...") 전수조사):
//
//   picomatch postcss              ← 진짜 런타임 의존성. 정적으로 넣어준다.
//   fsevents                       ← macOS 전용 optional
//   ws bufferutil utf-8-validate   ← HMR websocket + 그 네이티브 옵션
//   sugarss                        ← optional postcss 문법
//
// 앞의 둘만 실물이 필요하고 나머지는 스텁이면 된다. 닫힌 집합이라
// 브라우저에 동기 모듈 로더가 없어도 문제가 되지 않는다.
import * as picomatch from 'picomatch'
import * as postcss from 'postcss'

export const builtinModules: string[] = [
  'fs', 'fs/promises', 'path', 'url', 'util', 'events', 'module',
  'perf_hooks', 'process', 'stream', 'buffer', 'os', 'crypto',
  'http', 'https', 'net', 'tls', 'zlib', 'assert', 'tty', 'child_process',
]

/**
 * 브라우저에 대응물이 없는 모듈용 스텁 팩토리.
 *
 * Vite 는 middlewareMode 에서 http/https 서버를 **만들지 않지만**, 모듈을
 * require 하기는 한다. 그래서 require 자체는 성공해야 하고, 실제로 서버를
 * 열려고 하면 그때 명확히 실패해야 한다.
 */
function unsupportedModule(name: string): Record<string, unknown> {
  const boom = (fn: string) => () => {
    throw new Error(`${name}.${fn} 는 브라우저에서 지원되지 않습니다`)
  }
  return {
    createServer: boom('createServer'),
    Server: boom('Server'),
    request: boom('request'),
    get: boom('get'),
    connect: boom('connect'),
    createConnection: boom('createConnection'),
    Agent: class {},
    STATUS_CODES: {},
    METHODS: [],
  }
}

/** `node:` 접두사를 벗긴 이름 → 셤 모듈. */
const REGISTRY: Record<string, unknown> = {
  // 대응물이 없는 것들 — require 는 되고 실제 사용 시 throw
  'http': httpShim,
  'https': httpShim,
  'net': unsupportedModule('net'),
  'tls': unsupportedModule('tls'),

  'zlib': {},
  'assert': Object.assign(
    (v: unknown, m?: string) => {
      if (!v) throw new Error(m ?? 'assertion failed')
    },
    { ok: (v: unknown, m?: string) => { if (!v) throw new Error(m ?? 'assertion failed') } },
  ),

  'worker_threads': { isMainThread: true, Worker: globalThis.Worker },
  'fs': fsShim,
  'fs/promises': fsPromisesShim,
  'path': pathShim,
  'url': urlShim,
  'util': utilShim,
  'events': eventsShim,
  'stream': streamShim,
  'buffer': bufferShim,
  'perf_hooks': perfHooksShim,
  'process': processShim,
  'tty': ttyShim,
  'os': osShim,
  'child_process': childProcessShim,
  'dns': dnsShim,
  'crypto': cryptoShim,

  // Vite 의 비-빌트인 require 대상
  'picomatch': picomatch,
  'postcss': postcss,
  // optional / 브라우저에서 불필요 — 없는 척하면 Vite 가 알아서 우회한다
  'fsevents': null,
  'ws': null,
  'bufferutil': null,
  'utf-8-validate': null,
  'sugarss': null,
}

/** CJS 소비자는 default 를 기대하는 경우가 많다. 있으면 그걸 준다. */
function unwrap(mod: unknown): unknown {
  const m = mod as { default?: unknown }
  return m?.default ?? mod
}

export interface RequireFn {
  (id: string): unknown
  resolve(id: string): string
  cache: Record<string, unknown>
}

/**
 * `node:module` 의 createRequire 를 흉내낸다.
 * 셤이 있는 빌트인만 해석되고, 나머지는 throw 한다.
 */
export function createRequire(_from?: string | URL): RequireFn {
  const req = ((id: string): unknown => {
    const key = id.replace(/^node:/, '')
    if (key in REGISTRY) return unwrap(REGISTRY[key])

    // 알려진 Node 빌트인인데 우리가 셤을 안 만든 것 (http2, vm, cluster, ...):
    // require 는 통과시키고 실제로 **쓰면** 터지는 스텁을 준다. Vite 는 이런
    // 모듈을 조건부 기능 감지용으로 require 해놓고 안 쓰는 경우가 많다.
    if (builtinModules.includes(key) || id.startsWith('node:')) {
      const stub = unsupportedModule(key)
      REGISTRY[key] = stub
      return stub
    }

    // 빌트인이 아닌 것 = 진짜 패키지. 브라우저엔 동기 로더가 없으므로 방법이 없다.
    throw new Error(
      `createRequire: '${id}' 는 브라우저에서 해석할 수 없습니다 ` +
        `(빌트인이 아니고, 브라우저엔 동기 모듈 로더가 없습니다).`,
    )
  }) as RequireFn
  req.resolve = (id: string) => id
  req.cache = {}
  return req
}

/** `node:module` 의 isBuiltin. @tailwindcss/node 가 쓴다. */
export function isBuiltin(id: string): boolean {
  return id.startsWith('node:') || builtinModules.includes(id)
}

/**
 * `node:module` 의 register / registerHooks — Node 의 ESM 로더 훅.
 * 브라우저엔 대응물이 없다. Vite 는 이게 없으면 `freshImport` 등에서
 * 알아서 우회하므로(`Returns undefined on runtimes that provide neither`)
 * 조용히 no-op 으로 둔다.
 */
export function register(): void {}
export function registerHooks(): void {}
export function syncBuiltinESMExports(): void {}

export class Module {
  static builtinModules: string[] = builtinModules
  static createRequire: typeof createRequire = createRequire
  static isBuiltin: typeof isBuiltin = isBuiltin
  static register: typeof register = register
  static registerHooks: typeof registerHooks = registerHooks
  static _resolveFilename(id: string): string {
    return id
  }
}

export default Module
