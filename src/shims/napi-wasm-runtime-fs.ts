/**
 * `@napi-rs/wasm-runtime/fs` 스왑 — **파일시스템을 하나로 합친다.**
 *
 * 이걸 안 하면 파일시스템이 둘이 된다:
 *
 *   JS 쪽   : `import { fs } from 'memfs'`  — Vite 의 JS 코드가 읽는 곳
 *   wasm 쪽 : @napi-rs/wasm-runtime/fs 가 `memfs()` 로 만든 **별개의 새 볼륨**
 *             — rolldown 의 oxc-resolver(Rust) 가 WASI 로 읽는 곳
 *
 * 원본 rolldown-binding.wasi-browser.js:
 *
 *     import { memfs } from '@napi-rs/wasm-runtime/fs'
 *     export const { fs: __fs, vol: __volume } = memfs()   // ← 새 볼륨
 *     const __wasi = new __WASI({ version: 'preview1', fs: __fs, preopens: { '/': '/' } })
 *
 * 그래서 프로젝트를 JS 쪽 memfs 에 심어도 Rust resolver 는 빈 볼륨을 본다:
 *
 *     pluginContainer.resolveId('/src/main.tsx') → undefined
 *     Error: Failed to load url /src/main.tsx (resolved id: /src/main.tsx). Does the file exist?
 *
 * 이 모듈은 `memfs()` 가 **우리 싱글턴 볼륨**을 돌려주게 해서 양쪽이 같은
 * 파일시스템을 보게 만든다.
 *
 * 참고 — 중첩 워커(wasi-worker-browser.mjs)는 별도 워커라 자기 모듈 인스턴스를
 * 갖는다. 거기서는 napi 의 fs 프록시(`createOnMessage...ForFsProxy`)가 메인
 * 스레드로 fs 호출을 넘기므로 결국 같은 볼륨에 도달한다.
 */
import * as memfsNamespace from 'memfs'
import { Volume, createFsFromVolume, fs, vol } from 'memfs'
import { Buffer } from './buffer.ts'

export { Buffer, Volume, createFsFromVolume, fs }

/** 원본은 매번 새 볼륨을 만든다. 우리는 공유 싱글턴을 돌려준다. */
export function memfs(): { fs: typeof memfsNamespace.fs; vol: typeof vol } {
  return { fs, vol }
}

/**
 * wasi-worker-browser.mjs 가 이렇게 쓴다:
 *
 *     import { memfsExported as __memfsExported } from '@napi-rs/wasm-runtime/fs'
 *     const fs = createFsProxy(__memfsExported)
 *
 * ⚠️ 여기는 **memfs 모듈 네임스페이스 전체**여야 한다. `{ fs, vol }` 을 주면
 * createFsProxy 가 감쌀 fs 메서드를 못 찾아 중첩 워커가 조용히 죽는다.
 * (memfs 는 `module.exports = { ...module.exports, ...exports.fs }` 로 fs API 를
 * 최상위에 펼쳐놓기 때문에 네임스페이스가 곧 fs 다.)
 */
export const memfsExported: typeof memfsNamespace = memfsNamespace

export default { Buffer, Volume, createFsFromVolume, fs, memfs, memfsExported }
