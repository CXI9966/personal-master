import { describe, expect, it } from 'vitest'
import { MUTATING } from '../../../src/main/ai/actions'
import { extractJsonActions, jsonModeSection } from '../../../src/main/ai/jsonMode'
import { buildSystemPrompt, FIXED_RULES } from '../../../src/main/ai/prompt'

describe('buildSystemPrompt', () => {
  it('顺序：固定规则 → 管家人格 → 当前情况；工具调用模式下没有动作说明', () => {
    const prompt = buildSystemPrompt({ persona: '# 管家人格\n温柔一点', context: '## 现在\n2026-10-23', mode: 'tools', actions: MUTATING })
    expect(prompt.indexOf(FIXED_RULES)).toBe(0)
    expect(prompt.indexOf('温柔一点')).toBeGreaterThan(prompt.indexOf('# 你的性格和做事方式'))
    expect(prompt.indexOf('2026-10-23')).toBeGreaterThan(prompt.indexOf('温柔一点'))
    expect(prompt).not.toContain('json 代码块')
  })

  it('固定规则里有：中文、只能用工具改数据、大改动要确认、不编造记录', () => {
    for (const keyword of ['中文', '只能用提供的工具', '先让用户确认', '不要编造']) expect(FIXED_RULES).toContain(keyword)
  })

  it('JSON 模式：附上动作清单，每个改数据的动作都在，参数是 JSON Schema', () => {
    const prompt = buildSystemPrompt({ persona: 'p', context: 'c', mode: 'json', actions: MUTATING })
    expect(prompt).toContain('```json')
    for (const def of MUTATING) expect(prompt).toContain(`- ${def.name}：`)
    expect(prompt).toContain('"type":"object"')
    expect(prompt).not.toContain('$schema')
    expect(prompt).not.toContain('get_tasks') // 查询工具不在 JSON 模式里
  })

  it('人格文件是空的也不会崩', () => {
    expect(() => buildSystemPrompt({ persona: '', context: '', mode: 'tools', actions: [] })).not.toThrow()
  })
})

describe('extractJsonActions', () => {
  const block = (json: string): string => `好的，我来加。\n\`\`\`json\n${json}\n\`\`\``

  it('取出代码块里的动作，正文里不再带代码块', () => {
    const result = extractJsonActions(block('{"actions":[{"name":"add_task","args":{"title":"写周报"}},{"name":"log_weight","args":{"kg":76}}]}'))
    expect(result.text).toBe('好的，我来加。')
    expect(result.calls).toEqual([
      { id: 'json_1', name: 'add_task', input: { title: '写周报' } },
      { id: 'json_2', name: 'log_weight', input: { kg: 76 } },
    ])
    expect(result.error).toBeUndefined()
  })

  it('没有代码块：原样返回文字，没有动作', () => {
    expect(extractJsonActions('今天加油。')).toEqual({ text: '今天加油。', calls: [] })
  })

  it('有多个代码块时取最后一个', () => {
    const text = `${block('{"actions":[{"name":"a","args":{}}]}')}\n改一下：\n\`\`\`json\n{"actions":[{"name":"b","args":{}}]}\n\`\`\``
    expect(extractJsonActions(text).calls.map((c) => c.name)).toEqual(['b'])
  })

  it('直接是数组也行；args 缺省当作空对象', () => {
    expect(extractJsonActions(block('[{"name":"get_plan"}]')).calls).toEqual([{ id: 'json_1', name: 'get_plan', input: {} }])
  })

  it.each([
    ['不是合法的 JSON', block('{"actions":[')],
    ['没有 actions 数组', block('{"foo":1}')],
    ['动作缺 name', block('{"actions":[{"args":{}}]}')],
  ])('%s：给出 error，不返回动作', (_name, text) => {
    const result = extractJsonActions(text)
    expect(result.calls).toEqual([])
    expect(result.error).toBeTruthy()
    expect(result.text).toBe('好的，我来加。')
  })

  it('jsonModeSection 本身也能直接使用', () => {
    expect(jsonModeSection([MUTATING[0]!])).toContain(MUTATING[0]!.name)
  })
})
