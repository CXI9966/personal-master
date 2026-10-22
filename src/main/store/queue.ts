/**
 * 最小串行队列：同一时刻只有一个操作碰文件。
 * Windows 上同进程的读也会让 rename 覆盖失败，所以读、写、追加都走它。
 */
export class WriteQueue {
  private tail: Promise<unknown> = Promise.resolve()

  run<T>(op: () => Promise<T>): Promise<T> {
    const result = this.tail.then(op)
    this.tail = result.catch(() => undefined) // 前一个失败不影响后面的
    return result
  }
}
