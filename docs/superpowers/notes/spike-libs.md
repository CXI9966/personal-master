# 第一版基础库与 Windows 文件行为验证（spike）

> 日期：2026-10-22
> 范围：zod 4.6.5、chokidar 5.0.0、date-fns 4.4.0 的确切用法；Windows 上的文件监听、原子替换、JSONL 并发追加；crypto.randomUUID。
> 依据：锁定版本 node_modules 里的 `.d.ts`，以及在本机真实 Node v24 上跑通的脚本。没跑过的内容单独列在第 7 节。

## 0. 环境与复现

| 项目 | 值 |
|---|---|
| 系统 | Windows 11 家庭中文版 10.0.26200；C:、D: 都是 NTFS |
| Node / npm | v24.16.0（libuv 1.52.1，V8 13.6，ICU 78.3）/ 11.13.0 |
| 时区 / 代码页 | Asia/Shanghai（+08:00）/ 系统 ANSI 代码页 936（gb2312） |
| 包（全部精确版本） | chokidar 5.0.0（带出 readdirp 5.1.1）、date-fns 4.4.0、zod 4.6.5、typescript 6.0.3、@types/node 24.19.1（带出 undici-types 7.24.6） |
| 额外的包 | 没有 |
| 临时目录（已保留） | `C:\Users\ASUS\AppData\Local\Temp\butler-spike-libs` |

安装（npm 全局配置的源是 https://registry.npmmirror.com/，lock 文件里的 resolved 都来自这里）：

```bash
cd /c/Users/ASUS/AppData/Local/Temp/butler-spike-libs
npm init -y
npm install --ignore-scripts --save-exact chokidar@5.0.0 date-fns@4.4.0 zod@4.6.5 typescript@6.0.3 @types/node@24.19.1
```

Node 24 能直接运行 `.mts`（类型擦除，不用加参数，也没有警告）。所有脚本先过类型检查，再运行：

```bash
cd /c/Users/ASUS/AppData/Local/Temp/butler-spike-libs/spikes
../node_modules/.bin/tsc -p tsconfig.json   # strict、nodenext、skipLibCheck: false，全部通过
node zod-spike.mts > ../results/zod.json
```

`spikes/tsconfig.json`：

```json
{"compilerOptions":{"target":"es2024","lib":["es2024"],"module":"nodenext","moduleResolution":"nodenext","strict":true,"noUncheckedIndexedAccess":true,"noEmit":true,"allowImportingTsExtensions":true,"erasableSyntaxOnly":true,"verbatimModuleSyntax":true,"types":["node"],"skipLibCheck":false},"include":["*.mts"]}
```

| 脚本（spikes/） | 原始输出（results/） | 对应章节 |
|---|---|---|
| zod-spike.mts | zod.json | §2 |
| chokidar-spike.mts、chokidar-extra.mts、chokidar-matchers.mts、chokidar-matchers2.mts | chokidar.json、chokidar-extra.json、chokidar-matchers.json、chokidar-matchers2.json | §3 |
| logical-day.mts、datefns-spike.mts | datefns.json | §4 |
| atomic-write.mts、atomic-spike.mts、hold-open.ps1、reader-loop.ps1、reader-loop-node.mts、inprocess-read.mts | atomic.json、atomic-v1-cap200ms-budget3s.json、inprocess-read.json | §5 |
| append-spike.mts、append-boundary.mts | append.json、append-boundary.json | §5 |
| uuid-spike.mts | uuid.json | §6 |
| extra-checks.mts | extra-checks.json | §3、§4、§5 的补充 |

测试文件都在 `work/` 下，路径故意带中文和空格（例如 `work\chokidar\工作区 测试\data`、`work\atomic\数据 目录\tasks.json`）。

## 1. 结论速览

| 验证项 | 结论 |
|---|---|
| zod：带偏移的时间 | `z.iso.datetime({ offset: true })`。不加 `offset` 时 `+08:00` 会被拒，只认 `Z` |
| zod：HH:mm、YYYY-MM-DD | `z.iso.time({ precision: z.TimePrecision.Minute })`（`Minute` 就是 -1）；`z.iso.date()` 会校验闰年和每月天数 |
| zod：中文错误 | `z.locales.zhCN()` 可以按次用，也可以全局用；给用户看的提示用自己写的 `formatIssues` 拼"字段：消息" |
| zod：JSON Schema | `z.toJSONSchema(schema)` 默认 draft-2020-12；`z.date()` 无法表示，会抛错 |
| chokidar：可靠性 | 中文目录和文件名下，增、改、删各 20 次，全部收到。新增约 1.6 ms，修改约 0 ms，删除约 107 ms（内置 100 ms 延迟） |
| chokidar：选项 | 不支持 glob：字符串按精确路径匹配，glob 写在监听路径里会静默地什么都不监听。`ignored` 用函数或正则 |
| date-fns：逻辑日期 | 拿记录自己的墙上时间和 dayStartsAt 比较。12 个边界在 4 个时区下全部通过（48/48） |
| date-fns：ISO 周 | `getISOWeekYear` + `getISOWeek`，或 `format(d, "RRRR-'W'II")`。写 `YYYY` 会抛 RangeError |
| 原子写：错误码 | 失败时只见到 EPERM。只要目标文件被打开着就会失败，不管对方用哪种共享模式 |
| 原子写：可靠实现 | 写临时文件 → fsync → rename；遇到 EPERM/EBUSY/EACCES 就退避重试（5 ms 起，50 ms 封顶，±50% 抖动，最多 10 s）。各种短暂占用场景下 200 次 0 失败 |
| 原子写：持续占用 | 重试解决不了：10 s 后抛 EPERM，界面要提示 |
| 原子写：自己进程的读 | 同进程的读也会挡住 rename（不重试时 173/200 失败）。读写走同一个队列后 0 失败、0 重试 |
| 并发 appendFile | 单行 ≤ 512 KiB 时不交错，> 512 KiB 必然交错；并发时落盘顺序不等于调用顺序。所以追加也要走写队列 |
| randomUUID | `node:crypto` 和 `globalThis.crypto` 都能用：v4、小写，10 万个没有重复，约 0.9 µs 一个 |

## 2. zod 4.6.5

根导入 `import { z } from "zod"` 就是 v4 classic API。包里同时有 CJS 和 ESM。

### 2.1 已跑通的 schema 写法（摘自 zod-spike.mts，tsc 通过）

