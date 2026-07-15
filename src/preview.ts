/**
 * 페이지 쪽 — Service Worker 를 등록하고, 워커의 Vite 와 iframe 을 잇는다.
 *
 * ## 왜 페이지가 중계하나
 *
 * Service Worker 는 dedicated worker 와 **직접 대화할 수 없다.** 그래서:
 *
 * ```
 * iframe fetch → SW → 페이지(여기) → 워커(Vite) → 역순 반환
 * ```
 *
 * ## 사용
 *
 * ```ts
 * import { createPreview } from '@rycont/web-toolchain-in-browser/preview'
 *
 * const preview = await createPreview({
 *   worker: new Worker(new URL('./my-worker.ts', import.meta.url), { type: 'module' }),
 *   swUrl: new URL('./my-sw.js', import.meta.url),
 *   iframe: document.querySelector('iframe'),
 * })
 * await preview.load()          // iframe 에 앱을 띄운다
 * await preview.reload()        // 파일을 고친 뒤 다시 그린다
 * ```
 *
 * ⚠️ **HTTPS(또는 localhost)에서만 동작한다.** COOP/COEP 로 crossOriginIsolated 를
 * 켜야 SharedArrayBuffer 가 생기고, 그게 없으면 rolldown 의 wasm 이 초기화 단계에서
 * 죽는다. `http://192.168.x.x` 는 secure context 가 아니라서 안 된다.
 */

/**
 * 프리뷰 경로 접두사.
 *
 * ⚠️ `sw.ts` 에 같은 값이 복제돼 있다. SW 는 독립 스크립트여야 해서
 * (import 가 있으면 classic worker 로 등록이 안 된다) 공유하지 못한다.
 */
export const PREVIEW_PREFIX = '/preview'

export interface CreatePreviewOptions {
  /** Vite 를 들고 있는 워커. */
  worker: Worker
  /** Service Worker 스크립트 URL. */
  swUrl: string | URL
  /** 앱을 띄울 iframe. */
  iframe: HTMLIFrameElement
  /** SW 스코프. 기본 `/`. 서버가 `Service-Worker-Allowed: /` 를 보내야 한다. */
  scope?: string
}

export interface Preview {
  /** iframe 에 앱을 띄운다. load 이벤트까지 기다린다. */
  load(path?: string): Promise<void>
  /** 다시 그린다. 파일을 고친 뒤 부른다 (HMR 대신). */
  reload(): Promise<void>
  /** 현재 iframe 의 contentWindow. */
  readonly iframe: HTMLIFrameElement
}

/** 런타임이 이 브라우저에서 돌 수 있는지. 안 되면 이유를 돌려준다. */
export function explainUnsupported(): string | null {
  if (typeof SharedArrayBuffer === 'undefined' || !globalThis.crossOriginIsolated) {
    return (
      'SharedArrayBuffer 를 쓸 수 없습니다. ' +
      'HTTPS(또는 localhost)에서 열고, 서버가 아래 헤더를 보내야 합니다:\n' +
      '  Cross-Origin-Opener-Policy: same-origin\n' +
      '  Cross-Origin-Embedder-Policy: require-corp'
    )
  }
  if (typeof Worker === 'undefined') return '이 환경에는 Worker 가 없습니다.'
  if (!('serviceWorker' in navigator)) return '이 환경에는 Service Worker 가 없습니다.'
  try {
    new WebAssembly.Memory({ initial: 1, maximum: 2, shared: true })
  } catch {
    return '공유 WebAssembly.Memory 를 만들 수 없습니다.'
  }
  return null
}

/**
 * SW 를 등록하고 페이지 ↔ 워커 중계를 건다.
 *
 * @throws 지원되지 않는 환경이면 이유를 담아 throw 한다.
 */
export async function createPreview(options: CreatePreviewOptions): Promise<Preview> {
  const unsupported = explainUnsupported()
  if (unsupported) throw new Error(unsupported)

  const { worker, swUrl, iframe, scope = '/' } = options

  // ⚠️ 중계를 **먼저** 건다. SW 가 활성화된 직후 요청이 올 수 있다.
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type !== 'vite-request') return
    worker.postMessage(e.data, [e.ports[0]])
  })

  await navigator.serviceWorker.register(swUrl, { scope })
  await navigator.serviceWorker.ready
  // 첫 로드에는 컨트롤러가 없다 — 잡힐 때까지 기다린다.
  // 이걸 안 기다리면 iframe 요청이 SW 를 안 거치고 origin 으로 새서 404 가 난다.
  if (!navigator.serviceWorker.controller) {
    await new Promise<void>((r) =>
      navigator.serviceWorker.addEventListener('controllerchange', () => r(), { once: true }),
    )
  }

  const load = (path = '/index.html'): Promise<void> => {
    const done = new Promise<void>((r) =>
      iframe.addEventListener('load', () => r(), { once: true }),
    )
    iframe.src = `${PREVIEW_PREFIX}${path.startsWith('/') ? path : '/' + path}`
    return done
  }

  return {
    iframe,
    load,
    reload() {
      const done = new Promise<void>((r) =>
        iframe.addEventListener('load', () => r(), { once: true }),
      )
      // src 를 다시 세팅한다. 캐시를 타지 않게 쿼리를 흔든다.
      const base = (iframe.src || `${PREVIEW_PREFIX}/index.html`).split('?')[0]
      iframe.src = `${base}?t=${Date.now()}`
      return done
    },
  }
}
