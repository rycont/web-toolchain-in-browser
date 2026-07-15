/**
 * **빌드 타임** 플러그인 — `@rolldown/browser` 의 wasi 부트스트랩을 패치한다.
 *
 * `rolldown-binding.wasi-browser.js` 는 tarball 안의 **평범한 JS** 라서 고쳐 쓸 수 있다.
 * 원본은 이렇게 생겼다:
 *
 * ```js
 * const __sharedMemory = new WebAssembly.Memory({
 *   initial: 16384,    // × 64KiB = 1 GiB
 *   maximum: 65536,    // × 64KiB = 4 GiB (= wasm32 주소공간 전체)
 *   shared: true,
 * })
 * ...
 * await __emnapiInstantiateNapiModule(__wasmFile, {
 *   asyncWorkPoolSize: 4,   // = Node 의 UV_THREADPOOL_SIZE 기본값
 *   ...
 * })
 * ```
 *
 * ## 왜 이 숫자들인가
 *
 * **initial: 16384 (1 GiB)** — 공유 메모리는 grow 할 때 이동이 불가능하다
 * (다른 스레드가 같은 버퍼에 살아있는 뷰를 들고 있으므로). 그래서 주소 범위를
 * 미리 선점해야 하고, grow 하면 모든 워커의 TypedArray 뷰를 다시 잡아야 한다.
 * napi-rs 템플릿은 "그럴 바엔 크게 잡고 grow 를 안 한다" 를 택했다.
 *
 * **asyncWorkPoolSize: 4** — emnapi 가 Node 의 libuv 스레드풀을 흉내내는 워커 수.
 * `napi_create_async_work` 용이다. **0 이하면 `singleThreadAsyncWork = true`** 가
 * 되어 워커 풀 없이 메인 스레드에서 돈다 (emnapi-core.js 확인). rolldown 의 실제
 * 병렬 처리(rayon)는 `wasi.thread-spawn` 을 쓰므로 이것과는 별개다.
 *
 * ## 왜 건드리나
 *
 * Node/V8 에서는 1 GiB 예약이 lazy commit 되어 RSS +1.6 MB 였지만,
 * **브라우저에서는 수백 MB 가 실제로 잡힌다** (실측: Todo 앱 렌더에 RSS +641 MB).
 * 데스크톱은 괜찮아도 모바일은 이 숫자로 어렵다.
 *
 * ⚠️ `initial` 을 낮추면 grow 가 실제로 일어난다. emnapi 의 grow 경로가 실전에서
 * 멀쩡한지는 **재봐야 아는 것**이므로, 낮춘 뒤 반드시 테스트를 돌릴 것.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'

export interface PatchRolldownWasmOptions {
  /**
   * `WebAssembly.Memory` 의 initial 페이지 수 (1페이지 = 64 KiB).
   * 원본은 16384 (= 1 GiB). 예: 256 → 16 MiB.
   * 생략하면 원본 그대로 둔다.
   *
   * ⚠️ 실측상 이걸 낮춰도 메모리는 거의 안 준다 (1 GiB → 16 MiB 에 RSS -15 MB).
   * 641 MB 는 예약이 아니라 rolldown 이 실제로 만지는 양이다.
   */
  initialPages?: number
  /**
   * `WebAssembly.Memory` 의 maximum 페이지 수. 원본은 65536 (= 4 GiB = wasm32
   * 주소공간 전체).
   *
   * **iOS Safari 는 `initial` 이 아니라 `maximum` 을 보고 초기화 단계에서 거부한다.**
   * maximum 2048 MB 로 OOM 이 나고 256 MB 로 낮추면 해결된다는 보고가 있다
   * (godotengine/godot#70621). 데스크톱에서는 주소공간 예약이라 사실상 공짜지만
   * iOS 에서는 아니다.
   *
   * ⚠️ 낮추면 그 이상으로 grow 할 수 없다. rolldown 은 실측상 ~600 MB 를 쓰므로
   * 너무 낮추면 빌드 중에 죽는다.
   */
  maximumPages?: number
  /**
   * emnapi async work 워커 수. 원본은 4.
   * **0 이하면 워커 풀 없이 메인 스레드에서 돈다.**
   * 생략하면 원본 그대로 둔다.
   */
  asyncWorkPoolSize?: number
  /**
   * `WebAssembly.Memory` 의 `shared`. 원본은 true.
   *
   * **끌 수 없다.** rolldown 의 wasm 은 `wasi.thread-spawn` 을 import 하도록
   * 컴파일돼 있어서(= 스레드를 쓴다) 공유 메모리가 스펙상 강제된다.
   * false 로 두면 링크 단계에서 실패한다. 이 옵션은 그걸 **증명하기 위해** 있다.
   */
  shared?: boolean
}