```ts
import { z } from "zod";

// 时间与编号
const OffsetDateTime = z.iso.datetime({ offset: true }); // 必须带偏移或 Z
const HHmm = z.iso.time({ precision: -1 }); // 只接受 HH:mm；-1 即 z.TimePrecision.Minute
const YMD = z.iso.date(); // YYYY-MM-DD
const Id = z.uuid();

const Checkin = z.object({
  id: Id,
  type: z.enum(["wake", "sleep"]),
  at: OffsetDateTime,
  source: z.enum(["desktop", "phone"]),
});
type Checkin = z.infer<typeof Checkin>;

const Task = z.object({
  id: Id,
  title: z.string().min(1, "标题不能为空"),
  list: z.string().min(1),
  status: z.enum(["open", "done", "dropped"]),
  createdAt: OffsetDateTime,
  doneAt: OffsetDateTime.nullable(),
  due: YMD.nullable(),
  checkpoints: z.array(z.string()),
  notes: z.string(),
});
const TasksFile = z.object({ version: z.literal(1), lists: z.array(z.string()), tasks: z.array(Task) });

const Review = z.object({ done: z.string(), learned: z.string(), change: z.string(), at: OffsetDateTime });
const PlanFile = z.object({
  version: z.literal(1),
  date: YMD,
  energy: z.enum(["high", "mid", "low"]).nullable(),
  timeline: z.array(z.object({ start: HHmm, end: HHmm, title: z.string(), taskId: Id.nullable() })),
  taskIds: z.array(Id),
  review: Review.nullable(),
});

// union 与 discriminatedUnion
const Weight = z.union([z.number().positive(), z.null()]); // null、70 通过，-1 不通过
const AddTask = z.object({
  name: z.literal("add_task"),
  args: z.object({
    title: z.string().min(1).describe("任务标题"),
    list: z.string().optional().describe("清单名，省略时用收集箱"),
    due: YMD.nullable().optional(),
  }),
});
const CompleteTask = z.object({ name: z.literal("complete_task"), args: z.object({ taskId: Id }) });
const LogWeight = z.object({ name: z.literal("log_weight"), args: z.object({ kg: z.number().positive().max(500) }) });
const Action = z.discriminatedUnion("name", [AddTask, CompleteTask, LogWeight]);
type Action = z.infer<typeof Action>;

// @ts-expect-error type 只能是 wake / sleep（tsc 确认 z.infer 的类型生效）
const badCheckin: Checkin = { id: "x", type: "nap", at: "", source: "desktop" };

function describeAction(a: Action): string {
  switch (a.name) { // 按 name 收窄，a.args 的类型随之确定
    case "add_task": return `加任务 ${a.args.title}`;
    case "complete_task": return `完成 ${a.args.taskId}`;
    case "log_weight": return `体重 ${a.args.kg}`;
  }
}
describeAction({ name: "log_weight", args: { kg: 76.5 } }); // "体重 76.5"
```

`z.TimePrecision` 由 `zod` 根导出（`v4/classic/external.d.ts`），值为 `{ Any: null, Minute: -1, Second: 0, Millisecond: 3, Microsecond: 6 }`。另用 node 单独核对过：`z.iso.time({ precision: z.TimePrecision.Minute })` 对 "04:00" 返回 true，对 "04:00:00" 返回 false，和 -1 一样。

### 2.2 格式校验实测

带偏移的时间：

| 输入 | `z.iso.datetime({ offset: true })` | `z.iso.datetime()` |
|---|---|---|
| `2026-10-23T07:02:11+08:00` | 通过 | 拒绝 |
| `2026-10-23T07:02:11.123+08:00` | 通过 | 拒绝 |
| `2026-10-23T07:02:11Z` | 通过 | 通过 |
| `2026-10-23T07:02:11`（没有偏移） | 拒绝 | 拒绝 |
| `2026-10-23T07:02+08:00`（没有秒） | 拒绝 | 拒绝 |
| `2026-10-23T07:02:11+0800`、`…+08` | 拒绝 | 拒绝 |
| `2026-10-23 07:02:11+08:00`（空格代替 T） | 拒绝 | 拒绝 |
| `2026-02-30T07:02:11+08:00`、`2026-10-23T24:00:00+08:00` | 拒绝 | 拒绝 |

HH:mm（右列的正则是 `/^([01]\d|2[0-3]):[0-5]\d$/`，两者结果完全一致）：

| 输入 | `z.iso.time({ precision: -1 })` / 正则 | `z.iso.time()` |
|---|---|---|
| `04:00`、`23:59`、`00:00` | 通过 | 通过 |
| `4:00`、`24:00`、`04:60`、`0400` | 拒绝 | 拒绝 |
| `04:00:00` | 拒绝 | 通过（默认也接受带秒） |

YYYY-MM-DD（`z.iso.date()`）：`2026-10-23`、`2028-02-29` 通过；`2026-02-29`、`2026-04-31`、`2026-13-01`、`2026-2-3`、`20261023` 拒绝。

编号：`z.uuid()` 接受 `randomUUID()` 生成的值及其大写形式，拒绝 `"123"`。它的正则允许版本 1–8 和全 0、全 f 两个特殊值；只想要 v4 时用 `z.uuidv4()`。

未知字段（在 Checkin 上多加一个 `note`）：

- `z.object(...)`：parse 成功，结果里静默去掉了 `note`
- `z.strictObject(Checkin.shape)`：报 `{ code: "unrecognized_keys", keys: ["note"], path: [] }`
- `z.looseObject(Checkin.shape)`：原样保留 `note`

### 2.3 safeParse 的返回值与错误对象

```ts
const r = TasksFile.safeParse(data);
if (r.success) {
  r.data; // 已去掉未知字段
} else {
  r.error instanceof z.ZodError; // true，r.error.name === "ZodError"
  r.error.issues; // 每条都有 code、path、message，其余字段随 code 变化
}
```

同一份坏数据（version: 2、id: "abc"、title 为空、status: "finished"、createdAt 没有偏移、due: "2026-2-3"）得到 6 条 issue，形状如下（pattern 省略）：

```json
{ "code": "invalid_value", "values": [1], "path": ["version"], "message": "Invalid input: expected 1" }
{ "origin": "string", "code": "invalid_format", "format": "uuid", "pattern": "…", "path": ["tasks", 0, "id"], "message": "Invalid UUID" }
{ "origin": "string", "code": "too_small", "minimum": 1, "inclusive": true, "path": ["tasks", 0, "title"], "message": "标题不能为空" }
{ "code": "invalid_value", "values": ["open", "done", "dropped"], "path": ["tasks", 0, "status"], "message": "Invalid option: expected one of \"open\"|\"done\"|\"dropped\"" }
{ "origin": "string", "code": "invalid_format", "format": "datetime", "pattern": "…", "path": ["tasks", 0, "createdAt"], "message": "Invalid ISO datetime" }
{ "origin": "string", "code": "invalid_format", "format": "date", "pattern": "…", "path": ["tasks", 0, "due"], "message": "Invalid ISO date" }
```

discriminatedUnion 的两种错误：

