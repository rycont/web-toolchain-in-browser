export const builtinModules = [
  'fs', 'path', 'url', 'util', 'events', 'module', 'perf_hooks', 'os',
  'crypto', 'stream', 'http', 'https', 'net', 'tls', 'zlib', 'buffer', 'process',
]
export function createRequire() {
  const r = (id) => {
    throw new Error('createRequire is not supported in the browser: ' + id)
  }
  r.resolve = (id) => id
  r.cache = {}
  return r
}
export class Module {}
Module.builtinModules = builtinModules
Module.createRequire = createRequire
export default Module
