// 管家人格.md 固定四栏（二级标题）。界面按栏编辑；标题被改乱时，调用方把全文当成一个整体使用。

export const PERSONA_SECTIONS = ['说话风格', '督促方式', '检验规则', '不许做的事'] as const
export type PersonaSectionTitle = (typeof PERSONA_SECTIONS)[number]
export type PersonaSections = Record<PersonaSectionTitle, string>

const isSectionTitle = (title: string): title is PersonaSectionTitle =>
  (PERSONA_SECTIONS as readonly string[]).includes(title)

/**
 * 按四个二级标题拆开。四栏必须各出现一次、没有别的二级标题，否则返回 null。
 * 第一个二级标题之前的内容（比如 "# 管家人格"）会被忽略。
 */
export function splitPersona(markdown: string): PersonaSections | null {
  const found: Partial<Record<PersonaSectionTitle, string[]>> = {}
  let current: PersonaSectionTitle | null = null
  for (const line of markdown.replace(/^﻿/, '').split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line)
    if (heading) {
      const title = heading[1] ?? ''
      if (!isSectionTitle(title) || found[title]) return null // 未知标题或重复标题
      found[title] = []
      current = title
    } else if (current) {
      found[current]?.push(line)
    }
  }
  const result = {} as PersonaSections
  for (const title of PERSONA_SECTIONS) {
    const lines = found[title]
    if (!lines) return null
    result[title] = lines.join('\n').trim()
  }
  return result
}

export function joinPersona(sections: PersonaSections): string {
  const body = PERSONA_SECTIONS.map((title) => `## ${title}\n\n${sections[title].trim()}`).join('\n\n')
  return `# 管家人格\n\n${body}\n`
}