```json
{ "code": "invalid_union", "errors": [], "note": "No matching discriminator", "discriminator": "name", "options": ["add_task", "complete_task", "log_weight"], "path": ["name"], "message": "Invalid discriminator value. Expected 'add_task' | 'complete_task' | 'log_weight'" }
{ "expected": "number", "code": "invalid_type", "path": ["args", "kg"], "message": "Invalid input: expected number, received string" }
```

- 自定义消息（`min(1, "标题不能为空")`）原样出现在 message 里，任何 locale 下都不变。
- `z.flattenError(error)` 只展开一层：数组里的错误全堆在 `fieldErrors.tasks` 下，看不出是第几项的哪个字段，不适合给用户看。

### 2.4 把错误转成中文提示（三种写法都跑通）

```ts
// 写法 1：只对这一次 parse 用中文，不改全局
const zh = z.locales.zhCN();
const r = TasksFile.safeParse(bad, { error: zh.localeError });
if (!r.success) console.log(z.prettifyError(r.error));

// 写法 2：全局切成中文（进程里所有 schema 都生效）；切回英文用 z.config(z.locales.en())
z.config(z.locales.zhCN());

// 写法 3：遍历 issues，自己拼"字段：消息"，给界面用
const FIELD_LABELS: Record<string, string> = { title: "标题", status: "状态", createdAt: "创建时间", due: "截止日期", id: "编号", version: "版本" };
export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((iss) => {
    const where = iss.path.map((p) => (typeof p === "number" ? `第 ${p + 1} 项` : FIELD_LABELS[String(p)] ?? String(p))).join(" › ");
    return where ? `${where}：${iss.message}` : iss.message;
  });
}
```

同一份坏数据的实际输出。默认 locale 下的 `z.prettifyError`：

```text
✖ Invalid input: expected 1
  → at version
✖ Invalid UUID
  → at tasks[0].id
✖ 标题不能为空
  → at tasks[0].title
……
```

写法 1 或写法 2（zhCN）下的 `z.prettifyError`：

```text
✖ 无效输入：期望 1
  → at version
✖ 无效UUID
  → at tasks[0].id
✖ 标题不能为空
  → at tasks[0].title
✖ 无效选项：期望以下之一 "open"|"done"|"dropped"
  → at tasks[0].status
✖ 无效ISO日期时间
  → at tasks[0].createdAt
✖ 无效ISO日期
  → at tasks[0].due
```

全局 zhCN 下另外两个样例：`kg: -1` 得到"数值过小：期望 number >0"；`start: "9:00"` 得到"无效ISO时间"。

写法 3（zhCN locale 加 formatIssues）：

```text
版本：无效输入：期望 1
tasks › 第 1 项 › 编号：无效UUID
tasks › 第 1 项 › 标题：标题不能为空
tasks › 第 1 项 › 状态：无效选项：期望以下之一 "open"|"done"|"dropped"
tasks › 第 1 项 › 创建时间：无效ISO日期时间
tasks › 第 1 项 › 截止日期：无效ISO日期
```

（`tasks` 不在标签表里，所以原样输出。表里加一条 `tasks: "任务"` 就行。）

结论：zhCN 下 `prettifyError` 的 "→ at" 和 `tasks[0].title` 这种路径写法仍然是英文、JS 风格，消息里也会夹着 "number" 这样的英文词。所以开发日志用 `prettifyError`，界面提示用 zhCN locale 加 `formatIssues`。

### 2.5 z.toJSONSchema

签名（`v4/core/to-json-schema.d.ts`）：`z.toJSONSchema(schema, params?)`。params 里有 `target?: "draft-04" | "draft-07" | "draft-2020-12" | "openapi-3.0"`、`unrepresentable?: "throw" | "any"`、`io?: "input" | "output"`、`cycles?: "ref" | "throw"`、`reused?: "ref" | "inline"`，还有 `override`、`metadata`。

`z.toJSONSchema(AddTask.shape.args)` 的实际输出（date 的 pattern 省略）：

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "title": { "type": "string", "minLength": 1, "description": "任务标题" },
    "list": { "description": "清单名，省略时用收集箱", "type": "string" },
    "due": { "anyOf": [{ "type": "string", "format": "date", "pattern": "…" }, { "type": "null" }] }
  },
  "required": ["title"],
  "additionalProperties": false
}
```

- 默认输出 draft-2020-12，并带上 `$schema`。传 `{ target: "draft-07" }` 后 `$schema` 变成 `http://json-schema.org/draft-07/schema#`，其余内容相同。
- `discriminatedUnion` 转成 `oneOf`；`z.literal("add_task")` 转成 `{ "type": "string", "const": "add_task" }`。
- 带 `optional()` 的字段不进 `required`；`nullable()` 转成 `anyOf [..., { "type": "null" }]`；`describe()` 转成 `description`；`z.object` 转成 `additionalProperties: false`。
- `z.uuid()` 转成 `format: "uuid"` 加 pattern；`z.iso.date()` 转成 `format: "date"` 加 pattern；HH:mm 只有 pattern `^(?:[01]\d|2[0-3]):[0-5]\d$`；`z.number().positive()` 转成 `exclusiveMinimum: 0`。
- `z.object({ at: z.date() })` 会抛错 "Date cannot be represented in JSON Schema"。要给 AI 工具用的 schema，时间字段一律写成字符串 schema。

## 3. chokidar 5.0.0

### 3.1 包形态与 API（来自 index.d.ts、handler.d.ts 和 index.js）

- 只有 ESM：`"type": "module"`，exports 只有 `.`（指向 `./index.js`），`engines.node >= 20.19.0`。在 Node 24 的 CJS 里 `require("chokidar")` 能用（require(esm)）；Electron 44 下没验证。
- `watch(paths: string | string[], options?: ChokidarOptions): FSWatcher`

```ts
// index.d.ts 里的原样定义（BasicOpts 已展开）
type ChokidarOptions = Partial<{
  persistent: boolean; ignoreInitial: boolean; followSymlinks: boolean; cwd?: string;
  usePolling: boolean; interval: number; binaryInterval: number; alwaysStat?: boolean;
  depth?: number; ignorePermissionErrors: boolean; atomic: boolean | number;
  ignored: Matcher | Matcher[];
  awaitWriteFinish: boolean | Partial<{ stabilityThreshold: number; pollInterval: number }>;
}>;
type Matcher = string | RegExp | ((val: string, stats?: Stats) => boolean) | { path: string; recursive?: boolean };
```

