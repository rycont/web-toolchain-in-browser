/**
 * browser-webapp-runtime — Vite 8 툴체인을 브라우저 워커 안에서 돌리기 위한 조각들.
 *
 * 현재 상태는 README 의 "검증 현황" 표를 볼 것. 아직 Vite 부팅은 뚫리지 않았다.
 */

export { nodeShimAlias } from './alias.ts'
export type { AliasEntry } from './alias.ts'
export { installProcessShim } from './shims/process.ts'
export type { MinimalProcess } from './shims/process.ts'

/** 런타임이 툴체인을 돌릴 수 있는 상태인지 확인한 결과. */
export interface RuntimeSupport {
  /** COOP/COEP 가 적용돼 cross-origin isolated 상태인가. */
  crossOriginIsolated: boolean
  /** SharedArrayBuffer 가 노출돼 있는가. */
  sharedArrayBuffer: boolean
  /** 중첩 Worker 를 만들 수 있는가. wasi.thread-spawn 에 필수. */
  nestedWorker: boolean
  /** shared WebAssembly.Memory 를 만들 수 있는가. */
  sharedWasmMemory: boolean
  /** 위 전부를 만족하는가. */
  ok: boolean
}

/**
 * 현재 런타임이 rolldown/oxc/tailwind-oxide wasm 을 돌릴 수 있는지 확인한다.
 *
 * 셋 다 napi-rs/emnapi 로 빌드돼 `wasi.thread-spawn` 을 import 하므로
 * 공유 메모리와 중첩 Worker 가 **둘 다** 필요하다. 하나라도 없으면 초기화가 실패한다.
 * (workerd 는 SharedArrayBuffer 는 있지만 `Worker` 가 없어서 여기서 걸린다.)
 */
export function checkRuntimeSupport(): RuntimeSupport {
  const sharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined'
  const nestedWorker = typeof Worker !== 'undefined'
  const crossOriginIsolated = globalThis.crossOriginIsolated === true

  let sharedWasmMemory = false
  try {
    new WebAssembly.Memory({ initial: 1, maximum: 2, shared: true })
    sharedWasmMemory = true
  } catch {
    sharedWasmMemory = false
  }

  return {
    crossOriginIsolated,
    sharedArrayBuffer,
    nestedWorker,
    sharedWasmMemory,
    ok: crossOriginIsolated && sharedArrayBuffer && nestedWorker && sharedWasmMemory,
  }
}
