import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('package.json', () => {
  it('所有依赖都是精确版本，不带 ^ 或 ~', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
      expect(version, name).toMatch(/^\d+\.\d+\.\d+$/)
    }
  })
})
