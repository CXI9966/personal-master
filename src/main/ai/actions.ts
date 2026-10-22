import type { z, ZodType } from 'zod'
import * as A from '../../shared/actions'
import type { AppContext } from '../app/context'
import { completeTaskById } from '../app/services'
import { addPlanItem, applyDayPlan, updateReview } from '../app/services-plan'
import { logWeight, logWorkout, patchProfile, recordLearning } from '../app/services-records'
import { createTask, editTask, removeTask, rescheduleTasks } from '../app/services-tasks'
import { logicalToday } from '../domain/day'
import { loadPlan, loadProfile, loadSettings, loadSources, loadTasks } from '../domain/load'
import { formatSeq } from '../domain/learning'
import { planText, profileText, recentDaysText, taskLines } from './format'
import { resolveTaskRef, shortId } from './taskRef'

export interface ActionDef {
  name: string
  /** action 会改数据；query 只读，结果直接还给模型 */
  kind: 'action' | 'query'
  /** big 的要先让用户确认。query 一律当 small */
  level: 'small' | 'big'
  /** 发给模型的说明 */
  description: string
  schema: ZodType
  /** 给人看的一句话（用在卡片上），可能要查任务标题，所以是异步的 */
  describe(ctx: AppContext, args: unknown): Promise<string>
  /** 执行，返回给模型看的结果文字 */
  run(ctx: AppContext, args: unknown): Promise<string>
}

interface Spec<S extends ZodType> {
  name: string
  kind?: 'action' | 'query'
  level: 'small' | 'big'
  description: string
  schema: S
  describe(ctx: AppContext, args: z.output<S>): Promise<string> | string
  run(ctx: AppContext, args: z.output<S>): Promise<string>
}

function define<S extends ZodType>(spec: Spec<S>): ActionDef {
  return {
    name: spec.name,
    kind: spec.kind ?? 'action',
    level: spec.level,
    description: spec.description,
    schema: spec.schema,
    describe: async (ctx, args) => spec.describe(ctx, args as z.output<S>),
    run: (ctx, args) => spec.run(ctx, args as z.output<S>),
  }
}

const titleOf = async (ctx: AppContext, ref: string): Promise<string> =>
  `「${resolveTaskRef((await loadTasks(ctx.ws)).tasks, ref).title}」`
const idOf = async (ctx: AppContext, ref: string): Promise<string> => resolveTaskRef((await loadTasks(ctx.ws)).tasks, ref).id
const quote = (title: string): string => `「${title}」`

