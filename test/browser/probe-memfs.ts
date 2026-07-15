// memfs 가 브라우저 번들에서 실제로 뭘 주는지 확인한다.
// memfs 는 `module.exports = { ...module.exports, ...exports.fs }` 로 재할당하는
// CJS 라서 번들러 인터롭에 따라 결과가 달라진다.
import '../../src/shims/process.ts'
import * as ns from 'memfs'
import def from 'memfs'

interface Row {
  name: string
  ok: boolean
  detail: string
}

const rows: Row[] = []
const probe = (name: string, fn: () => unknown) => {
  try {
    rows.push({ name, ok: true, detail: String(fn()).slice(0, 150) })
  } catch (e) {
    rows.push({ name, ok: false, detail: String((e as Error)?.message).slice(0, 150) })
  }
}

probe('import * as ns — keys', () => Object.keys(ns).sort().join(','))
probe('ns.fs 타입', () => typeof (ns as any).fs)
probe('ns.Volume 타입', () => typeof (ns as any).Volume)
probe('ns.createFsFromVolume 타입', () => typeof (ns as any).createFsFromVolume)
probe('default import 타입', () => typeof def)
probe('default 의 keys (앞 12개)', () => Object.keys(def ?? {}).slice(0, 12).join(','))
probe('ns.readFileSync 타입 (스프레드로 최상위에 올라왔나)', () => typeof (ns as any).readFileSync)

// 진짜 목표: 우리 소유의 Volume 을 만들 수 있는가
probe('new Volume() + createFsFromVolume() 왕복', () => {
  const V = (ns as any).Volume ?? (def as any)?.Volume
  const mk = (ns as any).createFsFromVolume ?? (def as any)?.createFsFromVolume
  if (!V || !mk) throw new Error(`Volume=${typeof V} createFsFromVolume=${typeof mk}`)
  const vol = new V()
  const fs = mk(vol)
  fs.mkdirSync('/app', { recursive: true })
  fs.writeFileSync('/app/a.txt', 'hello from memfs')
  return 'readback: ' + fs.readFileSync('/app/a.txt', 'utf8')
})

;(self as unknown as Worker).postMessage(rows)
