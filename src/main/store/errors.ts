export type WorkspaceErrorCode =
  | 'missing' // 文件不存在
  | 'corrupt' // 内容不是合法的 JSON
  | 'invalid' // 内容格式不符合 schema
  | 'busy' // 文件被其他程序占用，重试到超时仍写不进去
  | 'bad-path' // 路径不在工作区内

export class WorkspaceError extends Error {
  readonly code: WorkspaceErrorCode
  /** 出问题的文件，相对工作区的路径 */
  readonly rel: string

  constructor(code: WorkspaceErrorCode, rel: string, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'WorkspaceError'
    this.code = code
    this.rel = rel
  }
}
