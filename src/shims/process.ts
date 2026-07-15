/**
 * 브라우저 워커용 최소 `process` 셤.
 *
 * ⚠️ `versions.node` 가 **박싱된 String 객체**인 이유 — 세 요구가 정면충돌한다.
 *
 *  1. emnapi (@rolldown/browser, @tailwindcss/oxide-wasm32-wasi 가 올라탄 런타임)
 *     는 이렇게 Node 를 판별한다:
 *
 *         "string" == typeof process.versions.node
 *
 *     true 면 브라우저의 `Worker` 대신 `node:worker_threads` 경로를 타고 죽는다:
 *         TypeError: worker.on is not a function
 *         ... 뒤이어 Rust 패닉 (unreachable)
 *
 *  2. Vite 에 번들된 chokidar 는 모듈 최상단에서 이렇게 한다:
 *
 *         const [maj, min] = process.versions.node.split(".").slice(0, 2)...
 *
 *     undefined 면 `Cannot read properties of undefined (reading 'split')`.
 *     (chokidar 는 vite/dist 안에 인라인돼 있어서 alias 로 뺄 수도 없다.)
 *
 *  3. Vite 는 Yarn PnP 감지로 `process.versions.pnp` 를 읽는다.
 *     `versions` 자체가 없으면 `Cannot read properties of undefined (reading 'pnp')`.
 *
 * 그래서 `new String('20.0.0')` 이다:
 *   - `typeof` 는 `'object'` → emnapi 는 브라우저로 판단 ✅
 *   - `.split()` 등 문자열 메서드는 전부 동작 → chokidar 만족 ✅
 *   - `versions` 객체는 존재 → `.pnp` 읽기 안전 ✅
 *
 * 더러운 트릭이지만 세 제약을 동시에 만족하는 유일한 값이다.
 * 여기를 원시 문자열로 "정리" 하면 rolldown 이 Rust 패닉으로 죽는다.
 *
 * NAPI_RS_FORCE_WASI 는 napi-rs 로더의 공식 tri-state 플래그다:
 *   unset   → 네이티브 우선, WASI 는 fallback
 *   'true'  → 네이티브가 로드돼도 WASI 강제
 *   'error' → WASI 강제, 없으면 throw
 */

export interface MinimalProcess {
  env: Record<string, string | undefined>
  platform: string
  arch: string
  argv: string[]
  /**
   * `node` 는 **박싱된 String** 이어야 한다 (원시 문자열이면 emnapi 가 Node 로
   * 오인하고, undefined 면 chokidar 가 죽는다). 위 주석 참고.
   */
  versions: Record<string, unknown>
  cwd(): string
  emitWarning(): void
  on(): void
  off(): void
  exit(): void
  /** Vite 가 TTY 감지용으로 참조한다. 브라우저엔 stdin 이 없으므로 isTTY: false. */
  stdin: { isTTY: boolean; on(): void; off(): void; resume(): void; pause(): void; setEncoding(): void }
  stdout: { isTTY: boolean; write(): boolean; columns: number }
  stderr: { isTTY: boolean; write(): boolean; columns: number }
}

// stdin / stdout / stderr 는 named export 로도 요구된다
// (vite/dist/node/chunks/node.js 가 `import { stdout } from 'node:process'` 식으로 쓴다).
export const stdin = {
  isTTY: false,
  on() {},
  off() {},
  resume() {},
  pause() {},
  setEncoding() {},
}
export const stdout = { isTTY: false, write: (): boolean => true, columns: 80 }
export const stderr = { isTTY: false, write: (): boolean => true, columns: 80 }

/** `globalThis.process` 를 최소 셤으로 채운다. 이미 있으면 건드리지 않는다. */
export function installProcessShim(
  env: Record<string, string | undefined> = {},
): MinimalProcess {
  const proc: MinimalProcess = {
    env: { NODE_ENV: 'production', NAPI_RS_FORCE_WASI: 'true', ...env },
    platform: 'browser',
    arch: 'wasm32',
    argv: [],
    // `new String(...)` 은 오타가 아니다 — 위 주석 참고.
    // typeof 는 'object' (emnapi 만족), .split() 은 동작 (chokidar 만족).
    // eslint-disable-next-line no-new-wrappers
    versions: { node: new String('20.0.0') },
    cwd: () => '/',
    emitWarning() {},
    on() {},
    off() {},
    exit() {},
    stdin,
    stdout,
    stderr,
    // version / versions 를 여기에 추가하지 말 것 — 위 주석 참고
  }
  const g = globalThis as unknown as { process?: MinimalProcess }
  g.process ??= proc
  return g.process
}

const installed: MinimalProcess = installProcessShim()
export default installed
