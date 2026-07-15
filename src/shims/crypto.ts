/**
 * `node:crypto` 셤.
 *
 * Vite 는 resolveConfig() 에서 `crypto.getRandomValues()` 를 부른다 (설정 해시 등).
 * 빈 객체로 스텁하면:
 *     TypeError: import___vite_browser_external.default.getRandomValues is not a function
 *       at resolveConfig
 *
 * 브라우저의 WebCrypto 가 getRandomValues / randomUUID / subtle 을 그대로 준다.
 *
 * 하지만 `createHash()` 는 WebCrypto 로 못 만든다 — Node 는 **동기**, WebCrypto 의
 * subtle.digest() 는 **비동기**다. Vite 가 ETag 생성(`entitytag()`)에서 동기로
 * 부르므로 순수 JS SHA-256(./sha256.ts)을 쓴다. Node 와 출력이 일치하는 것을
 * 테스트 벡터로 확인했다.
 */
import { sha256 } from './sha256.ts'

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

/** createHash 가 돌려주는 해셔. Node 의 Hash 를 흉내낸다. */
export interface Hash {
  update(data: string | Uint8Array): Hash
  digest(encoding?: 'hex' | 'base64' | 'base64url'): string | Uint8Array
}

const encodeBase64 = (b: Uint8Array): string => {
  let s = ''
  for (const byte of b) s += String.fromCharCode(byte)
  return btoa(s)
}

/**
 * Node 의 `crypto.createHash()` — **동기**다.
 *
 * Vite 는 ETag 생성(`entitytag()`) 등에서 이걸 동기로 부른다. WebCrypto 의
 * subtle.digest() 는 비동기라 쓸 수 없어서 순수 JS SHA-256 을 쓴다.
 *
 * 알고리즘 인자는 무시하고 항상 SHA-256 이다. Vite 가 요구하는 건
 * "결정적이고 잘 분산된 해시" 이지 특정 알고리즘이 아니다. (sha1 을 달라고 해도
 * sha256 을 주면 ETag/캐시키 용도로는 아무 문제가 없다.)
 */
export const createHash = (_algorithm?: string): Hash => {
  const chunks: Uint8Array[] = []
  const enc = new TextEncoder()
  const hash: Hash = {
    update(data: string | Uint8Array): Hash {
      chunks.push(typeof data === 'string' ? enc.encode(data) : data)
      return hash
    },
    digest(encoding?: 'hex' | 'base64' | 'base64url'): string | Uint8Array {
      let total = 0
      for (const c of chunks) total += c.length
      const all = new Uint8Array(total)
      let off = 0
      for (const c of chunks) { all.set(c, off); off += c.length }
      const out = sha256(all)
      if (encoding === 'hex') {
        return Array.from(out, (b) => b.toString(16).padStart(2, '0')).join('')
      }
      if (encoding === 'base64') return encodeBase64(out)
      if (encoding === 'base64url') {
        return encodeBase64(out).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      }
      return out
    },
  }
  return hash
}

export const hash = (algorithm: string, data: string, enc: 'hex' | 'base64' = 'hex'): string =>
  createHash(algorithm).update(data).digest(enc) as string

export default {
  getRandomValues,
  randomUUID,
  subtle,
  randomBytes,
  createHash,
  hash,
  webcrypto,
}
