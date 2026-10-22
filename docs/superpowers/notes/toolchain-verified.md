# 工具链验证记录（2026-10-22）

在临时项目里实际装过、跑过的结果。环境：Windows 11、Node 24.16.0、npm 11.13.0、npmmirror 源。搭脚手架时照这里的配置来。

## 结论

- 能跑通的组合：Electron 44.7.0 + electron-vite 5.0.0 + Vite 7.3.7 + React 19.3.0 + TypeScript 6.0.3 + Vitest 5.0.3 + Playwright 1.64.0。`build`、`typecheck`、`test`（6 个测试）、`test:e2e`（冒烟 0.9 秒）、`dev` 都通过。
- 主进程是 ESM（package.json 里 `"type": "module"`），产物 `out/main/index.js`。chokidar 5 只有 ESM，在这个主进程里直接 `import` 就能用，ready 和 add 事件正常。
- 预加载必须是 CommonJS：`sandbox: true` 时 ESM 预加载会报 `Cannot use import statement outside a module`，`window.butler` 变成 undefined。electron-vite 配置里把 preload 的 `output.format` 设成 `cjs`，产物是 `out/preload/index.cjs`。
- Electron 44.7.0 自带的 Node 是 v24.21.0，所以 `@types/node` 用 24.x。
- Electron 二进制要走镜像：package.json 里设 `config.electron_mirror` 为 `https://npmmirror.com/mirrors/electron/`，再加 `"postinstall": "install-electron"`。第一次下载约 4 分钟。`.npmrc` 写 `save-exact=true`。
- 从 VS Code 的终端启动时会继承环境变量 `ELECTRON_RUN_AS_NODE`，electron.exe 被当成普通 Node 运行，报 `The requested module 'electron' does not provide an export named 'BrowserWindow'`。Playwright 启动时要复制环境变量并去掉它；手动 `npm run dev` 前也要先清掉（PowerShell：`Remove-Item Env:ELECTRON_RUN_AS_NODE`）。
- 测试时用环境变量 `BUTLER_USER_DATA_DIR` 指定独立的 userData 目录，主进程在 ready 之前 `app.setPath('userData', …)`，测试就不会碰真实数据。

## package.json（要点）

```json
{
  "type": "module",
  "main": "out/main/index.js",
  "config": { "electron_mirror": "https://npmmirror.com/mirrors/electron/" },
  "scripts": {
    "postinstall": "install-electron",
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "typecheck": "tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json",
    "test": "vitest run",
    "test:e2e": "electron-vite build && playwright test"
  }
}
```

依赖和精确版本见主计划的 Tech Stack。

## electron.vite.config.ts

```ts
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  // sandbox: true 只能加载 CommonJS，强制输出 cjs
  preload: { build: { rollupOptions: { output: { format: 'cjs' } } } },
  renderer: { plugins: [react()] },
})
```
## tsconfig（三个文件）

`tsconfig.json`：

```json
{ "files": [], "references": [{ "path": "./tsconfig.node.json" }, { "path": "./tsconfig.web.json" }] }
```

`tsconfig.node.json`（主进程、预加载、共享代码、测试和各种配置文件）：

```json
{
  "compilerOptions": {
    "composite": true,
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.node.tsbuildinfo",
    "target": "ES2024", "lib": ["ES2024"],
    "module": "ESNext", "moduleResolution": "Bundler",
    "types": ["node"],
    "strict": true, "verbatimModuleSyntax": true, "isolatedModules": true,
    "noEmit": true, "skipLibCheck": true
  },
  "include": ["electron.vite.config.ts", "vitest.config.ts", "playwright.config.ts",
    "src/main/**/*", "src/preload/**/*", "src/shared/**/*", "tests/unit/**/*", "tests/e2e/**/*"]
}
```

`tsconfig.web.json`：和上面相同，只把 `tsBuildInfoFile` 换成 `tsconfig.web.tsbuildinfo`，`lib` 改成 `["ES2024", "DOM"]`，加 `"jsx": "react-jsx"`，`types` 改成 `["vite/client"]`，`include` 改成 `["src/renderer/**/*", "src/shared/**/*", "tests/ui/**/*"]`。

## vitest.config.ts

同一个配置里分两个项目：`unit` 跑 node 环境，`ui` 跑 jsdom 环境并用 React 插件。

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', environment: 'node', include: ['tests/unit/**/*.test.ts'] } },
      {
        plugins: [react()],
        test: { name: 'ui', environment: 'jsdom', include: ['tests/ui/**/*.test.tsx'], setupFiles: ['tests/ui/setup.ts'] },
      },
    ],
  },
})
```

## playwright.config.ts 与冒烟测试写法

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1, // 每次启动一个 Electron，串行跑，避免抢窗口和 userData
  timeout: 60_000,
  reporter: 'list',
  outputDir: 'test-results',
})
```

启动方式（`tests/e2e/*.spec.ts`）：

```ts
import { _electron as electron } from '@playwright/test'

// 复制环境变量并去掉 ELECTRON_RUN_AS_NODE
function electronEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value
  }
  return { ...env, ...extra }
}

const app = await electron.launch({ args: ['.'], env: electronEnv({ BUTLER_USER_DATA_DIR: userDataDir }) })
const window = await app.firstWindow()
```

## 窗口与预加载（验证通过的写法）

```ts
new BrowserWindow({
  width: 900, height: 640, show: false,
  webPreferences: {
    preload: join(import.meta.dirname, '../preload/index.cjs'),
    contextIsolation: true, sandbox: true, nodeIntegration: false,
  },
})
// 开发时 process.env.ELECTRON_RENDERER_URL 有值，用 loadURL；打包后用 loadFile('../renderer/index.html')
```

预加载里用 `contextBridge.exposeInMainWorld('butler', api)` 暴露一个对象，订阅类的方法返回取消订阅函数。

## 没验证的部分

- electron-builder 打包（只装了包）。
- 渲染进程里 `crypto.randomUUID` 在 file:// 下是否可用（编号一律在主进程生成可以绕开）。
- Electron 的 `safeStorage`、`Tray`、`Notification`、`setLoginItemSettings` 的运行表现。
