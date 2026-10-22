import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ACTIONS, MUTATING, QUERIES } from '../../../src/main/ai/actions'
import { ActionEngine, checkCall, type Checked } from '../../../src/main/ai/engine'
import { resolveTaskRef, shortId } from '../../../src/main/ai/taskRef'
import { undoChange } from '../../../src/main/app/services'
import { createTask } from '../../../src/main/app/services-tasks'
import { loadPlan, loadTasks } from '../../../src/main/domain/load'
import { DomainError } from '../../../src/main/domain/errors'
import { newTestId, openTestSession, useShanghaiTimezone } from '../app/helpers'

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
const engine = () => new ActionEngine(ctx(), newTestId)
let n = 0
const call = (name: string, input: unknown, extra: object = {}) => ({ id: `call_${++n}`, name, input, ...extra })

async function ok(name: string, input: unknown): Promise<Extract<Checked, { ok: true }>> {
  const checked = await checkCall(ctx(), call(name, input), ACTIONS)
  if (!checked.ok) throw new Error(`校验没通过：${checked.message}`)
  return checked
}

describe('动作表', () => {
  it('12 个改数据的动作 + 4 个只读查询；大改动正好是四个', () => {
    expect(MUTATING).toHaveLength(12)
    expect(QUERIES.map((q) => q.name).sort()).toEqual(['get_plan', 'get_profile', 'get_records', 'get_tasks'])
    expect(MUTATING.filter((d) => d.level === 'big').map((d) => d.name).sort()).toEqual(['delete_task', 'reschedule_tasks', 'set_day_plan', 'update_profile'])
    expect(new Set(ACTIONS.map((d) => d.name)).size).toBe(ACTIONS.length)
  })
})

describe('resolveTaskRef', () => {
  const tasks = [
    { id: 'aaaaaaaa-0000-4000-8000-000000000001' },
    { id: 'aaaaaabb-0000-4000-8000-000000000002' },
    { id: 'bbbbbbbb-0000-4000-8000-000000000003' },
  ] as never[]

  it('完整编号、8 位前缀、大小写都行', () => {
    expect(resolveTaskRef(tasks, 'aaaaaaaa-0000-4000-8000-000000000001').id).toContain('000000000001')
    expect(resolveTaskRef(tasks, 'BBBBBBBB').id).toContain('000000000003')
    expect(shortId('bbbbbbbb-0000-4000-8000-000000000003')).toBe('bbbbbbbb')
  })

  it('前缀不唯一或太短：报错；找不到时列出现有编号', () => {
    expect(() => resolveTaskRef(tasks, 'aaaaaa')).toThrow(/不止一个任务/)
    expect(() => resolveTaskRef(tasks, 'bbb')).toThrow(/找不到任务/)
    expect(() => resolveTaskRef(tasks, 'ffffffff')).toThrow(/aaaaaaaa、aaaaaabb、bbbbbbbb/)
    expect(() => resolveTaskRef([], 'x')).toThrow(/还没有任务/)
  })
})

describe('checkCall：执行前先校验', () => {
  it('合法：给出人能读懂的一句话', async () => {
    const checked = await ok('add_task', { title: '写周报', list: '学习', due: '2026-10-30', addToToday: true })
    expect(checked.summary).toBe('新建任务「写周报」（清单：学习），截止 2026-10-30，加入今天')
  })

  it('没有这个动作：列出可用的', async () => {
    const checked = await checkCall(ctx(), call('fly_to_moon', {}), MUTATING)
    expect(checked).toMatchObject({ ok: false })
    expect((checked as { message: string }).message).toContain('add_task')
  })

  it('查询工具不在允许列表里时也被拒绝（比如“按场景挑”策略下不给查询）', async () => {
    expect(await checkCall(ctx(), call('get_tasks', {}), MUTATING)).toMatchObject({ ok: false })
  })

  it('SDK 已经发现参数有问题：带上原因', async () => {
    const checked = await checkCall(ctx(), call('add_task', '{"title":', { invalidReason: 'JSON 解析失败' }), ACTIONS)
    expect(checked).toMatchObject({ ok: false, message: '动作 add_task 的参数有误：JSON 解析失败' })
  })

  it('参数不符合 schema：中文消息说清楚是哪个字段', async () => {
    const checked = await checkCall(ctx(), call('log_weight', { kg: -5 }), ACTIONS)
    expect(checked).toMatchObject({ ok: false })
    expect((checked as { message: string }).message).toMatch(/kg/)
    const bad = await checkCall(ctx(), call('add_plan_item', { start: '9点', end: '10:00', title: 'x' }), ACTIONS)
    expect(bad).toMatchObject({ ok: false })
  })

  it('引用的任务找不到：校验阶段就发现，消息里有现有编号', async () => {
    const task = await createTask(ctx(), { title: 'A' })
    const checked = await checkCall(ctx(), call('complete_task', { taskId: 'deadbeef' }), ACTIONS)
    expect(checked).toMatchObject({ ok: false })
    expect((checked as { message: string }).message).toContain(shortId(task.id))
  })
})

