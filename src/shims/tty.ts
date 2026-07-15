/**
 * `node:tty` 셤.
 *
 * Vite 의 로거가 색상 지원을 판단하려고 `isatty(fd)` 를 부른다. 빈 객체로 스텁되면:
 *
 *     TypeError: (0, import___vite_browser_external.isatty) is not a function
 *       at useColors
 *
 * 브라우저엔 터미널이 없으므로 항상 false 다. (콘솔 색상이 필요하면 나중에
 * ANSI 대신 CSS `%c` 포맷으로 따로 다루는 게 맞다.)
 */
export const isatty = (_fd?: number): boolean => false

export class WriteStream {
  columns = 80
  rows = 24
  isTTY = false
  write(): boolean {
    return true
  }
}

export class ReadStream {
  isTTY = false
  setRawMode(): this {
    return this
  }
}

export default { isatty, WriteStream, ReadStream }
