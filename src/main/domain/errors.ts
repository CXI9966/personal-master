export type DomainErrorCode = 'not-found' | 'invalid'

/** 业务规则层的错误：找不到任务、参数不合法之类，消息直接给用户看 */
export class DomainError extends Error {
  readonly code: DomainErrorCode

  constructor(code: DomainErrorCode, message: string) {
    super(message)
    this.name = 'DomainError'
    this.code = code
  }
}