describe('ActionEngine.execute', () => {
  it('小改动直接执行：卡片是已执行，带可以撤销的改动编号', async () => {
    const outcome = await engine().execute(await ok('add_task', { title: '写周报' }))
    expect(outcome.card).toMatchObject({ name: 'add_task', level: 'small', status: 'applied', summary: '新建任务「写周报」' })
    expect(outcome.result).toMatch(/已新建任务「写周报」，编号 [0-9a-f]{8}/)
    expect((await loadTasks(ctx().ws)).tasks).toHaveLength(1)

    expect(await undoChange(ctx(), outcome.card!.changeId!)).toBe(true)
    expect((await loadTasks(ctx().ws)).tasks).toHaveLength(0)
  })

  it('执行时出错：卡片是失败，带原因，数据不变', async () => {
    const outcome = await engine().execute(await ok('add_plan_item', { start: '10:00', end: '09:00', title: '倒着的' }))
    expect(outcome.card).toMatchObject({ status: 'failed' })
    expect(outcome.card?.error).toMatch(/晚于/)
    expect(outcome.result).toMatch(/^执行失败/)
    expect((await loadPlan(ctx().ws, '2026-10-23')).timeline).toEqual([])
  })

  it('大改动：先存起来等确认，在那之前数据一点没动', async () => {
    const task = await createTask(ctx(), { title: 'A' })
    const e = engine()
    const outcome = await e.execute(await ok('delete_task', { taskId: shortId(task.id) }))
    expect(outcome.card).toMatchObject({ level: 'big', status: 'pending', summary: '删除任务「A」' })
    expect(outcome.result).toContain('用户确认')
    expect(e.hasPending()).toBe(true)
    expect((await loadTasks(ctx().ws)).tasks).toHaveLength(1)
  })

  it('确认：执行并给出改动编号；取消：什么也不做；过期的卡片报错', async () => {
    const task = await createTask(ctx(), { title: 'A' })
    const e = engine()
    const first = await e.execute(await ok('delete_task', { taskId: shortId(task.id) }))
    const done = await e.confirm(first.card!.id, true)
    expect(done).toMatchObject({ status: 'applied' })
    expect(done.changeId).toBeTruthy()
    expect((await loadTasks(ctx().ws)).tasks).toHaveLength(0)

    const second = await createTask(ctx(), { title: 'B' })
    const pending = await e.execute(await ok('delete_task', { taskId: shortId(second.id) }))
    expect(await e.confirm(pending.card!.id, false)).toMatchObject({ status: 'cancelled' })
    expect((await loadTasks(ctx().ws)).tasks).toHaveLength(1)

    await expect(e.confirm(pending.card!.id, true)).rejects.toThrowError(DomainError)
    await expect(e.confirm('不存在', true)).rejects.toThrow(/过期/)
  })

  it('确认时才执行：期间任务被删了，确认失败并说明原因', async () => {
    const task = await createTask(ctx(), { title: 'A' })
    const e = engine()
    const pending = await e.execute(await ok('delete_task', { taskId: shortId(task.id) }))
    await engine().execute(await ok('complete_task', { taskId: shortId(task.id) }))
    // 用户自己在界面里把任务删掉了
    const { removeTask } = await import('../../../src/main/app/services-tasks')
    await removeTask(ctx(), task.id)
    const confirmed = await e.confirm(pending.card!.id, true)
    expect(confirmed.status).toBe('failed')
    expect(confirmed.error).toMatch(/找不到任务/)
  })

  it('clearPending 之后，旧的卡片不能再确认', async () => {
    const task = await createTask(ctx(), { title: 'A' })
    const e = engine()
    const pending = await e.execute(await ok('delete_task', { taskId: shortId(task.id) }))
    e.clearPending()
    expect(e.hasPending()).toBe(false)
    await expect(e.confirm(pending.card!.id, true)).rejects.toThrow(/过期/)
  })
})
