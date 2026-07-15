# browser-webapp-runtime

Vite 8 툴체인을 **브라우저 워커 안에서** 돌린다. React / Tailwind / TypeScript 앱을
서버 없이 브라우저에서 개발·실행하는 것이 목표.

> **상태: 실험 중.** wasm 툴체인 셋은 브라우저에서 도는 것을 실측으로 확인했다.
> Vite 8 본체 부팅은 아직 뚫리지 않았다. 아래 "검증 현황" 참고.

## 왜 이게 가능해졌나

[browser-vite](https://www.npmjs.com/package/browser-vite) 는 2022년 4월 (Vite 2.7 기준)
이후로 멈춰 있다. 그때는 Vite 의 의존성이 60개에 esbuild 를 `child_process` 로 띄우는
구조라 포크가 불가피했다.

Vite 8 의 런타임 의존성은 **5개**고, 네이티브인 것들이 전부 공식 wasm 트윈을 갖고 있다:

| Vite 8 의존성 | 브라우저 대체재 | 비고 |
| --- | --- | --- |
| `rolldown@~1.1.4` | `@rolldown/browser` | 공식, 버전 일치, MIT |
| `lightningcss@^1.32.0` | `lightningcss-wasm` | 버전 일치 |
| `postcss`, `picomatch`, `tinyglobby` | 그대로 | 순수 JS |
| `fsevents` | — | optional, 제외 |
| `esbuild` | — | Vite 8 에선 peerDependency (선택) |

그래서 **포크가 아니라 alias + 셤 레이어**로 접근한다.

## 검증 현황

Chrome 149 / 워커 / COOP·COEP 적용 상태에서 실측:

| 항목 | 결과 |
| --- | --- |
| `crossOriginIsolated` / SAB / 중첩 Worker | ✅ 전부 true |
| `lightningcss-wasm` init + transform | ✅ `.a,.b{color:red}` (실제 최적화됨) |
| `@rolldown/browser` 번들 (가상 모듈) | ✅ `var v_entry_default = 42` (상수 접기까지) |
| `@tailwindcss/oxide-wasm32-wasi` 로드 | ✅ `Scanner, __fs, __volume` |
| memfs ↔ wasm(WASI) 파일시스템 통합 | ✅ `같은 볼륨인가? true` |
| **Vite 8 `createServer({ middlewareMode })`** | ✅ **부팅됨** |
| `pluginContainer.resolveId` | ✅ `/src/main.tsx` → `/app/src/main.tsx` |
| **`transformRequest('/src/main.tsx')`** | ✅ **`export const hello: string = "world"` → `export const hello = "world";`** |
| 플레인 CSS `transformRequest` | ✅ Vite CSS 파이프라인 정상 |
| Tailwind 플러그인 단독 (rolldown 없이) | ✅ 4,884바이트 CSS, `.flex`/`.bg-sky-500`/`.p-4` 생성 |
| Tailwind + rolldown 같은 워커 | ❌ **멈춤 — 현재 블로커 (emnapi 컨텍스트 충돌)** |
| React 앱 / iframe 서빙 | ⬜ 미착수 |

## 알아낸 것들

### SharedArrayBuffer 는 피할 수 없다 (Tailwind v4 를 쓰는 한)

wasm 빌드 툴체인에 따라 갈린다. napi-rs/emnapi 로 빌드된 Rust wasm 은 전부
`wasi.thread-spawn` 을 import 하고, 그건 공유 메모리를 스펙상 강제한다.

| 패키지 | 빌드 | 스레드 | SAB |
| --- | --- | --- | --- |
| `@rolldown/browser` (10.4M) | napi-rs/emnapi | `wasi.thread-spawn` | **필요** |
| `@oxc-transform/binding-wasm32-wasi` (3.2M) | napi-rs/emnapi | `wasi.thread-spawn` | **필요** |
| `@tailwindcss/oxide-wasm32-wasi` (1.7M) | napi-rs/emnapi | `wasi.thread-spawn` | **필요** |
| `esbuild-wasm` (14M) | Go | 없음 | 불필요 |
| `lightningcss-wasm` (16M) | wasm-bindgen | 없음 | 불필요 |

Vite 6 + esbuild-wasm 으로 내려가면 rolldown 쪽 SAB 요구는 사라지지만,
**Tailwind v4 의 oxide 가 혼자서 SAB 를 강제**하므로 Vite 버전과 무관하게 필요하다.
탈출구는 Tailwind v3(순수 JS) 뿐.

→ 결론: `Cross-Origin-Opener-Policy: same-origin` +
`Cross-Origin-Embedder-Policy: credentialless` 를 걸고 간다. 자체 도메인의
독립 앱이면 비용은 사실상 없다. 남의 사이트에 임베드해야 하면 얘기가 달라진다.

### 메모리: `initial: 16384` 는 겁줄 뿐 실제로 안 먹는다

`@rolldown/browser` 는 `new WebAssembly.Memory({ initial: 16384, maximum: 65536, shared: true })`
로 1 GiB 를 잡는 것처럼 보인다. 공유 메모리는 grow 시 이동이 불가능해서 주소공간을
미리 선점해야 하기 때문이고, napi-rs 템플릿은 "그럴 바엔 크게 잡고 grow 를 안 한다"를 택했다.

실측 (Node / V8):

```
1 GiB shared Memory 생성만  →  RSS +1.6 MB      (순수 주소공간 예약)
 16 MB 터치                 →  RSS  17.9 MB
256 MB 터치                 →  RSS 266.0 MB     (만진 만큼만 붙음)

dev 핫패스 (transform)      →  RSS ~130 MB
풀 프로덕션 번들 피크        →  RSS  287 MB      (2565 모듈 전부)
.tsx 1장 transform          →  0.06 ms          (200회 평균, wasm 경유)
풀 번들                     →  730 ms           (네이티브 250ms 대비 3배)
```

`initial` 은 lazy commit 되는 가상 주소공간이다. 1 GiB 를 태우지 않는다.
단 이 수치는 Node/V8 기준이며 브라우저(특히 Safari)의 wasm 메모리 정책은 다를 수 있다.

### `process` 셤은 최소로 — 순진한 셤이 없느니만 못하다

`version` / `versions.node` 를 넣으면 emnapi 가 Node 로 오인해서 `worker_threads`
경로를 타고 `TypeError: worker.on is not a function` → Rust 패닉으로 죽는다.
셤이 아예 없을 때보다 크게 터진다. `src/shims/process.ts` 주석 참고.

### Vite 8 이 실제로 쓰는 node API 는 이게 전부다

```
node:fs           default, `* as ns`, { existsSync, readFileSync }
node:fs/promises  default, { constants }
node:path         default, { basename, dirname, extname, isAbsolute, join,
                             normalize, posix, relative, resolve, sep }
node:events       { EventEmitter }
node:url          { URL, fileURLToPath, pathToFileURL }
node:util         { format, formatWithOptions, inspect, parseEnv, promisify,
                    stripVTControlCharacters }
node:perf_hooks   { performance }
node:module       { Module, builtinModules, createRequire }   ← 유일하게 껄끄러움
```

`node:http` / `node:net` / `node:tls` / `node:child_process` 는
`server.middlewareMode: true` 로 켜면 import 만 되고 호출되지 않는다.
`middlewareMode` 는 원래 Express 에 Vite 를 끼워넣으라고 있는 옵션이고,
켜면 Vite 가 http 서버를 만들지 않는다.

### Vite 의 node 빌트인 스텁은 조용히 거짓말한다

```js
//#region __vite-browser-external
var require___vite_browser_external = __commonJSMin((exports, module) => {
  module.exports = {};        // ← 빈 객체. 던지지 않는다
});
```

빌드는 통과하고 런타임에 `fs.readFileSync is not a function` 으로 터진다.
**빌드 성공은 아무것도 보장하지 않는다.**

### alias 순서 — `node:fs` 가 `node:fs/promises` 를 삼킨다

Vite 의 문자열 alias 는 접두사 매칭이다. 긴 specifier 를 먼저 넣어야 한다.
`src/alias.ts` 가 이 순서를 지킨다.

### 의존성은 브라우저에서 resolve 하지 않는다

고정 패키지 셋을 쓰면 로컬에서 진짜 pnpm 이 269개를 2.5초에 resolve 한다.
그러면 resolver / semver / packument / peer deps / integrity / os·cpu 필터가 전부 사라진다.

크기 (React + Tailwind + Lucide + Recharts + TanStack Router + Radix + AI SDK):

```
node_modules (디스크)                  442 MB
tar.gz 가공 없음                        86 MB
tar.gz 가지치기 (툴체인·tfjs·맵 제외)    11 MB   ← memfs 스냅샷
optimizeDeps 프리번들                  0.9 MB gzip  ← dev 에서 브라우저가 받는 것
전체 앱 빌드 (다 import)               268 KB gzip
```

참고로 npm packument 는 `react` 하나가 gzip 1.15 MB 다. 브라우저에서 트리를 걸으면
30개 패키지에 30 MB 를 쓴다. 꼭 동적 resolve 가 필요해지면 jsDelivr 이
semver range 를 해석해준다 (`cdn.jsdelivr.net/npm/react@^19.0.0/package.json` → 1,248 B).

### Tailwind 의 `Scanner.scan()` 은 브라우저에서 **구조적으로 불가능**하다

`@tailwindcss/oxide-wasm32-wasi` 의 `scan()` 은 fs 를 걷느라 rayon 스레드를 띄운다.
napi-rs 의 wasi-browser 템플릿 구조상 두 컨텍스트 모두 막힌다:

```
메인 스레드 → RuntimeError: Atomics.wait cannot be called in this context
             (브라우저가 메인 스레드 블로킹을 금지)
워커       → 데드락
```

워커에서의 데드락은 이 구조 때문이다:

```js
// 부모 (tailwindcss-oxide.wasi-browser.js)
onCreateWorker() {
  const worker = new Worker(new URL('./wasi-worker-browser.mjs', import.meta.url), ...)
  worker.addEventListener('message', __wasmCreateOnMessageForFsProxy(__fs))  // 내 이벤트루프로 답하겠다
}
// 자식 (wasi-worker-browser.mjs)
const fs = createFsProxy(__memfsExported)   // fs 호출을 부모에게 postMessage
```

부모가 "내 이벤트루프로 자식의 fs 요청에 답하겠다" 고 등록해놓고 곧바로
`Atomics.wait()` 으로 그 이벤트루프를 멈춘다. **요구사항이 상호배타적이라 설정으로
풀리지 않는다.** 파일이 없으면 즉시 반환하고, 있으면 멈춘다.

**우회**: 데드락은 fs 를 걷는 `scan()` 에만 있다. `scanFiles(contents)` 는 내용을
직접 받으므로 fs 도 스레드도 안 건드리고 잘 돈다:

```
scanFiles() 반환: 8개 — bg-sky-500,class,flex,hi,items-center,p-4,rounded-lg,text-white
```

그래서 `src/tailwind.ts` 는 **fs 걷기를 JS 로 하고**(memfs 는 동기라 공짜다) 후보
추출만 wasm 에 맡긴 뒤 `tailwindcss` 의 `compile().build(candidates)` 로 CSS 를 만든다.
`@tailwindcss/vite` 와 `@tailwindcss/node` 를 통째로 대체한다.

### napi-rs wasi 모듈 두 개를 한 realm 에 올릴 수 없다 ← **현재 블로커**

`@rolldown/browser` 와 `@tailwindcss/oxide-wasm32-wasi` 는 **둘 다 같은 emnapi
전역 컨텍스트에 등록**하고 각자 1 GiB / 워커 4개를 잡는다:

```
rolldown-binding.wasi-browser.js   → getDefaultContext, initial: 16384, asyncWorkPoolSize: 4
tailwindcss-oxide.wasi-browser.js  → getDefaultContext, initial: 16384, asyncWorkPoolSize: 4
```

실측:

| 구성 | 결과 |
| --- | --- |
| oxide 단독 (Vite 없음) | ✅ `scanFiles()` 정상, 플러그인이 4,884바이트 CSS 생성 |
| oxide + rolldown 같은 워커 | ❌ 멈춤 |
| 플레인 CSS (Tailwind 미개입) | ✅ Vite CSS 파이프라인 자체는 멀쩡 |

즉 Tailwind 의 문제도, Vite CSS 의 문제도 아니고 **두 wasm 모듈의 공존** 문제다.

**다음 수순**: Tailwind 를 **별도 워커**로 분리하고 postMessage 로 통신한다.
Vite 의 transform 훅은 async 라 왕복이 자연스럽게 들어간다. realm 이 갈리면
emnapi 컨텍스트도 갈린다.

### `@tailwindcss/node` 는 버그라서 뺀 게 아니라 **Node 어댑터**라서 뺐다

```
registerHooks ×2   ← Node 의 ESM 로더 훅. 브라우저에 대응물이 없다
createRequire ×1   pathToFileURL ×2   require.cache ×1
```

Tailwind 의 순수 JS 코어는 `tailwindcss` 의 `compile(css, { loadStylesheet, loadModule })`
이고, 그 훅들이 곧 호스트를 꽂는 자리다. `@tailwindcss/node` 는 거기에 Node 를 꽂은 것이고
`src/tailwind.ts` 는 memfs 를 꽂은 것이다. 대체이지 우회가 아니다.

### `@rolldown/browser` 의 wasi-browser 는 워커를 상정하지 않는다

```js
// onCreateWorker 안
worker.addEventListener('message', (event) => {
  if (event.data?.type === 'error')
    window.dispatchEvent(new CustomEvent('napi-rs-worker-error', ...))  // 워커엔 window 가 없다
})
```

에러 보고 경로가 워커에서 터지므로 **진짜 에러가 `window is not defined` 로 가려진다.**
디버깅할 때 이걸 먼저 의심할 것.

### workerd 는 테스트 타깃이 될 수 없다

```json
{ "SharedArrayBuffer": "function",
  "WebAssembly.Memory shared:true": "OK",
  "Worker": "undefined" }
```

SAB 는 오히려 있다. 하지만 `Worker` 가 없어서 `wasi.thread-spawn` 이 불가능하고,
CF Workers 의 메모리 상한 128 MB 는 측정된 130–287 MB 와 맞지 않는다.
그리고 애초에 브라우저가 아니라서 초록불이 떠도 아무 보장이 없다.
테스트는 Playwright + 실제 Chrome 으로 한다 (`test/browser/`).

## 개발

```bash
npm install
npm run test:browser     # COOP/COEP 걸고 실제 Chrome 워커에서 검증
```

## 라이선스

MIT
