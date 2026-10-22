import { PATHS } from '../../shared/paths'
import { defaultSettings, emptyProfile, emptyTasks, ProfileFile, SettingsFile, TasksFile } from '../../shared/schema'
import { renderAll } from '../render'
import type { Workspace } from '../store/types'
import { personaMarkdown, type PersonaId } from './personas'

const SCHEDULE_TEMPLATE = '# 课表\n\n（在这里写你的课程安排，管家排计划时会参考）\n'

/** 工作区是否已经初始化过 */
export async function isInitialized(ws: Workspace): Promise<boolean> {
  return (await ws.readText(PATHS.settings)) !== null
}

/**
 * 第一次运行：补齐 data/ 下的空文件、管家人格.md、课表.md，再生成全部视图。
 * 幂等：已经存在的文件一律不动，重复运行不会覆盖用户改过的内容。
 * 目标和固定安排只给栏目、值全空，不预填任何个人信息。
 */
export async function initWorkspace(ws: Workspace, options: { persona: PersonaId; now?: Date }): Promise<void> {
  await ws.batch('初始化工作区', async (tx) => {
    if ((await tx.readText(PATHS.settings)) === null) await tx.writeJson(PATHS.settings, defaultSettings(), SettingsFile)
    if ((await tx.readText(PATHS.profile)) === null) await tx.writeJson(PATHS.profile, emptyProfile(), ProfileFile)
    if ((await tx.readText(PATHS.tasks)) === null) await tx.writeJson(PATHS.tasks, emptyTasks(), TasksFile)
    if ((await tx.readText(PATHS.persona)) === null) await tx.writeText(PATHS.persona, personaMarkdown(options.persona))
    if ((await tx.readText(PATHS.schedule)) === null) await tx.writeText(PATHS.schedule, SCHEDULE_TEMPLATE)
  })
  await renderAll(ws, { now: options.now, full: true })
}
