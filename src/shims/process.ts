/**
 * 브라우저 워커용 최소 `process` 셤.
 *
 * ⚠️ 실측으로 확인된 함정 — 이 셤에 `version` / `versions.node` 를 넣지 말 것.
 *
 * @rolldown/browser 와 @tailwindcss/oxide-wasm32-wasi 는 emnapi 위에 올라가 있고,
 * emnapi 는 `process.versions.node` 를 보고 "여긴 Node 다" 라고 판단해서
 * 브라우저의 `Worker` 대신 `node:worker_threads` 경로를 탄다. 그러면
 *
 *     TypeError: worker.on is not a function
 *     ... 뒤이어 Rust 패닉 (unreachable)
 *
 * 으로 죽는다. 셤이 아예 없을 때(`process is not defined`)보다 더 크게 터진다.
 * "순진한 셤이 없느니만 못한" 사례이므로 필드를 늘릴 때 주의할 것.
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
  cwd(): string
  emitWarning(): void
  on(): void
  off(): void
  exit(): void
}

/** `globalThis.process` 를 최소 셤으로 채운다. 이미 있으면 건드리지 않는다. */
export function installProcessShim(
  env: Record<string, string | undefined> = {},
): MinimalProcess {
  const proc: MinimalProcess = {
    env: { NODE_ENV: 'production', NAPI_RS_FORCE_WASI: 'true', ...env },
    platform: 'browser',
    arch: 'wasm32',
    argv: [],
    cwd: () => '/',
    emitWarning() {},
    on() {},
    off() {},
    exit() {},
    // version / versions 를 여기에 추가하지 말 것 — 위 주석 참고
  }
  const g = globalThis as unknown as { process?: MinimalProcess }
  g.process ??= proc
  return g.process
}

const installed: MinimalProcess = installProcessShim()
export default installed
