/**
 * `node:fs` 셤 — memfs 위에 얹는다.
 *
 * ⚠️ URL 인자 처리가 핵심이다.
 *
 * Vite 의 `src/node/constants.ts` 는 **모듈 최상단에서** 자기 설치 경로를 찾는다:
 *
 *     const { version } = JSON.parse(readFileSync(
 *       new URL("../../package.json", new URL("../../../src/node/constants.ts", import.meta.url))
 *     ).toString())
 *
 * 브라우저에서 `import.meta.url` 은 `http://host/assets/node-xxx.js` 이므로 저 URL 들이
 * file: 가 아니라 http: 가 된다. 그대로 memfs 에 넘기면 host 검사에 걸려 죽는다:
 *
 *     TypeError [ERR_INVALID_FILE_URL_HOST]: File URL host must be "localhost" or empty on browser
 *
 * 그래서 여기서 URL 을 pathname 으로 눌러 가상 경로로 바꾼다. 그 결과 Vite 는
 * 자기 package.json 을 `/package.json` 에서 찾게 되고, seedViteInstall() 이 그걸 심는다.
 */
import { fs } from 'memfs'

type PathArg = string | URL | { href?: string; pathname?: string }

/** URL(또는 URL 같은 것)을 memfs 가 이해하는 경로 문자열로 변환한다. */
export function toVirtualPath(p: PathArg): string {
  if (typeof p === 'string') {
    if (p.startsWith('file://') || p.startsWith('http://') || p.startsWith('https://')) {
      return decodeURIComponent(new URL(p).pathname)
    }
    return p
  }
  const href = (p as URL)?.href
  if (typeof href === 'string') return decodeURIComponent(new URL(href).pathname)
  return String(p)
}

const f = fs as unknown as Record<string, (...a: unknown[]) => unknown>

/**
 * memfs 메서드를 감싸 첫 인자(경로)만 정규화한다.
 *
 * 반환 타입을 명시한다 — JSR 은 공개 API 의 타입을 추론으로 알아내려 하면
 * "slow types" 로 거부하고 .d.ts 자동 생성도 포기한다.
 */
type FsFn = (p: PathArg, ...rest: unknown[]) => unknown
const wrap = (name: string): FsFn => (p, ...rest) => f[name](toVirtualPath(p), ...rest)

export const existsSync: FsFn = wrap('existsSync')
export const readFileSync: FsFn = wrap('readFileSync')
export const writeFileSync: FsFn = wrap('writeFileSync')
export const statSync: FsFn = wrap('statSync')
export const lstatSync: FsFn = wrap('lstatSync')
export const readdirSync: FsFn = wrap('readdirSync')
export const mkdirSync: FsFn = wrap('mkdirSync')
export const realpathSync: FsFn = wrap('realpathSync')
export const readlinkSync: FsFn = wrap('readlinkSync')
export const rmSync: FsFn = wrap('rmSync')
export const unlinkSync: FsFn = wrap('unlinkSync')

// 콜백 방식 — tinyglobby (Vite 8 의 5개 런타임 의존성 중 하나) 가 이것들을 쓴다
export const readdir: FsFn = wrap('readdir')
export const realpath: FsFn = wrap('realpath')
export const stat: FsFn = wrap('stat')
export const lstat: FsFn = wrap('lstat')
export const readFile: FsFn = wrap('readFile')
export const writeFile: FsFn = wrap('writeFile')

export const promises = fs.promises
export const constants = fs.constants
export const watch = (): { close(): void; on(): void } => ({ close() {}, on() {} })

/**
 * default export 도 URL 을 처리해야 한다 — Vite 는 `import fs from 'node:fs'` 후
 * `fs.readFileSync(new URL(...))` 를 부른다. named export 만 감싸면 이 경로가 샌다.
 *
 * Proxy 로 감싸서 경로를 받는 메서드는 전부 정규화한다. memfs 에 새 메서드가
 * 생겨도 자동으로 따라간다.
 */
const PATH_FIRST_ARG = new Set([
  'access', 'accessSync', 'appendFile', 'appendFileSync', 'chmod', 'chmodSync',
  'chown', 'chownSync', 'copyFile', 'copyFileSync', 'createReadStream',
  'createWriteStream', 'exists', 'existsSync', 'lstat', 'lstatSync', 'mkdir',
  'mkdirSync', 'open', 'openSync', 'opendir', 'opendirSync', 'readFile',
  'readFileSync', 'readdir', 'readdirSync', 'readlink', 'readlinkSync',
  'realpath', 'realpathSync', 'rm', 'rmSync', 'rmdir', 'rmdirSync', 'stat',
  'statSync', 'truncate', 'truncateSync', 'unlink', 'unlinkSync', 'utimes',
  'utimesSync', 'writeFile', 'writeFileSync',
])

const fsProxy: typeof fs = new Proxy(fs, {
  get(target, prop, recv) {
    const v = Reflect.get(target, prop, recv)
    if (typeof v !== 'function' || typeof prop !== 'string') return v
    if (!PATH_FIRST_ARG.has(prop)) return v
    return (p: PathArg, ...rest: unknown[]) =>
      (v as (...a: unknown[]) => unknown).call(target, toVirtualPath(p), ...rest)
  },
}) as typeof fs

export default fsProxy
