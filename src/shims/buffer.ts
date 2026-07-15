/**
 * `node:buffer` 셤.
 *
 * npm 의 `buffer` 패키지(feross/buffer)는 오래된 폴리필이라 Node 15+ 의
 * **`base64url` 인코딩을 모른다**. Vite 는 resolveConfig() 에서 이걸 쓴다:
 *
 *     TypeError: Unknown encoding: base64url at Uint8Array.slowToString
 *       at resolveConfig
 *
 * base64url 은 base64 에서 `+`→`-`, `/`→`_`, 패딩 제거한 변종이므로
 * toString/from 을 감싸서 직접 변환해준다.
 */
import { Buffer as BaseBuffer, SlowBuffer, INSPECT_MAX_BYTES, kMaxLength } from 'buffer'

type Enc = string

const toBase64Url = (b64: string): string =>
  b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const fromBase64Url = (u: string): string => {
  const b64 = u.replace(/-/g, '+').replace(/_/g, '/')
  return b64 + '='.repeat((4 - (b64.length % 4)) % 4)
}

const origToString = BaseBuffer.prototype.toString
if (!(BaseBuffer.prototype as { __base64urlPatched?: boolean }).__base64urlPatched) {
  BaseBuffer.prototype.toString = function (enc?: Enc, start?: number, end?: number): string {
    if (enc === 'base64url') {
      return toBase64Url(origToString.call(this, 'base64', start, end))
    }
    return origToString.call(this, enc as never, start, end)
  }
  ;(BaseBuffer.prototype as { __base64urlPatched?: boolean }).__base64urlPatched = true
}

const origFrom = BaseBuffer.from.bind(BaseBuffer)
const patchedFrom = ((value: unknown, enc?: Enc, len?: number) => {
  if (typeof value === 'string' && enc === 'base64url') {
    return origFrom(fromBase64Url(value), 'base64')
  }
  return origFrom(value as never, enc as never, len as never)
}) as typeof BaseBuffer.from

export const Buffer: typeof BaseBuffer = new Proxy(BaseBuffer, {
  get(t, p, r) {
    if (p === 'from') return patchedFrom
    return Reflect.get(t, p, r)
  },
}) as typeof BaseBuffer

export { SlowBuffer, INSPECT_MAX_BYTES, kMaxLength }
export const constants = { MAX_LENGTH: kMaxLength, MAX_STRING_LENGTH: 536870888 }

export default { Buffer, SlowBuffer, INSPECT_MAX_BYTES, kMaxLength, constants }
