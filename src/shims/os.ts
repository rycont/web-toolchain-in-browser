/**
 * `node:os` 셤. 브라우저에서 의미 있는 값만 최소로 준다.
 *
 * Vite 는 주로 tmpdir / homedir / platform / EOL / cpus().length (병렬도 결정) 를 쓴다.
 */
export const EOL = '\n'
export const platform = (): string => 'browser'
export const type = (): string => 'Browser'
export const arch = (): string => 'wasm32'
export const release = (): string => '0.0.0'
export const homedir = (): string => '/home'
export const tmpdir = (): string => '/tmp'
export const endianness = (): string => 'LE'
export const hostname = (): string => 'localhost'

/** navigator.hardwareConcurrency 를 코어 수로 쓴다. Vite 가 병렬도 산정에 쓴다. */
export const cpus = (): Array<{ model: string; speed: number }> => {
  const n = globalThis.navigator?.hardwareConcurrency ?? 4
  return Array.from({ length: n }, () => ({ model: 'wasm', speed: 0 }))
}

export const totalmem = (): number => 4 * 1024 * 1024 * 1024
export const freemem = (): number => 2 * 1024 * 1024 * 1024
export const availableParallelism = (): number =>
  globalThis.navigator?.hardwareConcurrency ?? 4
export const networkInterfaces = (): Record<string, unknown[]> => ({})
export const userInfo = (): { username: string; homedir: string } => ({
  username: 'browser',
  homedir: '/home',
})

export default {
  EOL, platform, type, arch, release, homedir, tmpdir, endianness, hostname,
  cpus, totalmem, freemem, availableParallelism, networkInterfaces, userInfo,
}
