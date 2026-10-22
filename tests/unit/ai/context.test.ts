import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildContext } from '../../../src/main/ai/context'
import { shortId } from '../../../src/main/ai/taskRef'
import { addCheckin } from '../../../src/main/app/services'
import { updateEnergy, updatePlanTasks } from '../../../src/main/app/services-plan'
import { changeProfile, logWeight, logWorkout, recordLearning } from '../../../src/main/app/services-records'
import { createTask } from '../../../src/main/app/services-tasks'
import { PATHS, planPath } from '../../../src/shared/paths'
import { emptyPlan, emptyProfile, PlanFile } from '../../../src/shared/schema'
import { openTestSession, useShanghaiTimezone } from '../app/helpers'

const tz = useShanghaiTimezone()
beforeEach(tz.enter)
afterEach(tz.leave)

let test: Awaited<ReturnType<typeof openTestSession>>
beforeEach(async () => {
  test = await openTestSession()
})
afterEach(async () => {
  await test.cleanup()
})
const ctx = () => test.session.ctx()

/** 周五（2026-10-23）的一个有内容的工作区 */
async function seed() {
  const buck = await createTask(ctx(), { title: '学 Buck 电路', list: '学习', checkpoints: ['电感饱和会怎样？'], addToToday: true })
  const report = await createTask(ctx(), { title: '写周报', due: '2026-10-30' })
  const old = await createTask(ctx(), { title: '昨天的事' })
  await ctx().ws.writeJson(planPath('2026-10-22'), { ...emptyPlan('2026-10-22'), taskIds: [old.id] }, PlanFile)
  await updateEnergy(ctx(), 'mid')
  await addCheckin(ctx(), 'wake')
  await logWeight(ctx(), 76.4)
  await logWorkout(ctx(), { summary: '跑步', durationMin: 30 })
  await recordLearning(ctx(), { topic: 'Buck', taskId: buck.id, checks: [{ q: '占空比公式', result: 'partial' }] })
  const profile = emptyProfile()
  profile.goals.weightTargetKg = 70
  profile.schedule.fixed = [{ weekday: 5, start: '08:00', end: '09:40', title: '电力电子' }, { weekday: 1, start: '08:00', end: '09:40', title: '周一的课' }]
  await changeProfile(ctx(), profile)
  await ctx().ws.writeText(PATHS.schedule, '# 课表\n周五 08:00 电力电子\n')
  return { buck, report, old }
}

describe('buildContext：按场景挑内容', () => {
  it('chat：只有现在、打卡、今天的计划', async () => {
    const { buck } = await seed()
    const text = await buildContext(ctx(), { scene: 'chat', strategy: 'scene' })
    expect(text).toContain('现在：2026-10-23 12:00；今天的日期：2026-10-23（周五，第 43 周）')
    expect(text).toContain('起床 12:00')
    expect(text).toContain('精力：😐 一般')
    expect(text).toContain(`${shortId(buck.id)} [学习] 学 Buck 电路`)
    for (const absent of ['## 课表', '## 任务库里进行中的任务', '## 用户的目标和作息', '## 最近的学习检验']) expect(text).not.toContain(absent)
  })

  it('plan（晨会）：固定安排只列今天周几的、课表、昨天没做完的、任务库、最近 7 天', async () => {
    const { report, old } = await seed()
    const text = await buildContext(ctx(), { scene: 'plan', strategy: 'scene' })
    expect(text).toContain('08:00-09:40 电力电子')
    expect(text).not.toContain('周一的课')
    expect(text).toContain('周五 08:00 电力电子') // 课表
    expect(text).toMatch(/## 昨天没做完的任务\n- \[ \] \w{8} \[收集箱\] 昨天的事/)
    expect(text).toContain(`${shortId(report.id)} [收集箱] 写周报（截止 2026-10-30）`)
    expect(text).toContain('## 最近 7 天')
    expect(text).toContain('健身 1 次')
    expect(text).not.toContain('最近的学习检验')
    expect(text).not.toContain('## 今天涉及的') // 复盘才带检验点
    expect(text).toContain(shortId(old.id))
  })

  it('review（复盘）：带检验点的任务、最近的学习检验；不带任务库', async () => {
    await seed()
    const text = await buildContext(ctx(), { scene: 'review', strategy: 'scene' })
    expect(text).toContain('（检验点：电感饱和会怎样？）')
    expect(text).toContain('## 最近的学习检验\n- Buck：占空比公式→部分掌握')
    expect(text).not.toContain('## 任务库里进行中的任务')
    expect(text).not.toContain('## 课表')
  })

  it('weekly：现在和最近 7 天', async () => {
    await seed()
    const text = await buildContext(ctx(), { scene: 'weekly', strategy: 'scene' })
    expect(text).toContain('## 最近 7 天')
    expect(text).not.toContain('## 今天的计划')
  })
})

describe('buildContext：三种策略', () => {
  it('full：什么都带，包括目标和作息、最近的体重和健身', async () => {
    await seed()
    const text = await buildContext(ctx(), { scene: 'chat', strategy: 'full' })
    for (const title of ['现在', '今天的打卡', '今天的计划', '今天的固定安排', '课表', '昨天没做完的任务', '任务库里进行中的任务', '最近 7 天', '用户的目标和作息', '最近的学习检验', '最近的体重和健身']) {
      expect(text, title).toContain(`## ${title}`)
    }
    expect(text).toContain('目标体重：70 kg')
    expect(text).toContain('体重：2026-10-23 76.4kg')
  })

  it('tools：只带最基本的，再提示可以用查询工具自己查', async () => {
    await seed()
    const text = await buildContext(ctx(), { scene: 'plan', strategy: 'tools' })
    expect(text).toContain('## 今天的计划')
    expect(text).toContain('get_tasks')
    expect(text).not.toContain('## 任务库里进行中的任务')
    expect(text).not.toContain('## 课表')
  })

  it('三种策略的长度：tools < scene(plan) < full', async () => {
    await seed()
    const len = async (scene: 'plan', strategy: 'scene' | 'full' | 'tools') => (await buildContext(ctx(), { scene, strategy })).length
    expect(await len('plan', 'tools')).toBeLessThan(await len('plan', 'scene'))
    expect(await len('plan', 'scene')).toBeLessThan(await len('plan', 'full'))
  })
})

describe('buildContext：边界', () => {
  it('全新的工作区：每一节都有合理的“没有”', async () => {
    const text = await buildContext(ctx(), { scene: 'plan', strategy: 'full' })
    expect(text).toContain('今天还没有打卡')
    expect(text).toContain('（用户还没写课表）')
    expect(text).toContain('（用户还没填目标和作息）')
    expect(text).toContain('（最近几天还没有记录）')
    expect(text).toContain('精力：还没选')
  })

  it('任务库里的任务超过 30 条：只列前 30 条并说明还有多少', async () => {
    for (let i = 1; i <= 35; i++) await createTask(ctx(), { title: `任务${i}` })
    const text = await buildContext(ctx(), { scene: 'plan', strategy: 'scene' })
    expect(text).toContain('任务30')
    expect(text).not.toContain('任务31')
    expect(text).toContain('（还有 5 条没列出）')
  })

  it('今天计划里的任务和任务库里的同一个任务编号一致', async () => {
    const a = await createTask(ctx(), { title: 'A' })
    await updatePlanTasks(ctx(), [a.id])
    const text = await buildContext(ctx(), { scene: 'plan', strategy: 'scene' })
    expect(text.split(shortId(a.id)).length - 1).toBeGreaterThanOrEqual(2) // 今天的计划里一次，任务库里一次
  })
})