/** 최소 Vite 플러그인 형태. */
export interface PatchRolldownWasmPlugin {
  name: string
  enforce: 'pre'
  load(id: string): string | undefined
}

/**
 * `rolldown-binding.wasi-browser.js` 를 패치해서 로드한다.
 *
 * `nodeShimAlias()` 가 이미 wasi 바인딩을 이 파일로 몰아주므로, 여기서 내용을
 * 가로채 숫자만 바꿔치기하면 된다.
 *
 * ⚠️ **`worker.plugins` 에도 반드시 넣어야 한다.** Vite 의 워커 번들은 플러그인
 * 파이프라인이 별도다. `plugins` 에만 넣으면 조용히 아무 일도 안 일어나고
 * 원본 값이 그대로 번들된다 (이걸로 한참 헛돌았다 — 스윕 결과가 전부 같은
 * 빌드를 재고 있었다).
 *
 * ```ts
 * const patch = () => patchRolldownWasm({ maximumPages: 4096 })
 * export default {
 *   plugins: [patch()],
 *   worker: { plugins: () => [patch()] },   // ← 이게 없으면 무효
 * }
 * ```
 */
export function patchRolldownWasm(
  options: PatchRolldownWasmOptions = {},
): PatchRolldownWasmPlugin {
  const req = createRequire(import.meta.url)
  const distDir = dirname(req.resolve('@rolldown/browser/package.json')) + '/dist'
  const target = `${distDir}/rolldown-binding.wasi-browser.js`

  return {
    name: 'browser-webapp-runtime:patch-rolldown-wasm',
    enforce: 'pre',
    load(id: string) {
      if (id.split('?')[0] !== target) return undefined
      let src = readFileSync(target, 'utf8')

      if (options.initialPages != null) {
        const before = src
        src = src.replace(/initial:\s*\d+/, `initial: ${options.initialPages}`)
        if (src === before) {
          throw new Error(
            'patchRolldownWasm: `initial: <숫자>` 를 찾지 못했습니다. ' +
              '@rolldown/browser 의 부트스트랩 형태가 바뀐 것 같습니다.',
          )
        }
      }

      if (options.maximumPages != null) {
        const before = src
        src = src.replace(/maximum:\s*\d+/, `maximum: ${options.maximumPages}`)
        if (src === before) {
          throw new Error(
            'patchRolldownWasm: `maximum: <숫자>` 를 찾지 못했습니다. ' +
              '@rolldown/browser 의 부트스트랩 형태가 바뀐 것 같습니다.',
          )
        }
      }

      if (options.shared != null) {
        const before = src
        src = src.replace(/shared:\s*(true|false)/, `shared: ${options.shared}`)
        if (src === before) throw new Error('patchRolldownWasm: `shared:` 를 찾지 못했습니다.')
      }

      if (options.asyncWorkPoolSize != null) {
        const before = src
        src = src.replace(
          /asyncWorkPoolSize:\s*-?\d+/,
          `asyncWorkPoolSize: ${options.asyncWorkPoolSize}`,
        )
        if (src === before) {
          throw new Error(
            'patchRolldownWasm: `asyncWorkPoolSize: <숫자>` 를 찾지 못했습니다. ' +
              '@rolldown/browser 의 부트스트랩 형태가 바뀐 것 같습니다.',
          )
        }
      }

      return src
    },
  }
}
