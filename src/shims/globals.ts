/**
 * 워커 전역 부트스트랩.
 *
 * Vite 를 import 하기 **전에** 이 모듈을 import 해야 한다. Vite 의 dist 는
 * 모듈 최상단에서 `process` 와 `Buffer` 를 건드리기 때문이다.
 *
 * `global` 은 여기서 안 다룬다 — Vite 설정의 `define: { global: 'globalThis' }` 로
 * 컴파일 타임에 치환하는 게 맞다 (nodeShimDefine() 참고).
 */
import { Buffer } from './buffer.ts'
import { installProcessShim } from './process.ts'

/** `globalThis.process` 와 `globalThis.Buffer` 를 채운다. 이미 있으면 두고 간다. */
export function installGlobals(env: Record<string, string | undefined> = {}): void {
  installProcessShim(env)
  const g = globalThis as unknown as { Buffer?: unknown; global?: unknown }
  g.Buffer ??= Buffer
  g.global ??= globalThis
}

installGlobals()
