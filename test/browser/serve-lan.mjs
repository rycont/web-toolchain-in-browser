// 실기기(안드로이드 태블릿, 삼성 인터넷 등)에서 열어볼 수 있게 LAN 에 HTTPS 로 띄운다.
//
// ⚠️ **왜 HTTPS 여야 하나** — COOP/COEP 로 crossOriginIsolated 를 켜려면
// **secure context** 여야 한다. `http://192.168.x.x` 는 secure context 가 아니므로
// SharedArrayBuffer 가 안 켜지고, rolldown 의 wasm 이 초기화 단계에서 실패한다.
// (localhost 는 예외적으로 secure context 라 개발 중엔 문제가 안 보인다.)
//
// 자체 서명 인증서를 쓰므로 기기에서 "안전하지 않음" 경고가 뜬다. 통과하면
// secure context 로 취급되어 SAB 가 켜진다.
//
//   node test/browser/serve-lan.mjs
//
// 그 다음 태블릿에서 출력된 https://<IP>:8443 을 열고 경고를 통과하면 된다.
// 페이지 상단에 진단 결과가 뜬다.
import https from 'node:https'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const DIST = path.join(import.meta.dirname, 'dist')
const CERT_DIR = path.join(import.meta.dirname, '.cert')
const KEY = path.join(CERT_DIR, 'key.pem')
const CRT = path.join(CERT_DIR, 'cert.pem')
const PORT = Number(process.env.PORT ?? 8443)

if (!fs.existsSync(DIST)) {
  console.error('먼저 빌드하세요: npx vite build -c test/browser/vite.config.ts')
  process.exit(1)
}

/** LAN 에서 접근 가능한 IPv4 주소들. */
function lanIps() {
  const out = []
  for (const [, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address)
    }
  }
  return out
}

// 자체 서명 인증서 — SAN 에 LAN IP 를 다 넣어야 기기에서 통과시킬 수 있다
if (!fs.existsSync(CRT)) {
  fs.mkdirSync(CERT_DIR, { recursive: true })
  const san = ['DNS:localhost', 'IP:127.0.0.1', ...lanIps().map((ip) => `IP:${ip}`)].join(',')
  console.log('자체 서명 인증서 생성 중… SAN:', san)
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', KEY, '-out', CRT, '-days', '365',
    '-subj', '/CN=web-toolchain-in-browser',
    '-addext', `subjectAltName=${san}`,
  ], { stdio: 'inherit' })
}

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
  '.css': 'text/css',
}

https
  .createServer({ key: fs.readFileSync(KEY), cert: fs.readFileSync(CRT) }, (req, res) => {
    const rel = req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0])
    const f = path.join(DIST, rel)
    if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404)
      return res.end('not found')
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(f)] ?? 'application/octet-stream',
      // 이 두 줄 + HTTPS 가 있어야 crossOriginIsolated 가 켜진다
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Service-Worker-Allowed': '/',
    })
    fs.createReadStream(f).pipe(res)
  })
  .listen(PORT, '0.0.0.0', () => {
    console.log('\n태블릿/폰에서 아래 주소를 여세요 (인증서 경고는 통과):\n')
    for (const ip of lanIps()) console.log(`    https://${ip}:${PORT}/`)
    console.log('\n페이지 상단에 진단이 뜹니다. Ctrl+C 로 종료.\n')
  })
