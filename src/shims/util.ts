import u from 'util'

export const format = u.format
export const promisify = u.promisify
export const inspect = u.inspect ?? ((x) => String(x))
export const formatWithOptions = (_opts, ...a) => u.format(...a)
export const parseEnv = () => ({})
export const stripVTControlCharacters = (s) => String(s).replace(/\[[0-9;]*m/g, '')
export const types = u.types ?? {}

export default { format, inspect, promisify, formatWithOptions, parseEnv, stripVTControlCharacters, types }
