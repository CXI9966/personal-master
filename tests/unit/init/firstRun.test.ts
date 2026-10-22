import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initWorkspace, isInitialized } from '../../../src/main/init/firstRun'
import { PERSONA_PRESETS } from '../../../src/main/init/personas'
import { openWorkspace, type Workspace } from '../../../src/main/store/workspace'
import { PATHS } from '../../../src/shared/paths'
import { splitPersona } from '../../../src/shared/persona'
import { defaultSettings, emptyProfile, emptyTasks, ProfileFile, SettingsFile, TasksFile } from '../../../src/shared/schema'
import { makeTempDir } from '../store/helpers'

let ctx: Awaited<ReturnType<typeof makeTempDir>>
let ws: Workspace
beforeEach(async () => {
  ctx = await makeTempDir()
  ws = await openWorkspace(ctx.dir, { watch: false })
})
afterEach(async () => {
  await ws.close()
  await ctx.cleanup()
})

describe('initWorkspace', () => {
  it('新工作区还没有初始化', async () => {
    expect(await isInitialized(ws)).toBe(false)
  })

  it('建好 data/ 下的空文件，不预填任何个人信息', async () => {
    await initWorkspace(ws, { persona: 'coach' })
    expect(await isInitialized(ws)).toBe(true)
    expect(await ws.readJson(PATHS.settings, SettingsFile)).toEqual(defaultSettings())
    expect(await ws.readJson(PATHS.profile, ProfileFile)).toEqual(emptyProfile())
    expect(await ws.readJson(PATHS.tasks, TasksFile)).toEqual(emptyTasks())
    const profile = await ws.readJson(PATHS.profile, ProfileFile)
    expect(profile.goals.weightTargetKg).toBeNull()
    expect(profile.schedule.fixed).toEqual([])
  })

  it('选哪套人格，管家人格.md 就是哪套，四栏齐全', async () => {
    for (const preset of PERSONA_PRESETS) {
      const sub = await makeTempDir()
      const w = await openWorkspace(sub.dir, { watch: false })
      await initWorkspace(w, { persona: preset.id })
      const text = await readFile(join(sub.dir, '管家人格.md'), 'utf8')
      expect(splitPersona(text), preset.name).toEqual(preset.sections)
      await w.close()
      await sub.cleanup()
    }
  })

  it('课表.md 只有标题和一句提示', async () => {
    await initWorkspace(ws, { persona: 'coach' })
    const text = await readFile(join(ctx.dir, '课表.md'), 'utf8')
    expect(text.startsWith('# 课表')).toBe(true)
  })

  it('重复运行不会覆盖用户已经改过的内容', async () => {
    await initWorkspace(ws, { persona: 'coach' })
    await writeFile(join(ctx.dir, '管家人格.md'), '# 我自己改的人格\n', 'utf8')
    await writeFile(join(ctx.dir, '课表.md'), '# 课表\n周一 8:00 电机\n', 'utf8')
    const profile = emptyProfile()
    profile.goals.weightTargetKg = 70
    await ws.writeJson(PATHS.profile, profile, ProfileFile)

    await initWorkspace(ws, { persona: 'strict' })
    expect(await readFile(join(ctx.dir, '管家人格.md'), 'utf8')).toBe('# 我自己改的人格\n')
    expect(await readFile(join(ctx.dir, '课表.md'), 'utf8')).toContain('周一 8:00 电机')
    expect((await ws.readJson(PATHS.profile, ProfileFile)).goals.weightTargetKg).toBe(70)
  })
})
