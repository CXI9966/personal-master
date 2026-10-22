import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  // 每次启动一个 Electron，串行跑，避免抢窗口和 userData
  workers: 1,
  timeout: 60_000,
  reporter: 'list',
  outputDir: 'test-results',
})
