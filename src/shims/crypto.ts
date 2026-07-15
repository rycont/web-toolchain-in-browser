/**
 * `node:crypto` 셤.
 *
 * Vite 는 resolveConfig() 에서 `crypto.getRandomValues()` 를 부른다 (설정 해시 등).
 * 빈 객체로 스텁하면:
 *     TypeError: import___vite_browser_external.default.getRandomValues is not a function
 *       at resolveConfig
 *
 * 브라우저의 WebCrypto 가 getRandomValues / randomUUID / subtle 을 그대로 준다.
 * Node 스타일 API(createHash 등)는 **동기**라 WebCrypto(비동기)로 못 만든다.
 * 필요해지면 hash-wasm 같은 동기 구현을 붙여야 한다. 지금은 안 쓰이므로
 * 부르면 명확히 실패하게 둔다.
 */
const webcrypto = globalThis.crypto

export const getRandomValues = <T extends ArrayBufferView | null>(a: T): T =>
  webcrypto.getRandomValues(a as never) as T

export const randomUUID = (): string => webcrypto.randomUUID()
export const subtle = webcrypto.subtle

export const randomBytes = (n: number): Uint8Array => {
  const b = new Uint8Array(n)
  webcrypto.getRandomValues(b)
  return b
}

/** Node 의 createHash 는 동기라 WebCrypto 로 흉내낼 수 없다. 필요해지면 hash-wasm 을 붙일 것. */
export const createHash = (): never => {
  throw new Error(
    'crypto.createHash 는 아직 미구현입니다 (Node 는 동기, WebCrypto 는 비동기). ' +
      '필요하면 hash-wasm 같은 동기 구현을 붙이세요.',
  )
}

export default {
  getRandomValues,
  randomUUID,
  subtle,
  randomBytes,
  createHash,
  webcrypto,
}
