import { z } from 'zod'

const zh = z.locales.zhCN()

/** safeParse 的第二个参数：本次解析用中文错误消息，不改全局设置 */
export const zhParse = { error: zh.localeError }

/** 把 zod 的错误拼成一行中文，形如 "tasks › 第 1 项 › title：标题不能为空" */
export function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const where = issue.path.map((part) => (typeof part === 'number' ? `第 ${part + 1} 项` : String(part))).join(' › ')
      return where ? `${where}：${issue.message}` : issue.message
    })
    .join('；')
}
