/**
 * `node:child_process` 셤.
 *
 * 브라우저엔 프로세스가 없다. 하지만 **빈 객체로 스텁하면 안 된다** — Vite 가
 * 모듈 최상단에서 이렇게 하기 때문이다:
 *
 *     const execFileAsync = promisify(childProcess.execFile)
 *
 * `execFile` 이 undefined 면 import 시점에 바로 죽는다:
 *
 *     TypeError: The "original" argument must be of type Function at promisify
 *
 * 그래서 **함수이긴 하되 호출되면 실패하는** 형태로 준다. 콜백 규약을 지켜서
 * (마지막 인자가 함수면 err 로 호출) promisify 로 감싼 쪽도 정상적으로
 * reject 되게 한다.
 *
 * Vite 가 execFile 을 실제로 부르는 경로는 git 조회 등 부수적인 것들이라
 * 여기서 실패해도 dev server 자체는 뜬다.
 */
function notSupported(name: string) {
  return (...args: unknown[]): never | void => {
    const cb = args[args.length - 1]
    const err = new Error(
      `child_process.${name} 는 브라우저에서 지원되지 않습니다`,
    ) as Error & { code: string }
    err.code = 'ENOSYS'
    if (typeof cb === 'function') {
      ;(cb as (e: Error) => void)(err)
      return
    }
    throw err
  }
}

export const execFile = notSupported('execFile')
export const exec = notSupported('exec')
export const spawn = notSupported('spawn')
export const fork = notSupported('fork')

export const execFileSync = (): never => {
  throw new Error('child_process.execFileSync 는 브라우저에서 지원되지 않습니다')
}
export const execSync = (): never => {
  throw new Error('child_process.execSync 는 브라우저에서 지원되지 않습니다')
}
export const spawnSync = (): { status: number; stdout: string; stderr: string } => ({
  status: 1,
  stdout: '',
  stderr: 'child_process.spawnSync 는 브라우저에서 지원되지 않습니다',
})

export default { execFile, exec, spawn, fork, execFileSync, execSync, spawnSync }
