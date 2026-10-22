import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

// 界面不直接联网（模型请求都在主进程里发），打包后用严格的内容安全策略。
// 开发模式下 Vite 会注入内联脚本做热更新，所以只在 build 时加
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
].join('; ')

const productionCsp: Plugin = {
  name: 'butler-production-csp',
  apply: 'build',
  transformIndexHtml() {
    return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }]
  },
}

export default defineConfig({
  // package.json 是 "type": "module"，主进程输出 ESM（out/main/index.js）
  main: {},
  // sandbox: true 只能加载 CommonJS 预加载脚本，强制输出 cjs（out/preload/index.cjs）
  preload: {
    build: {
      rollupOptions: {
        output: { format: 'cjs' },
      },
    },
  },
  renderer: {
    plugins: [react(), productionCsp],
  },
})
