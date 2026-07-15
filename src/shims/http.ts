/**
 * `node:http` 셤.
 *
 * middlewareMode 에서는 Vite 가 http 서버를 **만들지 않는다**. 하지만 Vite 에
 * 번들된 connect 가 `app.use()` 안에서 이런 검사를 한다:
 *
 *     if (fn instanceof http.Server) { fn = fn.listeners('request')[0] }
 *
 * 그래서 `Server` 는 **반드시 클래스(또는 prototype 이 있는 함수)** 여야 한다.
 * 화살표 함수로 스텁하면 prototype 이 없어서:
 *
 *     TypeError: Function has non-object prototype 'undefined' in instanceof check
 *       at [Symbol.hasInstance] at app.use
 *
 * 빈 객체(`{}`)로 스텁해도 `undefined instanceof` 로 죽는다.
 * "존재하되 쓸 수 없는" 형태가 정확히 필요한 사례.
 */

/** connect 의 `instanceof http.Server` 검사를 통과시키기 위한 실체. 인스턴스화하면 실패한다. */
export class Server {
  constructor() {
    throw new Error(
      'http.Server 는 브라우저에서 만들 수 없습니다. ' +
        'server.middlewareMode: true 로 두고 Service Worker 에서 미들웨어를 구동하세요.',
    )
  }
}

export class IncomingMessage {}
export class ServerResponse {}
export class Agent {}
export class ClientRequest {}

export const createServer = (): never => {
  throw new Error(
    'http.createServer 는 브라우저에서 지원되지 않습니다. ' +
      'server.middlewareMode: true 를 쓰세요.',
  )
}

export const request = (): never => {
  throw new Error('http.request 는 브라우저에서 지원되지 않습니다. fetch 를 쓰세요.')
}
export const get = (): never => {
  throw new Error('http.get 는 브라우저에서 지원되지 않습니다. fetch 를 쓰세요.')
}

export const STATUS_CODES: Record<number, string> = {
  200: 'OK',
  204: 'No Content',
  301: 'Moved Permanently',
  302: 'Found',
  304: 'Not Modified',
  400: 'Bad Request',
  403: 'Forbidden',
  404: 'Not Found',
  500: 'Internal Server Error',
}

export const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']

export default {
  Server, IncomingMessage, ServerResponse, Agent, ClientRequest,
  createServer, request, get, STATUS_CODES, METHODS,
}
