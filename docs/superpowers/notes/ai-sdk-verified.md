# AI SDK 7 验证记录（2026-10-23）

版本：ai 7.0.132、@ai-sdk/openai-compatible 3.0.65、@ai-sdk/anthropic 4.0.75、zod 4.6.5。
方法：写了一个本地模拟服务器（OpenAI 兼容 SSE 和 Anthropic SSE 各一份，含工具调用），让 SDK 真的发请求过去，记录请求和解析出来的事件。没有调用任何真实接口。

## 结论

- **提示词参数叫 `instructions`**，`system` 还能用但已标 deprecated。
- **接口地址不会自动补 `/v1`**。OpenAI 兼容实际请求 `${baseURL}/chat/completions`（`Authorization: Bearer <key>`），Anthropic 实际请求 `${baseURL}/messages`（`x-api-key: <key>`）。所以界面要提示“地址通常以 /v1 结尾”，程序只去掉首尾空白和末尾的 `/`，不替用户补。
- **工具调用**：用 `tool({ description, inputSchema: zodSchema })`，不写 `execute`，SDK 就只把调用交给我们，`finishReason` 是 `tool-calls`。不需要 `stopWhen`，没有 execute 时一轮就停。
- **流式事件**（`result.fullStream`）：`start`、`start-step`、`text-start`、`text-delta`（字段是 `text`）、`text-end`、`tool-input-start/delta/end`、`tool-call`、`finish-step`、`finish`（带 `finishReason`、`totalUsage`）。出错有 `error` 事件，被中断有 `abort` 事件。Anthropic 开头多一个 `custom` 事件，忽略即可。
- **参数不合 schema 或不是合法 JSON**：SDK 自己会校验，仍然给一个 `tool-call` 事件，但带 `invalid: true` 和 `error`（字符串），`input` 可能是没解析的原文字符串；接着还有一个 `tool-error` 事件。我们据此走“发回给模型重试一次”的流程。
- **用量**：`finish.totalUsage` 或 `await result.usage`，字段 `inputTokens`、`outputTokens`、`totalTokens`。有的接口不返回，要当作可能缺失。
- **错误**：401、429、500 都是 `APICallError`（用 `APICallError.isInstance(err)` 判断），带 `statusCode`、`isRetryable`，`message` 取自响应体里的错误信息。网络不通也是 `APICallError`，没有 `statusCode`，`message` 形如 `Cannot connect to API: …`，`cause` 里有原因。流式出错时 `fullStream` 不抛异常，而是给 `error` 事件；`result.text` 这类 promise 会以 `NoOutputGeneratedError` 失败。
- **默认会把流式错误打印到控制台**：要传 `onError` 回调接住。
- **中断**：传 `abortSignal`，`fullStream` 正常结束，最后一个事件是 `abort`；`result.text` 等 promise 以 `AbortError` 失败，所以不要依赖它们，用流里累积的文字。
- **Anthropic 必须有 `max_tokens`**：模型名不认识时 SDK 会按 128000 兜底并打印警告，真实接口会拒绝。所以调用时一律显式传 `maxOutputTokens: 4096`。
- **警告日志**：`globalThis.AI_SDK_LOG_WARNINGS = false` 关掉。

## 把工具结果回传（第二轮）

两种接口都用同一种消息格式，SDK 会转成各自的协议：

```ts
const messages: ModelMessage[] = [
  { role: 'user', content: '加个任务：写周报' },
  { role: 'assistant', content: [
      { type: 'text', text: '好的。' },
      { type: 'tool-call', toolCallId: 'call_1', toolName: 'add_task', input: { title: '写周报' } },
  ] },
  { role: 'tool', content: [
      { type: 'tool-result', toolCallId: 'call_1', toolName: 'add_task', output: { type: 'text', value: '已新建任务：写周报' } },
  ] },
]
```

OpenAI 兼容侧变成 `assistant.tool_calls` + `role: tool`，Anthropic 侧变成 `tool_use` + `user` 消息里的 `tool_result`，实测请求体都对。

## 创建模型

```ts
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createAnthropic } from '@ai-sdk/anthropic'

const openai = createOpenAICompatible({ name: 'custom', baseURL, apiKey })(modelId)
const claude = createAnthropic({ baseURL, apiKey })(modelId)
```

## 测试连接

`generateText({ model, prompt: '只回复“好”', maxOutputTokens: 8, maxRetries: 0 })`，请求体里是 `max_tokens: 8`。

## 没验证的部分

- 真实服务商之间的差异（有的不支持工具调用、有的忽略 `max_tokens`）；这正是计划里 JSON 文本模式兜底的原因。
- 工具 schema 里的 `format: date` / `pattern` 在个别严格的接口上会不会被拒绝。
