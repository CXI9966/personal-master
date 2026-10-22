import type { z, ZodType } from 'zod'
import { formatIssues, zhParse } from '../../shared/issues'

export interface SkippedLine {
  /** 从 1 开始的行号 */
  line: number
  reason: string
}

export interface LinesResult<T> {
  items: T[]
  skipped: SkippedLine[]
}

/** readFile 的 utf8 不会去掉 BOM，手改过的文件要先去掉再解析 */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** 容错解析 JSONL：坏行（不是 JSON、不符合 schema、被截断的半行）跳过并记下行号，空行忽略 */
export function parseJsonl<S extends ZodType>(text: string, schema: S): LinesResult<z.output<S>> {
  const items: z.output<S>[] = []
  const skipped: SkippedLine[] = []
  stripBom(text)
    .split('\n')
    .forEach((raw, index) => {
      const line = raw.replace(/\r$/, '') // 容忍外部编辑器留下的 CRLF
      if (line.trim() === '') return
      let data: unknown
      try {
        data = JSON.parse(line)
      } catch {
        skipped.push({ line: index + 1, reason: '不是合法的 JSON' })
        return
      }
      const result = schema.safeParse(data, zhParse)
      if (result.success) items.push(result.data)
      else skipped.push({ line: index + 1, reason: formatIssues(result.error) })
    })
  return { items, skipped }
}
