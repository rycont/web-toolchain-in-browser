// COOP/COEP 헤더를 걸고 실제 Chrome 에서 test/browser/worker.ts 를 돌린 뒤,
// Service Worker 를 통해 iframe 에 서빙된 Todo 앱을 검증하고 스크린샷을 남긴다.
//
// workerd 는 `Worker` 가 없어서 wasi.thread-spawn 이 불가능하므로 쓸 수 없다.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const DIST = path.join(import.meta.dirname, 'dist')
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
  '.css': 'text/css',
}

const srv = http.createServer((req, res) => {
  const rel = req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0])
  const f = path.join(DIST, rel)
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    console.log('  [404]', req.url)
    res.writeHead(404)
    return res.end('not found')
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(f)] ?? 'application/octet-stream',
    // 이 두 줄이 SharedArrayBuffer 를 켠다. rolldown 이 wasi.thread-spawn 을
    // 쓰므로 없으면 초기화 자체가 실패한다.
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'same-origin',
    // SW 를 루트 스코프로 등록하려면 필요
    'Service-Worker-Allowed': '/',
  })
  fs.createReadStream(f).pipe(res)
})

await new Promise((r) => srv.listen(0, r))
const port = srv.address().port

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox'],
})
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)))
page.on('console', (m) => {
  if (process.env.VERBOSE || m.type() === 'error') {
    console.log(`  [${m.type()}]`, m.text().slice(0, 200))
  }
})

// ── 실제로 받은 리소스 기록 (크기는 dist 에서 잰다 — 스트리밍이라 content-length 없음) ──
const fetched = new Set()
page.on('response', (r) => {
  const u = new URL(r.url())
  if (u.origin === `http://localhost:${port}`) fetched.add(u.pathname)
})

const T0 = Date.now()
await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' })
const out = await page
  .waitForFunction('window.__done', null, { timeout: 180_000 })
  .then((h) => h.jsonValue())
  .catch((e) => [{ name: 'TIMEOUT', ok: false, detail: String(e.message).slice(0, 120) }])

console.log('\n=== Chrome / worker / COOP+COEP ===')
let failed = 0
for (const r of out) {
  if (!r.ok) failed++
  const ms = r.ms != null ? String(r.ms).padStart(6) + 'ms  ' : '          '
  console.log(`${r.ok ? '  PASS' : '  FAIL'}  ${ms}${r.name}`)
}

// ── iframe 검증: Todo 앱이 실제로 렌더되고 Tailwind 로 스타일됐는가 ──────────
console.log('\n=== iframe (Service Worker → 워커의 Vite) ===')
const frame = page.frames().find((f) => f.url().includes('/preview'))
if (!frame) {
  console.log('  FAIL  iframe 이 /preview 를 로드하지 않음')
  failed++
} else {
  try {
    await frame.waitForSelector('[data-testid="list"] li', { timeout: 60_000 })
    const info = await frame.evaluate(() => {
      const btn = document.querySelector('[data-testid="add"]')
      const card = document.querySelector('.rounded-2xl')
      const cs = btn ? getComputedStyle(btn) : null
      return {
        items: document.querySelectorAll('[data-testid="list"] li').length,
        remaining: document.querySelector('[data-testid="remaining"]')?.textContent,
        // Tailwind 가 실제로 먹었는지 = computed style 로 확인
        btnBg: cs?.backgroundColor,
        btnRadius: cs?.borderRadius,
        cardShadow: card ? getComputedStyle(card).boxShadow.slice(0, 30) : null,
        bodyBg: getComputedStyle(document.body).backgroundColor,
      }
    })
    console.log(`  렌더된 항목 수 : ${info.items}`)
    console.log(`  남은 개수 표시 : ${info.remaining}`)
    console.log(`  버튼 배경      : ${info.btnBg}   (bg-sky-500)`)
    console.log(`  버튼 radius    : ${info.btnRadius}`)
    console.log(`  카드 그림자    : ${info.cardShadow}`)

    const styled = info.btnBg && info.btnBg !== 'rgba(0, 0, 0, 0)' && info.btnRadius !== '0px'
    if (info.items === 3 && styled) {
      console.log('  PASS  Todo 앱이 렌더되고 Tailwind 스타일이 적용됨')
    } else {
      console.log('  FAIL  렌더 또는 스타일 미적용')
      failed++
    }

    // 상호작용까지 확인 — 진짜 React 가 도는가
    await frame.fill('[data-testid="input"]', '브라우저에서 추가한 항목')
    await frame.click('[data-testid="add"]')
    await frame.waitForFunction(
      () => document.querySelectorAll('[data-testid="list"] li').length === 4,
      null,
      { timeout: 10_000 },
    )
    console.log('  PASS  React 상호작용 동작 (항목 추가됨)')
    console.log(`\n  ⏱  페이지 열기 → Todo 앱 렌더 완료: ${((Date.now() - T0) / 1000).toFixed(1)}초`)
  } catch (e) {
    console.log('  FAIL  iframe 검증:', String(e.message).slice(0, 200))
    failed++
  }
}

await page.screenshot({ path: path.join(import.meta.dirname, 'screenshot.png'), fullPage: true })
// 다운로드 내역 — 실제로 브라우저가 받은 것만
import { gzipSync } from 'node:zlib'
const rows = []
for (const p of fetched) {
  const f = path.join(DIST, p === '/' ? 'index.html' : p)
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) continue
  const buf = fs.readFileSync(f)
  rows.push([p, buf.length, gzipSync(buf).length])
}
rows.sort((a, b) => b[2] - a[2])
const raw = rows.reduce((a, r) => a + r[1], 0)
const gz = rows.reduce((a, r) => a + r[2], 0)
console.log(`\n=== 툴체인 다운로드 (${rows.length}개 파일) ===`)
console.log(`  비압축 ${(raw / 1048576).toFixed(1)} MB  →  gzip ${(gz / 1048576).toFixed(1)} MB`)
for (const [p, r, g] of rows.slice(0, 5)) {
  console.log(`    ${(g / 1048576).toFixed(2).padStart(6)} MB gz  (${(r / 1048576).toFixed(1)} MB raw)  ${p}`)
}

console.log('\n스크린샷: test/browser/screenshot.png')

await browser.close()
srv.close()
process.exit(failed > 0 ? 1 : 0)
