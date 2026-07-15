// COOP/COEP 헤더를 걸고 실제 Chrome 에서 test/browser/worker.ts 를 돌린다.
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
}

const srv = http.createServer((req, res) => {
  const rel = req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0])
  const f = path.join(DIST, rel)
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404)
    return res.end('not found')
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(f)] ?? 'application/octet-stream',
    // 이 두 줄이 SharedArrayBuffer 를 켠다. rolldown/oxc/tailwind-oxide 가
    // wasi.thread-spawn 을 쓰므로 없으면 초기화 자체가 실패한다.
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'same-origin',
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
page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 160)))

await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' })
const out = await page
  .waitForFunction('window.__done', null, { timeout: 90_000 })
  .then((h) => h.jsonValue())
  .catch((e) => [{ name: 'TIMEOUT', ok: false, detail: String(e.message).slice(0, 120) }])

console.log('\n=== Chrome / worker / COOP+COEP ===')
let failed = 0
for (const r of out) {
  if (!r.ok) failed++
  console.log(`${r.ok ? '  PASS' : '  FAIL'}  ${r.name}\n        ${r.detail}`)
}

await browser.close()
srv.close()
process.exit(failed > 0 ? 1 : 0)
