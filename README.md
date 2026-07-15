# web-toolchain-in-browser

[![JSR](https://jsr.io/badges/@rycont/web-toolchain-in-browser)](https://jsr.io/@rycont/web-toolchain-in-browser)

Vite 8 + React + Tailwind v4 + TypeScript 앱을 **브라우저 안에서** 빌드하고 돌린다.
서버 없음.

평범한 Vite 프로젝트를 **한 글자도 안 고치고** 그대로 쓴다. 콜드 스타트 1.6초,
파일 수정 반영 약 200ms.

## 요구사항

**COOP/COEP 헤더가 반드시 필요하다.** 없으면 아무것도 안 돈다 — rolldown 의 wasm 이
SharedArrayBuffer 를 요구하고, 그건 cross-origin isolated 상태에서만 생긴다.

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Service-Worker-Allowed: /
```

**HTTPS(또는 localhost)여야 한다.** `http://192.168.x.x` 는 secure context 가 아니라서
헤더를 보내도 소용없다.

| | |
| --- | --- |
| 데스크톱 Chrome / Edge | ✅ 검증됨 |
| 안드로이드 Chrome / 삼성 인터넷 15+ | 될 것으로 보임 (미검증) |
| iOS Safari | 어려울 것으로 보임 — [NOTES](https://github.com/rycont/web-toolchain-in-browser/blob/main/NOTES.md#메모리--node-에선-공짜지만-브라우저에선-아니다) |

메모리를 약 425 MB 쓴다 (PSS 기준). 데스크톱은 문제없다.

## 설치

```bash
npx jsr add @rycont/web-toolchain-in-browser

# peer dependencies — 직접 깔아야 한다
npm i -D vite@8 @rolldown/browser lightningcss-wasm tailwindcss@4 \
         memfs path-browserify events stream-browserify buffer util picomatch postcss
```

## 사용

파일 세 개가 필요하다: 워커, 페이지, Service Worker.

```ts
// worker.ts — Vite 가 여기서 돈다
import '@rycont/web-toolchain-in-browser/shims/globals' // ← Vite import 보다 먼저
import { createBrowserRuntime, serveWorker } from '@rycont/web-toolchain-in-browser/runtime'
import inlinedPackages from 'virtual:inlined-packages'
import vitePkg from 'vite/package.json'
import clientMjs from 'vite/dist/client/client.mjs?raw'
import envMjs from 'vite/dist/client/env.mjs?raw'

// ⚠️ serveWorker 앞에 await 가 있으면 안 된다 — 그 사이 온 요청이 유실된다
const ready = (async () => {
  const react = (await import('@vitejs/plugin-react')).default
  return createBrowserRuntime({
    files: { 'index.html': '…', 'src/main.tsx': '…', 'src/style.css': '@import "tailwindcss";' },
    packages: inlinedPackages, // react 등 — 앱이 import 하는 것들
    vite: { packageJson: vitePkg, clientMjs, envMjs },
    plugins: [react()], // Tailwind 는 자동으로 붙는다
  })
})()
serveWorker(ready)

const runtime = await ready
runtime.writeFile('src/App.tsx', code) // 편집 → 무효화까지 한 번에
```

```ts
// page.ts
import { createPreview, explainUnsupported } from '@rycont/web-toolchain-in-browser/preview'

const why = explainUnsupported()
if (why) throw new Error(why) // 지원 안 되면 이유를 알려준다

const preview = await createPreview({
  worker: new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
  swUrl: '/sw.js',
  iframe: document.querySelector('iframe'),
})
await preview.load()
await preview.reload() // 파일 고친 뒤
```

```js
// sw.js — 별도 엔트리로 빌드해 루트(/sw.js)에 둔다
import '@rycont/web-toolchain-in-browser/sw'
```

### 빌드 설정

```ts
// vite.config.ts
import { nodeShimAlias, nodeShimDefine } from '@rycont/web-toolchain-in-browser/alias'
import { inlinePackages } from '@rycont/web-toolchain-in-browser/inline-packages-plugin'

const APP_TREE = ['react', 'react-dom', 'scheduler', 'tailwindcss'] // 앱이 import 할 것들

export default {
  plugins: [inlinePackages(APP_TREE, import.meta.url)],
  // ⚠️ 워커 번들은 플러그인 파이프라인이 별도다. 여기 안 넣으면 조용히 안 먹는다.
  worker: { format: 'es', plugins: () => [inlinePackages(APP_TREE, import.meta.url)] },
  resolve: { alias: nodeShimAlias(), conditions: ['browser', 'import', 'default'] },
  define: nodeShimDefine(),
  build: {
    target: 'esnext',
    rolldownOptions: {
      input: { index: 'index.html', sw: 'sw.js' },
      // sw 는 /sw.js 로 고정 — new URL('./sw.js', import.meta.url) 은 쓰면 안 된다
      output: { entryFileNames: (c) => (c.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js') },
    },
  },
}
```

전체 예제는 [`test/browser/`](https://github.com/rycont/web-toolchain-in-browser/tree/main/test/browser) 참고.

## 개발

```bash
npm install
npm run test:browser   # COOP/COEP 걸고 실제 Chrome 에서 검증 + 스크린샷
npm run serve:lan      # LAN 에 HTTPS 로 띄운다 (실기기 확인용)
```

## 이게 어떻게 되는가

실측치와 함정들은 **[NOTES.md](https://github.com/rycont/web-toolchain-in-browser/blob/main/NOTES.md)** 에 있다 — SharedArrayBuffer 가 왜 필수인지,
Tailwind 의 oxide 를 왜 버렸는지, Vite 8 이 실제로 쓰는 node API 는 무엇인지 등.

## 라이선스

MIT
