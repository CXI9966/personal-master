// 本地模拟的模型服务：同时说 OpenAI 兼容（/v1/chat/completions）和 Anthropic（/v1/messages）两种协议，
// 流式和非流式都支持。测试按“剧本”排好每一次请求要怎么回复。
import http from 'node:http'
import type { AddressInfo } from 'node:net'

export type Reply =
  | { kind: 'text'; text: string; usage?: { input: number; output: number } }
  | { kind: 'tools'; text?: string; calls: Array<{ name: string; args: unknown }>; usage?: { input: number; output: number } }
  | { kind: 'error'; status: number; message?: string }
  | { kind: 'hang'; text?: string } // 发完开头就不再发，等客户端中断

export interface RecordedRequest {
  protocol: 'openai' | 'anthropic'
  url: string
  headers: http.IncomingHttpHeaders
  body: Record<string, unknown>
}

export interface MockServer {
  baseURL: string
  requests: RecordedRequest[]
  /** 按顺序排好接下来几次请求的回复；排空以后一律回复“好” */
  queue(...replies: Reply[]): void
  /** 清掉没用完的回复和已记录的请求，每个测试开始前调用，免得串到下一个测试 */
  reset(): void
  close(): Promise<void>
}

const sse = (event: string | null, data: unknown): string => `${event ? `event: ${event}\n` : ''}data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`
const argsText = (args: unknown): string => (typeof args === 'string' ? args : JSON.stringify(args))
const textOf = (reply: Reply): string => (reply.kind === 'text' ? reply.text : reply.kind === 'tools' ? (reply.text ?? '') : '')
const usageOf = (reply: Reply): { input: number; output: number } =>
  ('usage' in reply && reply.usage) || { input: 10, output: 5 }

function openaiStream(reply: Reply, res: http.ServerResponse): void {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const chunk = (delta: unknown, finish: string | null = null): string =>
    sse(null, { id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta, finish_reason: finish }] })
  if (reply.kind === 'hang') {
    res.write(chunk({ role: 'assistant', content: reply.text ?? '开头' }))
    return
  }
  const text = textOf(reply)
  res.write(chunk({ role: 'assistant', content: '' }))
  for (const piece of text.match(/[\s\S]{1,6}/g) ?? []) res.write(chunk({ content: piece }))
  if (reply.kind === 'tools') {
    reply.calls.forEach((call, index) => {
      const args = argsText(call.args)
      const half = Math.floor(args.length / 2)
      res.write(chunk({ tool_calls: [{ index, id: `call_${index + 1}`, type: 'function', function: { name: call.name, arguments: '' } }] }))
      res.write(chunk({ tool_calls: [{ index, function: { arguments: args.slice(0, half) } }] }))
      res.write(chunk({ tool_calls: [{ index, function: { arguments: args.slice(half) } }] }))
    })
  }
  res.write(chunk({}, reply.kind === 'tools' ? 'tool_calls' : 'stop'))
  const u = usageOf(reply)
  res.write(sse(null, { id: 'c1', object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: u.input, completion_tokens: u.output, total_tokens: u.input + u.output } }))
  res.write('data: [DONE]\n\n')
  res.end()
}

function anthropicStream(reply: Reply, res: http.ServerResponse): void {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const u = usageOf(reply)
  res.write(sse('message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-x', content: [], stop_reason: null, usage: { input_tokens: u.input, output_tokens: 1 } } }))
  res.write(sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }))
  if (reply.kind === 'hang') {
    res.write(sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: reply.text ?? '开头' } }))
    return
  }
  const text = textOf(reply)
  for (const piece of text.match(/[\s\S]{1,6}/g) ?? []) res.write(sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: piece } }))
  res.write(sse('content_block_stop', { type: 'content_block_stop', index: 0 }))
  if (reply.kind === 'tools') {
    reply.calls.forEach((call, i) => {
      const index = i + 1
      const args = argsText(call.args)
      const half = Math.floor(args.length / 2)
      res.write(sse('content_block_start', { type: 'content_block_start', index, content_block: { type: 'tool_use', id: `toolu_${index}`, name: call.name, input: {} } }))
      res.write(sse('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: args.slice(0, half) } }))
      res.write(sse('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: args.slice(half) } }))
      res.write(sse('content_block_stop', { type: 'content_block_stop', index }))
    })
  }
  res.write(sse('message_delta', { type: 'message_delta', delta: { stop_reason: reply.kind === 'tools' ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: u.output } }))
  res.write(sse('message_stop', { type: 'message_stop' }))
  res.end()
}

function openaiJson(reply: Reply, res: http.ServerResponse): void {
  const u = usageOf(reply)
  const text = reply.kind === 'text' ? reply.text : reply.kind === 'tools' ? (reply.text ?? '') : ''
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({
    id: 'c1', object: 'chat.completion', created: 1, model: 'm',
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: u.input, completion_tokens: u.output, total_tokens: u.input + u.output },
  }))
}

function anthropicJson(reply: Reply, res: http.ServerResponse): void {
  const u = usageOf(reply)
  const text = reply.kind === 'text' ? reply.text : reply.kind === 'tools' ? (reply.text ?? '') : ''
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-x', stop_reason: 'end_turn', stop_sequence: null,
    content: [{ type: 'text', text }], usage: { input_tokens: u.input, output_tokens: u.output },
  }))
}

export async function startMockServer(): Promise<MockServer> {
  const requests: RecordedRequest[] = []
  const scripted: Reply[] = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const protocol = /\/chat\/completions$/.test(req.url ?? '') ? 'openai' : /\/messages$/.test(req.url ?? '') ? 'anthropic' : null
      if (!protocol) return void res.writeHead(404).end('not found')
      let body: Record<string, unknown> = {}
      try { body = JSON.parse(raw) as Record<string, unknown> } catch { /* 空请求体 */ }
      requests.push({ protocol, url: req.url ?? '', headers: req.headers, body })
      const reply: Reply = scripted.shift() ?? { kind: 'text', text: '好' }
      if (reply.kind === 'error') {
        res.writeHead(reply.status, { 'content-type': 'application/json' })
        return void res.end(JSON.stringify(protocol === 'openai'
          ? { error: { message: reply.message ?? `模拟的 ${reply.status} 错误`, type: 'mock_error' } }
          : { type: 'error', error: { type: 'mock_error', message: reply.message ?? `模拟的 ${reply.status} 错误` } }))
      }
      const streaming = body.stream === true
      if (protocol === 'openai') return streaming ? openaiStream(reply, res) : openaiJson(reply, res)
      return streaming ? anthropicStream(reply, res) : anthropicJson(reply, res)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    baseURL: `http://127.0.0.1:${port}/v1`,
    requests,
    queue: (...replies) => void scripted.push(...replies),
    reset: () => {
      scripted.length = 0
      requests.length = 0
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
