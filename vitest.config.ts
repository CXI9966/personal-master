import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// 两个项目：unit 跑 node 环境，ui 跑 jsdom 环境
export default defineConfig({
  test: {
    // 有些测试要等文件系统事件和防抖计时器，进程开太多抢 CPU 时容易超时，所以限制并行数
    maxWorkers: 8,
    testTimeout: 20_000,
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: ['tests/ui/**/*.test.tsx'],
          setupFiles: ['tests/ui/setup.ts'],
        },
      },
    ],
  },
})
