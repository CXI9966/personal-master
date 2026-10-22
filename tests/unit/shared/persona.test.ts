import { describe, expect, it } from 'vitest'
import { PERSONA_PRESETS, personaMarkdown } from '../../../src/main/init/personas'
import { joinPersona, PERSONA_CHOICES, PERSONA_SECTIONS, splitPersona, type PersonaSections } from '../../../src/shared/persona'

const sample: PersonaSections = {
  说话风格: '说话风格的内容',
  督促方式: '督促方式的内容\n第二行',
  检验规则: '检验规则的内容',
  不许做的事: '不许做的事的内容',
}

describe('splitPersona / joinPersona', () => {
  it('拆开再拼回去内容不变', () => {
    expect(splitPersona(joinPersona(sample))).toEqual(sample)
  })

  it('忽略第一个二级标题之前的内容；三级标题和 CRLF 换行都没问题', () => {
    const text = `﻿# 随便写点什么\r\n\r\n${PERSONA_SECTIONS.map((t) => `## ${t}\r\n\r\n### 小节\r\n${t}内容`).join('\r\n\r\n')}\r\n`
    const parsed = splitPersona(text)
    expect(parsed?.['说话风格']).toBe('### 小节\n说话风格内容')
  })

  it.each([
    ['缺一栏', joinPersona(sample).replace('## 检验规则', '## 其他')],
    ['标题被改名', joinPersona(sample).replace('## 督促方式', '## 督促的方式')],
    ['标题重复', `${joinPersona(sample)}\n## 说话风格\n\n再来一遍\n`],
    ['多了别的二级标题', `${joinPersona(sample)}\n## 附加\n\n内容\n`],
    ['完全是自由文字', '你是一个管家，说话要温柔。'],
  ])('%s：返回 null，由调用方把全文当整体', (_name, text) => {
    expect(splitPersona(text)).toBeNull()
  })
})

describe('预设', () => {
  it('三套预设的名字不重复，四栏都在且都有内容', () => {
    expect(new Set(PERSONA_PRESETS.map((p) => p.name)).size).toBe(3)
    for (const preset of PERSONA_PRESETS) {
      const parsed = splitPersona(personaMarkdown(preset.id))
      expect(parsed, preset.name).not.toBeNull()
      for (const title of PERSONA_SECTIONS) expect(parsed?.[title].length, `${preset.name}/${title}`).toBeGreaterThan(10)
    }
  })

  it('界面显示用的 PERSONA_CHOICES 和主进程的预设一一对应', () => {
    expect(PERSONA_CHOICES).toEqual(PERSONA_PRESETS.map(({ id, name, summary }) => ({ id, name, summary })))
  })

  it('每套预设的“不许做的事”都包含不编造记录和不翻旧账', () => {
    for (const preset of PERSONA_PRESETS) {
      expect(preset.sections['不许做的事']).toContain('不翻旧账')
      expect(preset.sections['不许做的事']).toContain('不编造')
    }
  })

  it('检验规则里禁止封闭式提问', () => {
    for (const preset of PERSONA_PRESETS) expect(preset.sections['检验规则']).toContain('不问“是不是”')
  })
})
