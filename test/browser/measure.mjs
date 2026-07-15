// 브라우저에서 이 런타임이 실제로 쓰는 CPU/메모리를 잰다.
//
// 세 각도에서 본다:
//   1. OS 레벨 RSS — Chrome 의 **모든 프로세스** 합. 사용자가 체감하는 진짜 숫자.
//   2. OS 레벨 CPU 시간 — utime+stime 합.
//   3. performance.measureUserAgentSpecificMemory() — JS/wasm 힙 내역.
//      crossOriginIsolated 가 필요한데 우리는 이미 켜져 있다.
//
// 기준선(빈 페이지)을 먼저 재고 델타를 본다 — Chrome 자체 오버헤드를 빼야
// "이 런타임의 비용" 이 나온다.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
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
    res.writeHead(404)
    return res.end('not found')
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(f)] ?? 'application/octet-stream',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Service-Worker-Allowed': '/',
  })
  fs.createReadStream(f).pipe(res)
})
await new Promise((r) => srv.listen(0, r))
const port = srv.address().port

const CLK = Number(execSync('getconf CLK_TCK').toString().trim()) || 100

/**
 * 이 브라우저가 띄운 모든 프로세스의 RSS 합(MB)과 CPU 시간(초).
 *
 * ⚠️ 프로세스 트리를 children 파일로 따라가면 안 된다 — google-chrome-stable 은
 * 래퍼 스크립트고 Chrome 은 렌더러/GPU/유틸리티를 전부 별도 프로세스로 띄우며
 * reparent 도 일어난다. Playwright 가 만든 **고유 user-data-dir** 로 매칭하는 게
 * 확실하다.
 *
 * RSS 는 **PSS(비례 배분)** 도 같이 본다. Chrome 프로세스들은 wasm 공유 메모리를
 * 공유하므로 RSS 를 단순 합산하면 중복 계산된다.
 */
function procStats(profileDir) {
  const pids = []
  for (const pid of fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    try {
      const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8')
      if (cmd.includes(profileDir)) pids.push(Number(pid))
    } catch {
      /* 죽은 프로세스 */
    }
  }
  let rssKb = 0
  let pssKb = 0
  let cpuTicks = 0
  let n = 0
  for (const pid of pids) {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8')
      // comm 에 공백/괄호가 있을 수 있으므로 마지막 ')' 뒤부터 자른다
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
      cpuTicks += Number(fields[11]) + Number(fields[12]) // utime + stime
      const statusRss = fs
        .readFileSync(`/proc/${pid}/status`, 'utf8')
        .match(/^VmRSS:\s+(\d+) kB$/m)
      if (statusRss) rssKb += Number(statusRss[1])
      // PSS = 공유 페이지를 프로세스 수로 나눠 배분한 값. 중복 계산을 막는다.
      try {
        const sm = fs.readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8')
        const pss = sm.match(/^Pss:\s+(\d+) kB$/m)
        if (pss) pssKb += Number(pss[1])
      } catch {
        /* smaps_rollup 없으면 무시 */
      }
      n++
    } catch {
      /* 죽은 프로세스 */
    }
  }
  return { rssMb: rssKb / 1024, pssMb: pssKb / 1024, cpuSec: cpuTicks / CLK, procs: n }
}

// 우리 것만 확실히 세기 위해 고유한 user-data-dir 을 직접 준다
const PROFILE = `/tmp/bwr-measure-${Date.now()}`
const browser = await chromium.launchPersistentContext(PROFILE, {
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox'],
})

// ── 1) 기준선: 빈 페이지 ─────────────────────────────────────────────────
const blank = await browser.newPage()
await blank.goto('about:blank')
await new Promise((r) => setTimeout(r, 2000))
const base = procStats(PROFILE)
console.log('=== 기준선 (빈 Chrome) ===')
console.log(`  프로세스 ${base.procs}개 | RSS ${base.rssMb.toFixed(0)} MB | PSS ${base.pssMb.toFixed(0)} MB | CPU ${base.cpuSec.toFixed(1)}초`)

// ── 2) 런타임을 띄운다 ───────────────────────────────────────────────────
const page = await browser.newPage()
await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' })
await page.waitForFunction('window.__done', null, { timeout: 180_000 })
const frame = page.frames().find((f) => f.url().includes('/preview'))
await frame?.waitForSelector('[data-testid="list"] li', { timeout: 60_000 })
await new Promise((r) => setTimeout(r, 1500)) // 정착

const after = procStats(PROFILE)
console.log('\n=== Todo 앱 렌더 완료 후 ===')
console.log(`  프로세스 ${after.procs}개 | RSS ${after.rssMb.toFixed(0)} MB | PSS ${after.pssMb.toFixed(0)} MB | CPU ${after.cpuSec.toFixed(1)}초`)
console.log('\n=== 이 런타임의 비용 (델타) ===')
console.log(`  RSS  +${(after.rssMb - base.rssMb).toFixed(0)} MB   (실제 물리 메모리)`)
console.log(`  PSS  +${(after.pssMb - base.pssMb).toFixed(0)} MB   (공유분 배분)`)
console.log(`  CPU  +${(after.cpuSec - base.cpuSec).toFixed(1)}초  (전체 코어 합산)`)
console.log(`  프로세스 +${after.procs - base.procs}개`)

// ── 3) 브라우저 내부 시선: 힙 내역 ───────────────────────────────────────
try {
  const mem = await page.evaluate(async () => {
    if (!performance.measureUserAgentSpecificMemory) return null
    const m = await performance.measureUserAgentSpecificMemory()
    return {
      total: m.bytes,
      breakdown: m.breakdown
        .filter((b) => b.bytes > 0)
        .map((b) => ({ bytes: b.bytes, types: b.types, scope: b.attribution?.[0]?.scope }))
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, 6),
    }
  })
  if (mem) {
    console.log('\n=== measureUserAgentSpecificMemory (JS/wasm 힙) ===')
    console.log(`  총 ${(mem.total / 1048576).toFixed(0)} MB`)
    for (const b of mem.breakdown) {
      console.log(`    ${(b.bytes / 1048576).toFixed(1).padStart(6)} MB  ${b.types?.join(',') ?? '?'}  ${b.scope ?? ''}`)
    }
  } else {
    console.log('\n(measureUserAgentSpecificMemory 미지원)')
  }
} catch (e) {
  console.log('\n힙 측정 실패:', String(e.message).slice(0, 120))
}

// ── 4) 유휴 상태 CPU — 렌더 후에도 계속 태우는지 ─────────────────────────
const idle0 = procStats(PROFILE)
await new Promise((r) => setTimeout(r, 5000))
const idle1 = procStats(PROFILE)
console.log('\n=== 유휴 5초 동안 ===')
console.log(`  CPU +${(idle1.cpuSec - idle0.cpuSec).toFixed(2)}초  (0 에 가까워야 정상)`)
console.log(`  RSS ${idle1.rssMb.toFixed(0)} MB (변화 ${(idle1.rssMb - idle0.rssMb).toFixed(0)} MB)`)

await browser.close()
srv.close()