export const ACTIONS: ActionDef[] = [
  define({
    name: 'add_task',
    level: 'small',
    description: '新建一个任务。学习类任务建议带上检验点。',
    schema: A.addTaskArgs,
    describe: (_ctx, a) => `新建任务${quote(a.title)}${a.list ? `（清单：${a.list}）` : ''}${a.due ? `，截止 ${a.due}` : ''}${a.addToToday ? '，加入今天' : ''}`,
    run: async (ctx, a) => {
      const task = await createTask(ctx, a)
      return `已新建任务${quote(task.title)}，编号 ${shortId(task.id)}`
    },
  }),
  define({
    name: 'update_task',
    level: 'small',
    description: '修改一个任务的标题、清单、截止日期、检验点或备注。',
    schema: A.updateTaskArgs,
    describe: async (ctx, a) => `修改任务${await titleOf(ctx, a.taskId)}`,
    run: async (ctx, { taskId, ...patch }) => {
      const id = await idOf(ctx, taskId)
      await editTask(ctx, id, patch)
      return `已修改任务 ${shortId(id)}`
    },
  }),
  define({
    name: 'complete_task',
    level: 'small',
    description: '把一个任务标记为已完成。',
    schema: A.completeTaskArgs,
    describe: async (ctx, a) => `完成任务${await titleOf(ctx, a.taskId)}`,
    run: async (ctx, a) => {
      const id = await idOf(ctx, a.taskId)
      await completeTaskById(ctx, id)
      return `已完成任务 ${shortId(id)}`
    },
  }),
  define({
    name: 'add_plan_item',
    level: 'small',
    description: '在今天的时间安排里加一条（开始、结束、做什么）。',
    schema: A.addPlanItemArgs,
    describe: (_ctx, a) => `今天加一条安排：${a.start}-${a.end} ${a.title}`,
    run: async (ctx, a) => {
      await addPlanItem(ctx, a)
      return `已加入：${a.start}-${a.end} ${a.title}`
    },
  }),
  define({
    name: 'save_review',
    level: 'small',
    description: '保存今天的复盘（完成了什么、学会了什么、明天改什么）。',
    schema: A.saveReviewArgs,
    describe: () => '保存今天的复盘',
    run: async (ctx, a) => {
      await updateReview(ctx, a)
      return '已保存今天的复盘'
    },
  }),
  define({
    name: 'record_learning_check',
    level: 'small',
    description: '记录一次学习检验的结果：问了哪些问题，用户答得怎么样。只记用户真实的回答，不要放水。',
    schema: A.recordLearningCheckArgs,
    describe: (_ctx, a) => {
      const count = (r: string): number => a.checks.filter((c) => c.result === r).length
      return `记录学习检验（${a.topic}）：掌握 ${count('mastered')}、部分掌握 ${count('partial')}、没掌握 ${count('missed')}`
    },
    run: async (ctx, a) => {
      const taskId = a.taskId ? await idOf(ctx, a.taskId) : null
      const seq = await recordLearning(ctx, { topic: a.topic, taskId, checks: a.checks })
      return `已记录学习检验 ${formatSeq(seq)}`
    },
  }),
  define({
    name: 'log_weight',
    level: 'small',
    description: '记一次体重（公斤）。',
    schema: A.logWeightArgs,
    describe: (_ctx, a) => `记体重 ${a.kg} kg`,
    run: async (ctx, a) => {
      await logWeight(ctx, a.kg)
      return `已记体重 ${a.kg} kg`
    },
  }),
  define({
    name: 'log_workout',
    level: 'small',
    description: '记一次健身。',
    schema: A.logWorkoutArgs,
    describe: (_ctx, a) => `记健身：${a.summary}${a.durationMin ? `（${a.durationMin} 分钟）` : ''}`,
    run: async (ctx, a) => {
      await logWorkout(ctx, { summary: a.summary, durationMin: a.durationMin ?? null })
      return `已记健身：${a.summary}`
    },
  }),
  // ---- 大改动：先让用户确认 ----
  define({
    name: 'set_day_plan',
    level: 'big',
    description: '重排今天：整个替换今天的时间安排和任务（精力给了才改）。这是大改动，会先让用户确认。',
    schema: A.setDayPlanArgs,
    describe: async (ctx, a) => {
      const tasks = (await loadTasks(ctx.ws)).tasks
      const titles = a.taskIds.map((ref) => resolveTaskRef(tasks, ref).title)
      const timeline = a.timeline.map((t) => `${t.start}-${t.end} ${t.title}`)
      return `重排今天：时间安排 ${timeline.length} 条${timeline.length ? `（${timeline.join('；')}）` : ''}；任务 ${titles.length} 个${titles.length ? `（${titles.join('、')}）` : ''}`
    },
    run: async (ctx, a) => {
      const tasks = (await loadTasks(ctx.ws)).tasks
      await applyDayPlan(ctx, { ...a, taskIds: a.taskIds.map((ref) => resolveTaskRef(tasks, ref).id) })
      return '已按新的安排重排今天'
    },
  }),
  define({
    name: 'delete_task',
    level: 'big',
    description: '删除一个任务（不是完成，是彻底删掉）。这是大改动，会先让用户确认。',
    schema: A.deleteTaskArgs,
    describe: async (ctx, a) => `删除任务${await titleOf(ctx, a.taskId)}`,
    run: async (ctx, a) => {
      const id = await idOf(ctx, a.taskId)
      await removeTask(ctx, id)
      return `已删除任务 ${shortId(id)}`
    },
  }),
  define({
    name: 'reschedule_tasks',
    level: 'big',
    description: '批量修改多个任务的截止日期。这是大改动，会先让用户确认。',
    schema: A.rescheduleTasksArgs,
    describe: async (ctx, a) => {
      const tasks = (await loadTasks(ctx.ws)).tasks
      return `修改 ${a.items.length} 个任务的截止日期：${a.items.map((i) => `${quote(resolveTaskRef(tasks, i.taskId).title)}→${i.due ?? '无'}`).join('；')}`
    },
    run: async (ctx, a) => {
      const tasks = (await loadTasks(ctx.ws)).tasks
      await rescheduleTasks(ctx, a.items.map((i) => ({ id: resolveTaskRef(tasks, i.taskId).id, due: i.due })))
      return `已修改 ${a.items.length} 个任务的截止日期`
    },
  }),
  define({
    name: 'update_profile',
    level: 'big',
    description: '修改用户的目标和作息（目标体重、起床睡前目标、健身日、每周固定安排）。只填要改的字段。这是大改动，会先让用户确认。',
    schema: A.updateProfileArgs,
    describe: (_ctx, a) => `修改目标和作息：${Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined).join('、') || '（没有要改的）'}`,
    run: async (ctx, a) => {
      await patchProfile(ctx, a)
      return '已修改目标和作息'
    },
  }),
  // ---- 只读查询（只在“让它自己按需查”策略里提供）----
  define({
    name: 'get_tasks',
    kind: 'query',
    level: 'small',
    description: '查看任务库里的任务（默认只看进行中的），带编号。',
    schema: A.getTasksArgs,
    describe: () => '查看任务',
    run: async (ctx, a) => {
      const file = await loadTasks(ctx.ws)
      const wanted = a.status ?? 'open'
      const tasks = file.tasks.filter((t) => t.status === wanted && (a.list === undefined || t.list === a.list))
      return taskLines(tasks, 50)
    },
  }),
  define({
    name: 'get_plan',
    kind: 'query',
    level: 'small',
    description: '查看某一天的计划（默认今天）：精力、时间安排、任务、复盘。',
    schema: A.getPlanArgs,
    describe: () => '查看计划',
    run: async (ctx, a) => {
      const settings = await loadSettings(ctx.ws)
      const date = a.date ?? logicalToday(settings.dayStartsAt, ctx.now())
      const taskById = new Map((await loadTasks(ctx.ws)).tasks.map((t) => [t.id, t]))
      return `${date}\n${planText(await loadPlan(ctx.ws, date), taskById)}`
    },
  }),
  define({
    name: 'get_records',
    kind: 'query',
    level: 'small',
    description: '查看最近几天的打卡、任务完成、健身、复盘情况（默认 7 天）。',
    schema: A.getRecordsArgs,
    describe: () => '查看最近的记录',
    run: async (ctx, a) => {
      const settings = await loadSettings(ctx.ws)
      const today = logicalToday(settings.dayStartsAt, ctx.now())
      const { sources } = await loadSources(ctx.ws)
      return recentDaysText(sources, settings.dayStartsAt, today, a.days ?? 7)
    },
  }),
  define({
    name: 'get_profile',
    kind: 'query',
    level: 'small',
    description: '查看用户的目标和作息。',
    schema: A.getProfileArgs,
    describe: () => '查看目标和作息',
    run: async (ctx) => profileText(await loadProfile(ctx.ws)),
  }),
]

/** 可以改数据的动作 */
export const MUTATING = ACTIONS.filter((def) => def.kind === 'action')
/** 只读查询工具 */
export const QUERIES = ACTIONS.filter((def) => def.kind === 'query')

export const findAction = (name: string): ActionDef | undefined => ACTIONS.find((def) => def.name === name)