- 默认值（index.js）：persistent true，ignoreInitial false，usePolling false，interval 100，binaryInterval 300，followSymlinks true。`atomic` 默认等于 `!usePolling`，也就是 true：unlink 延迟 100 ms 再发，并忽略编辑器的交换文件（`.swp`、`~` 结尾等）。`awaitWriteFinish: true` 等于 `{ stabilityThreshold: 2000, pollInterval: 100 }`。环境变量 `CHOKIDAR_USEPOLLING`、`CHOKIDAR_INTERVAL` 会覆盖选项。
- 事件：`add`、`addDir`、`change`、`unlink`、`unlinkDir`、`ready`、`raw`、`error`、`all`。`all` 的回调参数是 `(event, path, stats?)`。实测 `ready` 不会出现在 `all` 里，`error` 要单独 `on("error")`。
- `close(): Promise<void>`：实测 resolve 的值是 undefined，耗时约 0.1 ms。另外还有 `add()`、`unwatch()`、`getWatched()`。
- 事件里的路径：不设 `cwd` 时是绝对路径，Windows 上是反斜杠（例如 `…\data\记录-0.jsonl`）。
- `ignored` 函数收到的是正斜杠路径（`C:/Users/…/工作区 测试/data`），而且同一个路径会被调两次：第一次没有 stats，第二次才有。所以判断不能依赖 stats。

### 3.2 推荐配置（3.3 的延迟就是用这份配置测的）

```ts
import { watch } from "chokidar";

// 只监听 管家人格.md、课表.md 和 data/；忽略备份目录和原子写的临时文件
const ignored = (p: string) => /[\\/]\.history([\\/]|$)/.test(p) || p.endsWith(".tmp");
const watcher = watch([personaPath, schedulePath, dataDir], { ignoreInitial: true, ignored });
watcher.on("all", (event, filePath) => {
  // add / change：可能变了，重新读；unlink：文件不在了
});
watcher.on("error", (err) => { /* 记日志 */ });
await new Promise<void>((resolve) => watcher.once("ready", () => resolve())); // 实测约 6 ms
// 退出时
await watcher.close();
```

不建议开 `awaitWriteFinish`：

- 自己的写都是原子替换，每次只产生一个 change。
- 外部程序慢写时，默认配置在写完的那一刻会再发一个 change（见 3.4）。设计里 500 ms 的尾部防抖会等到最后一个事件之后再重渲染，已经兜住了。
- 开了以后每个事件都要多等 stabilityThreshold，而且要轮询 stat。真要用，必须写成对象形式；写 `true` 会等 2 s。

### 3.3 Windows 上的延迟实测

路径是 `…\work\chokidar\工作区 测试\`（带中文和空格），文件名也是中文（`记录-0.jsonl`、`管家人格.md`、`课表.md`）。延迟的算法是事件到达的时刻减去操作 await 完成的时刻，单位 ms；负数表示事件比 await 先到。

默认配置（3.2），每种操作 20 次，没有漏报：

| 操作 | 收到的事件 | p50 | p95 | max |
|---|---|---|---|---|
| 新建文件 | add | 1.6 | 3.8 | 3.8 |
| appendFile 追加一行 | change | 0 | 0.3 | 0.3 |
| writeFile 整体覆盖 | change | -2.2 | -0.9 | -0.9 |
| 原子替换（rename） | change（只有 1 个） | 0 | 0.4 | 0.4 |
| 删除文件 | unlink | 107 | 109.1 | 109.1 |
| 在子目录 data\plans 里新建 | add | 1.1 | 4.2 | 4.2 |
| 修改单独监听的 .md | change | -0.3 | -0.2 | -0.2 |
| 原子替换单独监听的 .md | change | 0 | 0.1 | 0.1 |

加上 `awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 20 }`，每种 10 次：add 和 change 的 p50 在 119–123 ms，最大 129 ms；unlink 还是约 107 ms。`ready` 约 6 ms。

### 3.4 行为细节（实测）

- 负延迟是真的：writeFile 覆盖写时，change 在写入开始约 3 ms、writeFile resolve 之前约 1.8 ms 就到了（10 次结果一致）。所以"写完再标记这是自己写的"来不及，要在写之前登记。
- 删除会晚约 100 ms 才报（`atomic` 默认开着）。这 100 ms 里又出现同名文件的话，会合并成一个 change。
- 单独监听的文件（课表.md）删除后再重建，发的是 change，不是 add；之后继续正常监听。
- 原子写如果不忽略 `.tmp`，会依次看到临时文件的 add、change，目标文件的 change，再是临时文件的 unlink。
- 10 次连续写，间隔约 5 ms：默认配置收到 3 个 change（change 有 50 ms 节流）；awaitWriteFinish 100 ms 时只收到 1 个。
- 外部程序分 3 段慢慢写，总共 470 ms：默认配置在 2 ms 和 472 ms（写完时）各收到一个 change；awaitWriteFinish 300 ms 时只在 790 ms 收到一个。
- 整个 data/ 删掉再重建：依次收到 unlinkDir、unlink、add、change。监听没有中断，也没有 error。
- `ignoreInitial: false` 时启动会报 `add:管家人格.md`、`add:课表.md`、`addDir:data`、`add:data\tasks.json`、`addDir:data\plans`，`.history` 已被忽略。
- 只单独监听根目录下的两个 .md 时，根目录里的其他文件（`其他.txt`、`管家人格.md.bak`、`归档\2026\2026-W43\周报.md`）都不触发事件。`getWatched()` 的键里有这个根目录，因为 chokidar 是靠监听父目录来实现单文件监听的。
- 自己连续原子写 200 次：默认配置收到 41 个事件，awaitWriteFinish 时 1 个；对 rename 没有任何干扰（见 §5）。

`ignored` 的几种写法和 glob（监听 data/，依次写入 `tasks.json`、`.history\1.json`、`a.tmp`）：

| 写法 | 收到的事件 |
|---|---|
| 不设 ignored | add `.history\1.json`、add `a.tmp`、add `tasks.json`（有时还跟一个 change，看时序） |
| `.history` 目录的绝对路径字符串 | add `a.tmp`、add `tasks.json`；路径用反斜杠或正斜杠都能匹配 |
| `{ path: historyDir, recursive: true }` | add `a.tmp`、add `tasks.json` |
| 正则数组（规则和 3.2 的函数相同） | 只有 `tasks.json` 的 add（和一个 change） |
| `"**/*.tmp"` | 什么都没忽略：字符串只按字面路径匹配 |
| 监听路径写成 `data\*.json` | 没有任何事件，也没有 error，`getWatched()` 为空 |

### 3.5 对实施的要求

- 处理事件时 add 和 change 一视同仁，都当作"内容可能变了，重新读"。原因：重建文件发的是 change，删除后马上重建也会合并成 change。
- 自己写入也会触发事件，而且覆盖写的事件比 await 先到。建议在写之前登记"预期内容的哈希"，收到事件后读文件比对，一样就忽略。（这是建议，还没实现验证。）
- 不要依赖 glob。要么监听具体的文件和目录，要么用函数或正则做 ignored。
- chokidar 只有 ESM，主进程的打包方式要在脚手架阶段确认（见 §7）。

## 4. date-fns 4.4.0

### 4.1 用法与实测输出

下面的 INSTANT 是 `new Date("2026-10-22T13:53:36.789Z")`，本机时区 Asia/Shanghai。

```ts
import { addDays, differenceInCalendarDays, format, formatISO, getISODay, getISOWeek, getISOWeekYear, isValid, parseISO, startOfISOWeek } from "date-fns";
import { zhCN } from "date-fns/locale";

