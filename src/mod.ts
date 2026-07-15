/**
 * web-toolchain-in-browser — Vite 8 + React + Tailwind + TypeScript 앱을
 * 브라우저 안에서 돌린다. 서버 없이.
 *
 * 두 쪽으로 나뉜다:
 *   - 워커: `createBrowserRuntime()` + `serveWorker()`  (`./runtime.ts`)
 *   - 페이지: `createPreview()`                          (`./preview.ts`)
 *   - SW 엔트리: `import '@rycont/web-toolchain-in-browser/sw'`
 *
 * 빌드 설정에는 `nodeShimAlias()` / `nodeShimDefine()` / `inlinePackages()` 를 쓴다.
 * ⚠️ 플러그인은 `worker.plugins` 에도 넣어야 한다 — 워커 번들은 파이프라인이 별도다.
 *
 * 현재 상태와 실측치는 README 참고.
 */

export { createBrowserRuntime, serveWorker } from './runtime.ts'
export type { BrowserRuntime, CreateBrowserRuntimeOptions } from './runtime.ts'
export { createPreview, explainUnsupported, PREVIEW_PREFIX } from './preview.ts'
export type { CreatePreviewOptions, Preview } from './preview.ts'
export { nodeShimAlias, nodeShimDefine } from './alias.ts'
export type { AliasEntry } from './alias.ts'
export { seedPackages, seedProject, seedViteInstall, seedNodeModule } from './seed.ts'
export type { ViteInstallSeed } from './seed.ts'
export { tailwindBrowser } from './tailwind.ts'
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
