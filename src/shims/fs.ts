import { fs } from 'memfs'
export default fs
export const existsSync = (...a) => fs.existsSync(...a)
export const readFileSync = (...a) => fs.readFileSync(...a)
export const writeFileSync = (...a) => fs.writeFileSync(...a)
export const statSync = (...a) => fs.statSync(...a)
export const lstatSync = (...a) => fs.lstatSync(...a)
export const readdirSync = (...a) => fs.readdirSync(...a)
export const mkdirSync = (...a) => fs.mkdirSync(...a)
export const realpathSync = (...a) => fs.realpathSync(...a)
export const readlinkSync = (...a) => fs.readlinkSync(...a)
export const rmSync = (...a) => fs.rmSync(...a)
export const unlinkSync = (...a) => fs.unlinkSync(...a)
export const promises = fs.promises
export const constants = fs.constants
export const watch = () => ({ close() {}, on() {} })