formatISO(INSTANT);                              // "2026-10-22T21:53:36+08:00"：本机偏移，精确到秒，能过 z.iso.datetime({ offset: true })
formatISO(INSTANT, { representation: "date" });  // "2026-10-22"
INSTANT.toISOString();                           // "2026-10-22T13:53:36.789Z"：UTC，不要拿来存
parseISO("2026-10-23T07:02:11+08:00");           // 带偏移：结果和本机时区无关
parseISO("2026-10-23");                          // 只有日期：本机零点（上海时区下是 2026-10-22T16:00:00.000Z）
parseISO("2026-10-23T07:02:11");                 // 没有偏移：按本机时间解析
isValid(parseISO("2026-13-45"));                 // false。parseISO 不抛错，返回 Invalid Date
format(INSTANT, "yyyy-MM-dd");                   // "2026-10-22"
format(INSTANT, "HH:mm");                        // "21:53"
format(INSTANT, "M月d日 EEEE", { locale: zhCN }); // "10月22日 星期四"
format(INSTANT, "RRRR-'W'II");                   // "2026-W43"
format(INSTANT, "YYYY-MM-DD");                   // 先 console.warn，再抛 RangeError（提示改用 yyyy）
`${getISOWeekYear(d)}-W${String(getISOWeek(d)).padStart(2, "0")}`; // 周键，与 "RRRR-'W'II" 在所有测试日期上一致
startOfISOWeek(d);                               // 当周周一 00:00（本机时间）
getISODay(d);                                    // 1 是周一，7 是周日
addDays(d, 1);
differenceInCalendarDays(parseISO("2026-10-25"), parseISO("2026-10-22")); // 3
```

每个函数都另有一个可选的 `in` 选项（指定计算用的时区上下文），这次没有用到。

### 4.2 ISO 周边界（4 个时区下结果完全一致）

| 日期 | ISO 周 | 当周周一 | getISODay |
|---|---|---|---|
| 2020-12-31 | 2020-W53 | 2020-12-28 | 4 |
| 2021-01-03 | 2020-W53 | 2020-12-28 | 7 |
| 2021-01-04 | 2021-W01 | 2021-01-04 | 1 |
| 2024-12-29 | 2024-W52 | 2024-12-23 | 7 |
| 2024-12-30 | 2025-W01 | 2024-12-30 | 1 |
| 2025-01-01 | 2025-W01 | 2024-12-30 | 3 |
| 2026-10-22 | 2026-W43 | 2026-10-19 | 4 |
| 2026-12-28 | 2026-W53 | 2026-12-28 | 1 |
| 2027-01-01 | 2026-W53 | 2026-12-28 | 5 |
| 2027-01-03 | 2026-W53 | 2026-12-28 | 7 |
| 2027-01-04 | 2027-W01 | 2027-01-04 | 1 |

归档路径 `归档/<年>/<年-W周>/` 里的"年"必须用 ISO 周年（`getISOWeekYear`）。如果用日历年，2027-01-01 会被放进 `归档/2027/2026-W53/`。

### 4.3 逻辑日期的实现（logical-day.mts，tsc 通过）

```ts
// 按 dayStartsAt 把带偏移的 ISO 时间归到逻辑日期（纯函数，不依赖本机时区）
import { formatISO } from "date-fns";

