import u from 'util'

export const format = u.format
export const promisify = u.promisify
export const inspect = u.inspect ?? ((x: unknown) => String(x))
export const formatWithOptions = (_opts: unknown, ...a: unknown[]): string =>
  (u.format as (...x: unknown[]) => string)(...a)
export const parseEnv = (): Record<string, string> => ({})
export const stripVTControlCharacters = (s: unknown): string =>
  String(s).replace(/\[[0-9;]*m/g, '')
export const types = u.types ?? {}

/** Node 20.12+ 의 ANSI 스타일링. 브라우저엔 터미널이 없으므로 원문 그대로 돌려준다. */
export const styleText = (_format: string | string[], text: string): string => text

export default {
  format,
  inspect,
  promisify,
  formatWithOptions,
  parseEnv,
  stripVTControlCharacters,
  styleText,
  types,
}
