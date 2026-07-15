/**
 * `node:path` 셤.
 *
 * path-browserify 를 그대로 alias 하면 안 되는 이유 — 이 패키지는 POSIX 전용이라
 * `win32` 를 **null 로 남긴다**:
 *
 *     // path-browserify/index.js 끝
 *     posix: null
 *     };
 *     posix.posix = posix;      // posix 는 자기 자신으로 채워주는데
 *     module.exports = posix;   // win32 는 null 인 채
 *
 * 그런데 Vite 는 normalizePath 에서 이렇게 쓴다:
 *
 *     const normalizePathRegExp = new RegExp(`\\${path.win32.sep}`, "g")
 *     filename.replace(normalizePathRegExp, path.posix.sep)
 *
 * 그래서 `TypeError: Cannot read properties of null (reading 'sep')` 로 죽는다.
 *
 * Vite 가 실제로 쓰는 것은 win32 쪽에선 `sep` 과 `basename` 뿐이므로
 * (`grep -ohE "\b(win32|posix)\.[a-zA-Z]+"` 로 확인) 그 둘만 제대로 채워준다.
 */
import posixPath from 'path-browserify'

type PathModule = typeof posixPath

export const basename: PathModule['basename'] = posixPath.basename
export const dirname: PathModule['dirname'] = posixPath.dirname
export const extname: PathModule['extname'] = posixPath.extname
export const isAbsolute: PathModule['isAbsolute'] = posixPath.isAbsolute
export const join: PathModule['join'] = posixPath.join
export const normalize: PathModule['normalize'] = posixPath.normalize
export const relative: PathModule['relative'] = posixPath.relative
export const resolve: PathModule['resolve'] = posixPath.resolve
export const parse: PathModule['parse'] = posixPath.parse
export const format: PathModule['format'] = posixPath.format
export const sep = '/'
export const delimiter = ':'

/** POSIX 네임스페이스. path-browserify 자신이다. */
export const posix: PathModule = posixPath

/**
 * win32 네임스페이스. 브라우저엔 윈도우 경로가 없지만 Vite 의 normalizePath 가
 * `win32.sep` 을 정규식으로 만들어 쓰므로 반드시 `'\\'` 여야 한다.
 * (여기를 `'/'` 로 두면 normalizePath 가 모든 슬래시를 지워버린다.)
 */
export const win32 = {
  ...posixPath,
  sep: '\\',
  delimiter: ';',
  basename: (p: string, ext?: string): string =>
    posixPath.basename(String(p).replace(/\\/g, '/'), ext),
}

const pathDefault = {
  basename, dirname, extname, isAbsolute, join, normalize, relative, resolve,
  parse, format, sep, delimiter, posix, win32,
}

export default pathDefault
