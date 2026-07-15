/**
 * `lightningcss` → `lightningcss-wasm` 스왑 래퍼.
 *
 * **alias 만으로는 안 되는 대표 사례다.** 두 패키지의 API 가 다르다:
 *
 *     // 네이티브 lightningcss — 동기, init 개념 없음
 *     import { transform, Features } from 'lightningcss'
 *
 *     // lightningcss-wasm — 쓰기 전에 반드시 await init()
 *     export default async function init(input) { ... }
 *     export function transform(...)
 *
 * 그냥 `alias: { lightningcss: 'lightningcss-wasm' }` 로 두면 init 안 된 채
 * transform 이 불려서 터진다.
 *
 * 여기서는 **톱레벨 await** 로 init 을 끝내고 re-export 한다. 이 모듈이 평가되는
 * 동안 import 한 쪽이 블록되므로, 소비자가 transform 을 부를 시점엔 이미 준비돼
 * 있다. 즉 비동기 init 을 가진 wasm 을 "동기처럼 보이는 모듈" 로 포장하는 것이다.
 * @tailwindcss/node 는 자기가 wasm 을 쓰는지도 모른다.
 *
 * 이게 없으면 tailwind 가 이렇게 죽는다 — napi 로더가 `${platform}-${arch}` 로
 * 바이너리 이름을 만드는데 우리 process 셤이 platform='browser', arch='wasm32'
 * 이므로:
 *
 *     Error: Calling `require` for "../lightningcss.browser-wasm32.node" in an
 *     environment that doesn't expose the `require` function.
 */
// 전부 메인 엔트리에서 가져온다 — lightningcss-wasm 의 exports 맵은
// './flags.js' 같은 서브패스를 열어주지 않는다 (index.mjs 가 re-export 함).
import init, {
  Features,
  browserslistToTargets,
  bundle,
  bundleAsync,
  composeVisitors,
  transform,
  transformStyleAttribute,
} from 'lightningcss-wasm'
// .wasm 만은 exports 맵에 명시적으로 열려 있다
import wasmUrl from 'lightningcss-wasm/lightningcss_node.wasm?url'

// 톱레벨 await — 이 모듈을 import 하는 쪽은 여기가 끝날 때까지 블록된다.
// 그래서 아래 re-export 들은 항상 "이미 init 된" 상태로 쓰인다.
await init(wasmUrl)

export {
  bundle,
  bundleAsync,
  browserslistToTargets,
  composeVisitors,
  Features,
  transform,
  transformStyleAttribute,
}

export default {
  bundle,
  bundleAsync,
  browserslistToTargets,
  composeVisitors,
  Features,
  transform,
  transformStyleAttribute,
}
