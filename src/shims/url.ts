/**
 * `node:url` 셤.
 *
 * ⚠️ fileURLToPath 가 http(s) URL 도 처리해야 한다.
 *
 * Vite 는 자기 설치 경로를 이렇게 잡는다:
 *
 *     const VITE_PACKAGE_DIR = resolve(
 *       fileURLToPath(new URL("../../../src/node/constants.ts", import.meta.url)), "../../..")
 *     const CLIENT_ENTRY = resolve(VITE_PACKAGE_DIR, "dist/client/client.mjs")
 *
 * 브라우저에서 `import.meta.url` 은 `http://host:port/assets/node-xxx.js` 이므로
 * 저 URL 은 file: 이 아니라 http: 다. http 를 그대로 문자열로 돌려주면
 * `resolve()` 가 상대경로로 취급해서 이렇게 된다:
 *
 *     Error: cannot test case insensitive FS, CLIENT_ENTRY does not point to an
 *     existing file: /http:/localhost:34003/dist/client/client.mjs
 *
 * 그래서 스킴과 무관하게 **pathname 만** 뽑는다. 그 결과 Vite 는
 * VITE_PACKAGE_DIR 을 `/` 로, CLIENT_ENTRY 를 `/dist/client/client.mjs` 로 보고,
 * seed.ts 의 seedViteInstall() 이 거기에 파일을 심어둔다.
 */
export const URL = globalThis.URL
export const URLSearchParams = globalThis.URLSearchParams

/**
 * URL(또는 URL 문자열)에서 가상 경로를 뽑는다.
 * file: / http: / https: 를 모두 pathname 으로 눌러버린다.
 */
export const fileURLToPath = (u: string | URL): string => {
  const s = typeof u === 'string' ? u : u.href
  if (/^(file|https?):\/\//.test(s)) {
    return decodeURIComponent(new globalThis.URL(s).pathname)
  }
  return s
}

export const pathToFileURL = (p: string): URL =>
  new globalThis.URL('file://' + encodeURI(p).replace(/#/g, '%23'))

export const parse = (s: string): URL => new globalThis.URL(s)
export const format = (u: URL | string): string =>
  String(typeof u === 'string' ? u : u.href)

export default { URL, URLSearchParams, fileURLToPath, pathToFileURL, parse, format }
