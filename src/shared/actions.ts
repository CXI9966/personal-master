// 管家能做的事：每个动作的参数（zod）。模型通过工具调用提出，主进程校验通过才执行。
// .describe() 里的文字会随工具定义一起发给模型，所以直接写给模型看。

import { z } from 'zod'
import { Energy, HHmm, YMD } from './schema'

const taskRef = z.string().min(1).describe('任务编号：上下文里任务前面的 8 位编号，或完整编号')
const checkResult = z.enum(['mastered', 'partial', 'missed']).describe('mastered=脱稿讲清，partial=理解但讲不顺，missed=讲不出')

export const addTaskArgs = z.object({
  title: z.string().min(1).describe('任务标题'),
  list: z.string().optional().describe('清单名，省略时放进“收集箱”'),
  due: YMD.nullable().optional().describe('截止日期 YYYY-MM-DD，没有就不填'),
  checkpoints: z.array(z.string()).optional().describe('检验点：学完后要能回答的问题'),
  notes: z.string().optional().describe('备注'),
  addToToday: z.boolean().optional().describe('是否同时排进今天的计划'),
})

export const updateTaskArgs = z.object({
  taskId: taskRef,
  title: z.string().min(1).optional(),
  list: z.string().optional(),
  due: YMD.nullable().optional().describe('改截止日期；null 表示清掉'),
  checkpoints: z.array(z.string()).optional(),
  notes: z.string().optional(),
})

export const completeTaskArgs = z.object({ taskId: taskRef })

export const addPlanItemArgs = z.object({
  start: HHmm.describe('开始时间 HH:mm'),
  end: HHmm.describe('结束时间 HH:mm，必须晚于开始时间'),
  title: z.string().min(1).describe('做什么'),
})

export const saveReviewArgs = z.object({
  done: z.string().describe('今天完成了什么'),
  learned: z.string().describe('今天学会了什么'),
  change: z.string().describe('明天改什么'),
})

export const recordLearningCheckArgs = z.object({
  topic: z.string().min(1).describe('检验的主题'),
  taskId: taskRef.nullable().optional().describe('对应的任务，没有就不填'),
  checks: z
    .array(z.object({ q: z.string().min(1).describe('问的问题'), result: checkResult }))
    .min(1)
    .describe('每道题和用户答得怎么样'),
})

export const logWeightArgs = z.object({ kg: z.number().positive().max(500).describe('体重，单位公斤') })

export const logWorkoutArgs = z.object({
  summary: z.string().min(1).describe('练了什么'),
  durationMin: z.number().nonnegative().nullable().optional().describe('时长（分钟），不知道就不填'),
})

// ---- 大改动：先让用户确认 ----
export const setDayPlanArgs = z.object({
  energy: Energy.nullable().optional().describe('今天的精力：high 满电 / mid 一般 / low 疲惫；不改就不填'),
  timeline: z
    .array(z.object({ start: HHmm, end: HHmm, title: z.string().min(1) }))
    .describe('整天的时间安排，会整个替换今天原来的'),
  taskIds: z.array(taskRef).describe('今天要做的任务，会整个替换今天原来的'),
})

export const deleteTaskArgs = z.object({ taskId: taskRef })

export const rescheduleTasksArgs = z.object({
  items: z
    .array(z.object({ taskId: taskRef, due: YMD.nullable().describe('新的截止日期；null 表示清掉') }))
    .min(1),
})

export const updateProfileArgs = z.object({
  weightTargetKg: z.number().positive().nullable().optional(),
  notes: z.string().optional().describe('目标备注'),
  wakeTarget: HHmm.nullable().optional(),
  sleepTarget: HHmm.nullable().optional(),
  gymDays: z.array(z.number().int().min(1).max(7)).optional().describe('1 周一 … 7 周日'),
  fixed: z
    .array(z.object({ weekday: z.number().int().min(1).max(7), start: HHmm, end: HHmm, title: z.string().min(1) }))
    .optional()
    .describe('每周固定安排，会整个替换原来的'),
})

// ---- 只读查询 ----
export const getTasksArgs = z.object({
  list: z.string().optional().describe('只看这个清单'),
  status: z.enum(['open', 'done']).optional().describe('默认 open'),
})
export const getPlanArgs = z.object({ date: YMD.optional().describe('默认今天') })
export const getRecordsArgs = z.object({ days: z.number().int().min(1).max(30).optional().describe('最近几天，默认 7') })
export const getProfileArgs = z.object({})
