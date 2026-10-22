import { describe, expect, it } from 'vitest'
import { DomainError } from '../../../src/main/domain/errors'
import {
  addTaskToPlan,
  addTimelineItem,
  removeTaskFromPlan,
  removeTimelineItem,
  saveReview,
  setEnergy,
  setPlanTasks,
  setTimeline,
  unfinishedFromPlan,
} from '../../../src/main/domain/plan'
import { addTask, completeTask } from '../../../src/main/domain/tasks'
import { emptyPlan, emptyTasks, PlanFile } from '../../../src/shared/schema'

const NOW = '2026-10-23T22:40:00+08:00'
const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const item = (start: string, end: string, title = '事项') => ({ start, end, title, taskId: null })

describe('时间安排', () => {
  it('setTimeline 按开始时间排序', () => {
    const plan = setTimeline(emptyPlan('2026-10-23'), [item('14:00', '15:00', 'b'), item('09:00', '10:30', 'a')])
    expect(plan.timeline.map((t) => t.title)).toEqual(['a', 'b'])
  })

  it('结束时间必须晚于开始时间，格式必须是 HH:mm', () => {
    expect(() => setTimeline(emptyPlan('2026-10-23'), [item('10:00', '10:00')])).toThrowError(DomainError)
    expect(() => setTimeline(emptyPlan('2026-10-23'), [item('11:00', '10:00')])).toThrow(/晚于/)
    expect(() => setTimeline(emptyPlan('2026-10-23'), [item('9:00', '10:00')])).toThrow(/HH:mm/)
    expect(() => setTimeline(emptyPlan('2026-10-23'), [item('09:00', '10:00', '  ')])).toThrow(/标题/)
  })

  it('addTimelineItem 插入后仍然有序；removeTimelineItem 按下标删除', () => {
    let plan = setTimeline(emptyPlan('2026-10-23'), [item('09:00', '10:00', 'a'), item('16:00', '17:00', 'c')])
    plan = addTimelineItem(plan, item('12:00', '13:00', 'b'))
    expect(plan.timeline.map((t) => t.title)).toEqual(['a', 'b', 'c'])
    plan = removeTimelineItem(plan, 1)
    expect(plan.timeline.map((t) => t.title)).toEqual(['a', 'c'])
    expect(() => removeTimelineItem(plan, 5)).toThrowError(DomainError)
  })
})

describe('精力、任务、复盘', () => {
  it('setEnergy 可以设置也可以清掉', () => {
    let plan = setEnergy(emptyPlan('2026-10-23'), 'low')
    expect(plan.energy).toBe('low')
    plan = setEnergy(plan, null)
    expect(plan.energy).toBeNull()
  })

  it('setPlanTasks 去重并保持顺序；addTaskToPlan 重复添加无效果', () => {
    let plan = setPlanTasks(emptyPlan('2026-10-23'), [id(2), id(1), id(2)])
    expect(plan.taskIds).toEqual([id(2), id(1)])
    plan = addTaskToPlan(plan, id(1))
    plan = addTaskToPlan(plan, id(3))
    expect(plan.taskIds).toEqual([id(2), id(1), id(3)])
    expect(removeTaskFromPlan(plan, id(1)).taskIds).toEqual([id(2), id(3)])
  })

  it('saveReview 去掉首尾空白，写入时间；再次保存会覆盖', () => {
    let plan = saveReview(emptyPlan('2026-10-23'), { done: ' 写了周报 ', learned: '', change: '早点睡' }, NOW)
    expect(plan.review).toEqual({ done: '写了周报', learned: '', change: '早点睡', at: NOW })
    plan = saveReview(plan, { done: '改过', learned: 'x', change: 'y' }, NOW)
    expect(plan.review?.done).toBe('改过')
  })

  it('结果都通过 PlanFile schema', () => {
    const plan = saveReview(setEnergy(setTimeline(emptyPlan('2026-10-23'), [item('09:00', '10:00')]), 'mid'), { done: 'a', learned: 'b', change: 'c' }, NOW)
    expect(PlanFile.safeParse(plan).success).toBe(true)
  })
})

describe('unfinishedFromPlan：昨天没做完的任务', () => {
  it('只返回昨天计划里、现在还没完成的任务，顺序同计划', () => {
    let tasks = emptyTasks()
    for (const n of [1, 2, 3, 4]) tasks = addTask(tasks, { title: `t${n}` }, { id: id(n), now: NOW })
    tasks = completeTask(tasks, id(2), NOW)
    const prev = setPlanTasks(emptyPlan('2026-10-22'), [id(3), id(2), id(1)])
    expect(unfinishedFromPlan(prev, tasks).map((t) => t.title)).toEqual(['t3', 't1'])
  })

  it('没有昨天的计划就是空', () => {
    expect(unfinishedFromPlan(null, emptyTasks())).toEqual([])
  })
})
