import { GENERATED_MARKER } from '../../shared/labels'

/** 生成文件统一的开头：第一行固定的说明，空一行，再接正文 */
export function withMarker(body: string): string {
  return `${GENERATED_MARKER}\n\n${body.trim()}\n`
}

const escapeCell = (cell: string): string => cell.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')

export function mdTable(headers: string[], rows: string[][]): string {
  const head = `| ${headers.join(' | ')} |`
  const divider = `|${headers.map(() => '------').join('|')}|`
  return [head, divider, ...rows.map((row) => `| ${row.map(escapeCell).join(' | ')} |`)].join('\n')
}

// Windows 不允许的文件名字符和保留名
const INVALID_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** 清单名 → 可以做文件名的字符串 */
export function sanitizeFileName(name: string): string {
  let safe = name.replace(INVALID_CHARS, '_').replace(/[. ]+$/, '').trim()
  if (!safe) safe = '清单'
  if (RESERVED.test(safe)) safe = `${safe}_`
  return safe
}
