/**
 * `node:dns` 셤.
 *
 * Vite 는 `resolveHostname()` 에서 localhost 가 DNS 결과와 다른지 확인하려고
 * `dns.getDefaultResultOrder()` 와 `dns.promises.lookup()` 을 부른다
 * (Node 17 이 localhost 를 ::1 로 먼저 해석하기 시작한 것에 대한 대응).
 *
 * 빈 객체로 스텁하면:
 *     TypeError: Cannot read properties of undefined (reading 'getDefaultResultOrder')
 *       at getLocalhostAddressIfDiffersFromDNS
 *
 * 브라우저엔 DNS 가 없다. `verbatim` 을 돌려주고 lookup 은 127.0.0.1 을 주면
 * Vite 는 "DNS 와 다르지 않다" 고 판단하고 그냥 넘어간다.
 */
export const getDefaultResultOrder = (): string => 'verbatim'
export const setDefaultResultOrder = (): void => {}

export const lookup = (
  _host: string,
  _opts: unknown,
  cb?: (e: null, addr: string, fam: number) => void,
): void => {
  const done = typeof _opts === 'function' ? (_opts as typeof cb) : cb
  done?.(null, '127.0.0.1', 4)
}

export const promises = {
  lookup: async (): Promise<{ address: string; family: number }> => ({
    address: '127.0.0.1',
    family: 4,
  }),
  resolve: async (): Promise<string[]> => [],
}

export default { getDefaultResultOrder, setDefaultResultOrder, lookup, promises }
