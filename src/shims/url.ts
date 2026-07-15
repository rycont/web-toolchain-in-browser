export const URL = globalThis.URL
export const URLSearchParams = globalThis.URLSearchParams
export const fileURLToPath = (u) => {
  const s = typeof u === 'string' ? u : u.href
  return s.startsWith('file://') ? decodeURIComponent(s.slice(7)) : s
}
export const pathToFileURL = (p) => new globalThis.URL('file://' + encodeURI(p).replace(/#/g, '%23'))
export default { URL, URLSearchParams, fileURLToPath, pathToFileURL }
