// @tailwindcss/oxide-wasm32-wasi 는 package.json 에 `cpu: ["wasm32"]` 이 박혀 있어서
// npm 이 EBADPLATFORM 으로 설치를 거부한다 (x64 머신에서). `--cpu=wasm32` 플래그도
// optional deps 해석에만 먹고 직접 설치엔 안 통한다.
//
// npm 에는 `os: ["browser"]` 같은 개념이 없다. 브라우저를 타깃으로 하는 네이티브
// 패키지를 설치하는 표준 경로가 존재하지 않는다는 뜻이고, 이건 이 프로젝트가
// 앞으로도 계속 부딪힐 종류의 마찰이다.
//
// 그래서 tarball 을 직접 받아 node_modules 에 푼다.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const PKG = '@tailwindcss/oxide-wasm32-wasi'
const VERSION = process.env.OXIDE_WASI_VERSION ?? '4.3.2'
const dest = join('node_modules', '@tailwindcss', 'oxide-wasm32-wasi')

if (existsSync(join(dest, 'package.json'))) {
  console.log(`${PKG} 이미 있음 — 건너뜀`)
  process.exit(0)
}

console.log(`${PKG}@${VERSION} 받는 중 (npm 의 cpu 검사 우회)…`)
execFileSync('npm', ['pack', `${PKG}@${VERSION}`, '--silent'], { stdio: 'inherit' })

const tgz = readdirSync('.').find((f) => f.startsWith('tailwindcss-oxide-wasm32-wasi-') && f.endsWith('.tgz'))
if (!tgz) throw new Error('npm pack 산출물을 찾지 못함')

mkdirSync(dest, { recursive: true })
execFileSync('tar', ['xzf', tgz, '--strip-components=1', '-C', dest], { stdio: 'inherit' })
rmSync(tgz)

console.log(`${PKG} → ${dest} 준비 완료`)