const ISO_LOCAL_PART = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;
const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "HH:mm" → 当天第几分钟 */
export function minutesOfDay(hhmm: string): number {
  const m = HH_MM.exec(hhmm);
  if (!m) throw new Error(`时间应为 HH:mm：${hhmm}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** "YYYY-MM-DD" 加减天数（用 UTC 做纯日历运算，避开夏令时） */
export function shiftDate(ymd: string, days: number): string {
  const [y, mo, d] = ymd.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, mo - 1, d + days)).toISOString().slice(0, 10);
}

/** 逻辑日期：取记录自己的墙上时间（偏移之前的部分），早于 dayStartsAt 的归前一天 */
export function logicalDateOf(at: string, dayStartsAt: string): string {
  const m = ISO_LOCAL_PART.exec(at);
  if (!m) throw new Error(`不是 ISO 时间：${at}`);
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  const minutes = Number(m[4]) * 60 + Number(m[5]);
  return minutes < minutesOfDay(dayStartsAt) ? shiftDate(date, -1) : date;
}

/** 当前时刻 → 带本机偏移的 ISO 字符串（存储用） */
export function nowISO(now: Date = new Date()): string {
  return formatISO(now);
}

/** 今天的逻辑日期 */
export function logicalToday(dayStartsAt: string, now: Date = new Date()): string {
  return logicalDateOf(nowISO(now), dayStartsAt);
}
```

为什么直接比较墙上时间，而不是 `subHours(date, 4)` 再取日期：减法减的是绝对时间，在夏令时切换的那天，墙上时间会差出 1 小时；直接比较墙上时间没有这个问题。另外它不依赖本机时区，同一条记录在哪台机器上算，结果都一样。（这一段是设计上的理由，不是测出来的。）

边界测试：dayStartsAt = 04:00，在进程里把 `process.env.TZ` 依次设成 Asia/Shanghai、America/New_York、Europe/London、America/Santiago，每个时区都跑一遍，48/48 通过。

| 时间 | 逻辑日期 | ISO 周 | 说明 |
|---|---|---|---|
| 2026-10-23T00:30:00+08:00 | 2026-10-22 | 2026-W43 | 凌晨归前一天 |
| 2026-10-23T03:59:59+08:00 | 2026-10-22 | 2026-W43 | |
| 2026-10-23T04:00:00+08:00 | 2026-10-23 | 2026-W43 | 正好 04:00 算当天 |
| 2026-10-23T23:59:59+08:00 | 2026-10-23 | 2026-W43 | |
| 2026-11-01T00:30:00+08:00 | 2026-10-31 | 2026-W44 | 跨月 |
| 2026-03-01T01:00:00+08:00 | 2026-02-28 | 2026-W09 | 平年 2 月 |
| 2028-03-01T01:00:00+08:00 | 2028-02-29 | 2028-W09 | 闰年 2 月 |
| 2027-01-01T03:59:00+08:00 | 2026-12-31 | 2026-W53 | 跨年 |
| 2027-01-04T03:59:00+08:00 | 2027-01-03 | 2026-W53 | 跨 ISO 周 |
| 2027-01-04T04:00:00+08:00 | 2027-01-04 | 2027-W01 | |
| 2026-10-23T00:30:00-05:00 | 2026-10-22 | 2026-W43 | 其他偏移：按它自己的墙上时间算 |
| 2026-10-23T00:30:00+08:00，dayStartsAt 为 00:00 | 2026-10-23 | 2026-W43 | 00:00 就是自然日 |

性能：10 万次 `logicalDateOf` 用时 208 ms，约 2 µs 一次。

以 Z 结尾的时间要先规范成本机偏移（extra-checks.mts 实测）：

```ts
logicalDateOf("2026-10-22T20:30:00Z", "04:00");                     // "2026-10-22"：按 UTC 的墙上时间 20:30 算了
logicalDateOf(formatISO(parseISO("2026-10-22T20:30:00Z")), "04:00"); // "2026-10-23"：先变成 2026-10-23T04:30:00+08:00
```

传 Date 进去时走本机时区：`logicalToday("04:00", new Date("2026-10-23T03:30:00+08:00"))` 在上海得到 2026-10-22；在纽约也是 2026-10-22（formatISO 给出 `2026-10-22T15:30:00-04:00`）。

### 4.4 热力图：最近 12 周，周一开头

```ts
const today = logicalToday("04:00", new Date("2026-10-23T02:00:00+08:00")); // "2026-10-22"
const firstMonday = format(addDays(startOfISOWeek(parseISO(today)), -7 * 11), "yyyy-MM-dd"); // "2026-08-03"
const grid = Array.from({ length: 84 }, (_, i) => shiftDate(firstMonday, i)); // 最后一格 "2026-10-25"（本周日）
```

实测：共 84 格，第一格是周一，包含今天。

### 4.5 夏令时与本地零点

这台机器的时区没有夏令时，但用户的电脑可能有。对 8 个日期各算一次 `d = parseISO(日期)`、`next = addDays(d, 1)`：

| 时区 | 日期 | `Math.floor((next - d) / 86400000)` | `differenceInCalendarDays(next, d)` |
|---|---|---|---|
| America/New_York | 2026-03-08 | 0 | 1 |
| Europe/London | 2026-03-29 | 0 | 1 |
| 其他日期、其他时区 | — | 1 | 1 |

- America/Santiago 的 2026-09-06 没有零点（夏令时从 0 点开始），`parseISO("2026-09-06")` 得到当地 01:00，但日期没错。
- 结论：算天数差用 `differenceInCalendarDays`；对 "YYYY-MM-DD" 字符串做加减用 `shiftDate`（UTC 运算）；不要用毫秒数除以 86400000。

## 5. Windows 原子写与 JSONL 追加

### 5.1 测试方法

- 目标文件是 `work\atomic\数据 目录\tasks.json`，每次写约 5 KB、含中文的 JSON。每个场景连续写 200 次，上一次 await 完再写下一次。
- "直接 rename"：写好临时文件后只 rename 一次（`retry: false`）。"可靠实现"：5.3 的 `writeFileAtomic`。
- 另一个进程只读打开、一直不关：`hold-open.ps1` 用 `[System.IO.File]::Open($Path, 'Open', 'Read', [System.IO.FileShare]$Share)` 打开后 sleep。`$Share` 分别取 `Read`、`ReadWrite`、`ReadWrite, Delete`。中文路径作为参数传给 powershell.exe 没有问题。
- 短暂占用：`reader-loop.ps1`（PowerShell 里 `[System.IO.File]::ReadAllBytes` 死循环）、`reader-loop-node.mts`（另一个 Node 进程 `readFileSync` 死循环）、`inprocess-read.mts`（同一进程里 `readFile` 异步死循环，文件约 12 KB）。用来模拟杀毒软件、索引、同步盘、编辑器预览这类短暂占用。

### 5.2 实测结果（每个场景 200 次）

| 场景 | 直接 rename 失败数 | 可靠实现失败数 | 可靠实现：重试总次数；每次写耗时 p50 / p95 / max（ms） |
|---|---|---|---|
| 没有干扰，不 fsync | 0 | 0 | 0；1.1 / 1.7 / 1.9 |
| 没有干扰，fsync | 0 | 0 | 0；2.6 / 3.1 / 43.2 |
| chokidar 默认配置在监听 | 0 | 0 | 0；5.1 / 7.2 / 8.1 |
| chokidar + awaitWriteFinish | 0 | 0 | 0；4.6 / 6.9 / 19.5 |
| PowerShell 只读打开不关，Share=Read | 200（EPERM） | 单次写 10.0 s 后抛 EPERM | — |
| 同上，Share=ReadWrite | 200（EPERM） | 单次写 10.0 s 后抛 EPERM | — |
| 同上，Share=ReadWrite, Delete | 200（EPERM） | 单次写 10.0 s 后抛 EPERM | — |
| 占用 1.5 s 后释放 | — | 0 | 29（都在同一次写上）；2.7 / 3.1 / 1617.9 |
| PowerShell 读循环 | 156（EPERM） | 0 | 393；27.7 / 172.2 / 371.5 |
| 另一个 Node 进程读循环 | 181（EPERM） | 0 | 2007；291.2 / 1580.3 / 2823 |
| 同进程异步读循环 | 173（EPERM） | 0 | 1316 |
| 同进程，读写都走同一个队列 | 0（不重试） | — | — |

补充：

- rename 失败时的错误码全是 EPERM，没见到 EBUSY 和 EACCES。即使对方打开时带了 `FileShare.Delete`（Share=ReadWrite, Delete），或者对方是另一个 Node 进程在读，rename 照样失败。
- 不走原子替换、直接 `writeFile` 覆盖被占用的文件：Share=Read 时报 EBUSY；Share=ReadWrite 或 ReadWrite, Delete 时能成功。
- 所有场景结束后都没有残留的 `.tmp`，最终内容都等于最后一次成功写入的内容。
- 读的一方：PowerShell 读了 20.4 万次，其中 221 次失败；Node 读了 19.6 万次，0 次失败。所以读的一方也要容忍偶发的读失败。
- fsync 让每次写多花约 1.5 ms（p50 从 1.1 ms 变成 2.6 ms）。

### 5.3 可靠实现（atomic-write.mts，5.2 里的"可靠实现"就是它）

```ts
// Windows 上可靠的原子替换：写临时文件 → fsync → rename 覆盖，遇到占用就退避重试
import { open, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

// Windows 上文件被别的进程占用时，rename 报这三种
const RETRYABLE = new Set(["EPERM", "EBUSY", "EACCES"]);

export interface AtomicWriteOptions {
  fsync?: boolean; // 默认 true：先落盘再改名
  retry?: boolean; // 默认 true；false 用于对照测试
  maxWaitMs?: number; // 重试总时长上限，默认 10000
  maxDelayMs?: number; // 单次等待上限，默认 50
}

export interface AtomicWriteResult {
  retries: number;
  codes: string[]; // 每次重试前遇到的错误码
  waitedMs: number;
}

/** 临时文件名：同目录（保证同一卷，rename 才是原子的），以 .tmp 结尾便于监听时忽略 */
export function tempPathFor(target: string): string {
  return path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
}

export async function writeFileAtomic(target: string, data: string, opts: AtomicWriteOptions = {}): Promise<AtomicWriteResult> {
  const { fsync = true, retry = true, maxWaitMs = 10_000, maxDelayMs = 50 } = opts;
  const tmp = tempPathFor(target);
  const fh = await open(tmp, "wx"); // wx：临时文件已存在就报错
  try {
    await fh.writeFile(data, "utf8");
    if (fsync) await fh.sync();
  } catch (err) {
    await fh.close().catch(() => {});
    await rm(tmp, { force: true });
    throw err;
  }
  await fh.close();

  const started = performance.now();
  const codes: string[] = [];
  for (;;) {
    try {
      await rename(tmp, target);
      return { retries: codes.length, codes, waitedMs: performance.now() - started };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "";
      // 5, 10, 20, 40, 50, 50…（再乘 0.5~1.5 的抖动，避免和占用方节奏同步）
      const delay = Math.min(maxDelayMs, 5 * 2 ** codes.length) * (0.5 + Math.random());
      if (!retry || !RETRYABLE.has(code) || performance.now() - started + delay > maxWaitMs) {
        await rm(tmp, { force: true }).catch(() => {});
        throw err;
      }
      codes.push(code);
      await sleep(delay);
    }
  }
}
```

### 5.4 退避参数是怎么定的

| 版本 | 参数 | Node 读循环 | PowerShell 读循环 |
|---|---|---|---|
| v1（结果在 atomic-v1-cap200ms-budget3s.json） | 10 ms 起翻倍，200 ms 封顶，总共 3 s，没有抖动 | 37/200 失败，p50 781.5 ms，最长约 3 s（撞上限） | 0 失败，max 1422.9 ms |
| v2（现行） | 5 ms 起翻倍，50 ms 封顶，乘 0.5~1.5 的随机抖动，总共 10 s | 0 失败，p50 291.2 ms，max 2823 ms | 0 失败，max 371.5 ms |

其他场景两版差不多。可能的原因（推断）：读的一方开、关文件的节奏很密，空隙很短，等待上限小一些、再加上抖动，更容易落进空隙。

### 5.5 对实施的要求

1. 状态文件一律用 `writeFileAtomic`。临时文件放在同一目录（同一个卷上 rename 才是原子的），名字以 `.tmp` 结尾（chokidar 配置里忽略它），用 `"wx"` 打开。
2. 自己进程里的读一样会挡住 rename（同进程读循环、不重试时 173/200 失败）。读和写都走同一个写队列，或者读内存缓存，就连重试都用不上（实测 0 失败、0 重试）。不要长时间持有状态文件的 FileHandle，也不要用流去读状态文件。
3. 持续占用靠重试解决不了，10 s 后会抛 EPERM。写队列要保住这次要写的数据（不能丢），界面提示"文件被其他程序占用：<文件名>"，之后再重试。
4. 不要退回到直接 `writeFile` 兜底：占用方只给了读共享时它也会失败（EBUSY），能成功的时候又不是原子的。
5. 队列用的最小实现（inprocess-read.mts 里跑过）：

```ts
// 最小串行队列：同一时刻只有一个操作碰文件
class FileQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(op: () => Promise<T>): Promise<T> {
    const p = this.tail.then(op);
    this.tail = p.catch(() => {}); // 前一个失败不影响后面的
    return p;
  }
}
```

### 5.6 同一进程里并发 appendFile 追加 JSONL

做法：用 `Promise.all` 同时对同一个文件发起所有 `appendFile(file, line, "utf8")`，每行是一条以 `\n` 结尾的 JSON。"保持顺序"那一列是 seq 比上一行大的行数，等于总行数才说明顺序完全没乱。

| 用例 | 行数 | 单行大小 | 坏行 | 保持顺序 |
|---|---|---|---|---|
| 小行，并发 | 2000 | 60 B–4 KB | 0 | 1423/2000 |
| 中等行，并发 | 300 | 16–400 KB | 0 | 230/300 |
| 每 3 行有 1 行 500 KiB，并发 | 120 | 最大 512 070 B | 0 | 79/120 |
| 每 3 行有 1 行 520 KiB，并发 | 120 | 最大 532 548 B | 79 | 34/120 |
| 每 3 行有 1 行 1 MiB，并发 | 120 | 最大 1 048 644 B | 75 | 38/120 |
| 每 3 行有 1 行恰好 524 288 B（含 `\n`），并发，3 轮 | 90 | 524 288 B | 0、0、0 | 63、59、60 |
| 每 3 行有 1 行恰好 524 289 B，并发，3 轮 | 90 | 524 289 B | 55、55、55 | 31、27、31 |
| 打卡大小，并发 | 5000 | 160 B | 0 | 3303/5000 |
| 打卡大小，串行（逐条 await） | 5000 | 160 B | 0 | 5000/5000 |
| 每 3 行有 1 行 1 MiB，串行 | 90 | 1 MiB | 0 | 90/90 |

- 单行不超过 512 KiB（524 288 字节）时行不会交错；只要多 1 个字节，就一定交错：文件总字节数没变，但大行被切开，和别的行混在一起。这个阈值和 Node 的 `fs.promises.writeFile` 每次最多写 512 KiB 吻合（推断，没有看 Node 源码）。
- 并发追加时，落盘顺序不等于调用顺序。
- 串行追加：顺序完全保持，1 MiB 的行也不会坏。代价是每条约 0.53 ms（5000 条 2659 ms）；并发时每条约 0.23 ms。
- 写出的文件开头都没有 BOM。
- 结论：追加也走写队列、逐条 await。这样既没有 512 KiB 的限制，也能保证顺序。打卡、体重这类记录一行远小于 512 KiB。

### 5.7 容错读取 JSONL（append-spike.mts 实测）

```ts
// 容错读取：跳过坏行、记下行号；末尾没换行的半行也算坏行
export async function readJsonl<T>(file: string, schema: z.ZodType<T>) {
  const text = await readFile(file, "utf8");
  const records: T[] = [];
  const badLines: number[] = [];
  text.split("\n").forEach((raw, i) => {
    const l = raw.replace(/\r$/, ""); // 容忍外部编辑器留下的 CRLF
    if (l.trim() === "") return;
    let parsed: unknown;
    try { parsed = JSON.parse(l); } catch { badLines.push(i + 1); return; }
    const r = schema.safeParse(parsed);
    if (r.success) records.push(r.data); else badLines.push(i + 1);
  });
  return { records, badLines };
}
```

测试文件有 6 行：好行、`{坏行`、以 `\r` 结尾的好行、缺字段的行、空行、被截断的半行。结果读出 2 条记录，`badLines` 为 `[2, 4, 6]`：空行跳过、不算坏行，CRLF 结尾的行正常读出。

### 5.8 BOM（extra-checks.mts 实测）

`readFile(file, "utf8")` 不会去掉 BOM：读出来的第一个字符是 U+FEFF（65279），`JSON.parse` 抛 SyntaxError；先 `text.replace(/^﻿/, "")` 就正常。用户手改的 管家人格.md、课表.md，以及可能被手改的 JSON（有些编辑器会存成带 BOM 的 UTF-8），读入时都先去掉 BOM。`writeFile(..., "utf8")` 写出的文件不带 BOM。

## 6. crypto.randomUUID（uuid-spike.mts）

```ts
import { randomUUID } from "node:crypto";

randomUUID();                   // "a548c5f5-2dcc-4e3a-9ab2-82c6814c8604"
globalThis.crypto.randomUUID(); // 全局的 Web Crypto 也能用
```

| 检查项 | 结果 |
|---|---|
| 两种写法的 typeof | 都是 function |
| `z.uuidv4()` 校验 | 两个样本、以及 10 万个里的前 1000 个全部通过，第 15 位都是 "4" |
| 大小写 | 全小写 |
| 唯一性 | 10 万个没有重复 |
| 速度 | 0.912 µs 一个 |

建议在主进程（也就是写数据的一方）生成 ID。

## 7. 没有验证的部分

- Electron 44 主进程加载 chokidar：chokidar 只有 ESM。Node 24 的 require(esm) 能用，但 Electron 44 自带的 Node 版本，以及 electron-vite 5 是把依赖打进包还是留作外部依赖，都没测。脚手架阶段先跑一个最小的主进程，里面 `import { watch } from "chokidar"`，确认 dev 和打包后都能加载。
- 渲染进程里的 `crypto.randomUUID`：Web 标准只在安全上下文提供它，Electron 渲染进程（file:// 或自定义协议）里没验证。
- Vitest 5 里固定时区：只验证了在运行时设置 `process.env.TZ` 会立刻生效（Windows 上也是）。Vitest 的配置写法没测。
- 真实的杀毒软件、Windows Search 索引、OneDrive 这类同步盘：只用读循环模拟了短暂占用。本机 OneDrive 没在运行，Documents 也没有被重定向。
- 断电后的完整性：fsync 只测了耗时。
- 网络盘、FAT32/exFAT、U 盘上的 rename 和监听。
- chokidar 在上千个文件的目录下的启动耗时和内存。
- zod 的 `treeifyError`、`formatError`，以及 `toJSONSchema` 的 `io: "input"`、`override`、`metadata`。
- AI SDK 是直接收 zod schema 还是要先转 JSON Schema：不在本次范围，这里只验证了 `z.toJSONSchema` 的输出。

## 8. 坑清单（写实施计划时逐条落实）

1. chokidar 5 只有 ESM，主进程怎么加载要在脚手架阶段先确认。
2. chokidar 不支持 glob：`ignored` 里的字符串按精确路径匹配，`"**/*.tmp"` 不起作用；监听路径写成 glob 会静默地什么都不监听，也不报错。
3. `ignored` 函数收到的是正斜杠路径，同一路径会被调两次，第一次没有 stats；事件里的路径却是反斜杠。
4. unlink 晚约 100 ms 才报，这期间重建会合并成 change；单独监听的文件删除后重建，发的也是 change。add 和 change 要一样处理。
5. 覆盖写时 change 比 `writeFile` resolve 早约 2 ms，"这是自己写的"要在写之前登记。
6. 必须忽略 `.tmp` 和 `.history`，否则每次原子写都会多出临时文件的 add、change、unlink 事件。
7. `awaitWriteFinish: true` 等于 2000 ms 的稳定阈值；不开它，靠 500 ms 防抖。
8. `z.iso.datetime()` 不加 `{ offset: true }` 时会拒绝 `+08:00`；`z.iso.time()` 默认也接受 `HH:mm:ss`，只要 HH:mm 得加 `precision: -1`（即 `z.TimePrecision.Minute`）。
9. zhCN 下 `prettifyError` 里仍有英文的 "→ at" 和 JS 风格的路径；`flattenError` 只展开一层。界面提示用 `formatIssues`。
10. `z.object` 会静默去掉未知字段：用户手动加进 JSON 的字段，下次保存时就没了。要保留就用 `z.looseObject`。
11. `z.toJSONSchema` 遇到 `z.date()` 会抛错，时间字段一律用字符串 schema。
12. date-fns 的格式串写 `YYYY-MM-DD` 会先 warn 再抛 RangeError。日期用 `yyyy-MM-dd`，ISO 周用 `RRRR-'W'II`。
13. 归档目录 `归档/<年>/<年-W周>/` 的年份要用 ISO 周年：2027-01-02 属于 `归档/2026/2026-W53/`。
14. `parseISO("YYYY-MM-DD")` 得到本机零点（有的时区当天没有零点）；没有偏移的时间按本机时间解析；非法输入返回 Invalid Date，不会抛错。
15. 天数差不要用毫秒数除以 86400000（夏令时那天会算成 0），用 `differenceInCalendarDays` 或 `shiftDate`。
16. 存时间用 `formatISO`（`+08:00`，到秒），不要用 `toISOString`（UTC，带毫秒）。
17. 以 Z 结尾的时间会按 UTC 的墙上时间归日，读入时先用 `formatISO(parseISO(at))` 规范化。
18. Windows 上目标文件只要被打开着（任何共享模式，包括带 `FileShare.Delete`），rename 就报 EPERM；直接 `writeFile` 遇到只给读共享的占用会报 EBUSY。三种错误码都当可重试。
19. 重试参数：5 ms 起翻倍、50 ms 封顶、乘 0.5~1.5 的抖动、最多 10 s。持续占用重试也没用，要在界面上报错，并保住待写数据。
20. 自己进程里的读也会让 rename 失败：读写走同一个队列，或者读内存缓存。
21. 并发 `appendFile` 的单行超过 512 KiB 就会交错，而且并发时顺序不保证：追加也要串行。
22. `readFile(..., "utf8")` 不会去掉 BOM，手改过的文件要先去 BOM 再解析。
23. fsync 让每次写多约 1.5 ms，可以接受。
24. Git Bash 里 `TZ=America/New_York node …` 这种前缀不生效（MSYS 不会把它传下去）。要么在进程里设 `process.env.TZ`（Windows 上立刻生效），要么用 PowerShell 的 `$env:TZ`。
25. 本机 ANSI 代码页是 936（gb2312）。中文路径作为参数传给 powershell.exe 没问题；读子进程的中文输出时要注意解码，这一点没测。
26. 本机 git 的 `core.autocrlf=true`（系统级配置），butler-app 仓库里没有 `.gitattributes`，LF 的测试样例文件检出后可能变成 CRLF。建议脚手架阶段加 `.gitattributes`（`* text=auto eol=lf`）。

