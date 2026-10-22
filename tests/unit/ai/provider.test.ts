import { APICallError } from 'ai'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { assertConfigured, createModel, describeAiError, normalizeBaseURL, testConnection, type ModelSettings } from '../../../src/main/ai/provider'
import { DomainError } from '../../../src/main/domain/errors'
import { startMockServer, type MockServer } from './mockServer'

let server: MockServer
beforeAll(async () => {
  server = await startMockServer()
})
afterAll(async () => {
  await server.close()
})
beforeEach(() => {
  server.reset()
})

const settings = (patch: Partial<ModelSettings> = {}): ModelSettings => ({
  kind: 'openai-compatible',
  baseURL: server.baseURL,
  model: 'test-model',
  apiKey: 'sk-test-123',
  ...patch,
})

describe('配置检查', () => {
  it('normalizeBaseURL：只去首尾空白和末尾的斜杠，不补 /v1', () => {
    expect(normalizeBaseURL('  https://api.example.com/v1/// ')).toBe('https://api.example.com/v1')
    expect(normalizeBaseURL('https://api.example.com')).toBe('https://api.example.com')
  })

  it('缺哪项就说缺哪项', () => {
    expect(() => assertConfigured(settings())).not.toThrow()
    expect(() => assertConfigured(settings({ baseURL: ' ', apiKey: '' }))).toThrow('缺 接口地址、API key')
    expect(() => assertConfigured(settings({ model: '' }))).toThrow(/缺 模型名/)
    expect(() => createModel(settings({ apiKey: '' }))).toThrowError(DomainError)
  })
})

describe('testConnection：测试连接', () => {
  it('OpenAI 兼容：成功，请求带密钥、很小的 max_tokens', async () => {
    server.queue({ kind: 'text', text: '好', usage: { input: 9, output: 1 } })
    const result = await testConnection(settings())
    expect(result).toEqual({ ok: true, reply: '好', inputTokens: 9, outputTokens: 1 })
    const request = server.requests[0]!
    expect(request.protocol).toBe('openai')
    expect(request.headers.authorization).toBe('Bearer sk-test-123')
    expect(request.body.max_tokens).toBe(8)
    expect(request.body.model).toBe('test-model')
  })

  it('Anthropic：走 /messages，用 x-api-key', async () => {
    server.queue({ kind: 'text', text: '好' })
    const result = await testConnection(settings({ kind: 'anthropic', model: 'claude-x' }))
    expect(result).toMatchObject({ ok: true, reply: '好' })
    const request = server.requests[0]!
    expect(request.protocol).toBe('anthropic')
    expect(request.headers['x-api-key']).toBe('sk-test-123')
    expect(request.body.max_tokens).toBe(8)
  })

  it('地址末尾多写了斜杠也没关系', async () => {
    const result = await testConnection(settings({ baseURL: `${server.baseURL}/` }))
    expect(result.ok).toBe(true)
  })

  it.each([
    [401, /401.*API key/],
    [404, /404.*\/v1/],
    [429, /额度.*余额/],
    [500, /500.*稍后再试/],
  ])('接口回 %i：给出能照着检查的中文提示', async (status, pattern) => {
    server.queue({ kind: 'error', status })
    const result = await testConnection(settings())
    expect(result.ok).toBe(false)
    expect((result as { message: string }).message).toMatch(pattern)
  })

  it('网络不通：提示检查地址和网络', async () => {
    const result = await testConnection(settings({ baseURL: 'http://127.0.0.1:1/v1' }))
    expect(result).toMatchObject({ ok: false })
    expect((result as { message: string }).message).toMatch(/连不上模型接口.*检查接口地址和网络/)
  })

  it('配置没填完：不发请求，直接说缺什么', async () => {
    const result = await testConnection(settings({ apiKey: '' }))
    expect(result).toEqual({ ok: false, message: '还没有配置好模型接口：缺 API key。请先在设置里填好。' })
    expect(server.requests).toHaveLength(0)
  })
})

describe('describeAiError', () => {
  const apiError = (statusCode: number | undefined, message: string) =>
    new APICallError({ message, url: 'http://x', requestBodyValues: {}, statusCode })

  it('400 且提到工具：建议改成 JSON 文本模式', () => {
    expect(describeAiError(apiError(400, 'tools are not supported'))).toMatch(/不支持工具调用.*JSON 文本/)
  })

  it('403 把服务商的原话带上（比如额度不足）', () => {
    expect(describeAiError(apiError(403, '预扣费额度失败'))).toBe('没有权限（403）：预扣费额度失败')
  })

  it('其他状态码、中断、未知错误', () => {
    expect(describeAiError(apiError(418, '我是茶壶'))).toBe('接口返回了错误（418）：我是茶壶')
    expect(describeAiError(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe('已中断')
    expect(describeAiError(new Error('boom'))).toBe('出错了：boom')
    expect(describeAiError('字符串')).toBe('出错了：字符串')
  })
})
