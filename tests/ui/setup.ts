import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// 没开 globals，Testing Library 不会自己注册清理
afterEach(() => cleanup())
