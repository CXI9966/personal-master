import { z } from 'zod'
import {
  ActionMode,
  ContextStrategy,
  Energy,
  HeatmapWeights,
  HHmm,
  Id,
  ProfileFile,
  ProviderKind,
  TimelineItem,
  YMD,
} from '../../shared/schema'

/** 界面传来的请求参数的校验。界面是我们自己的代码，这里是最后一道防线 */
export const schemas = {
  folder: z.string().min(1),
  persona: z.enum(['coach', 'gentle', 'strict', 'whale']),
  date: YMD,
  checkinType: z.enum(['wake', 'sleep']),
  energy: Energy.nullable(),
  timeline: z.array(TimelineItem),
  ids: z.array(Id),
  review: z.object({ done: z.string(), learned: z.string(), change: z.string() }),
  newTask: z.object({
    title: z.string(),
    list: z.string().optional(),
    due: YMD.nullable().optional(),
    checkpoints: z.array(z.string()).optional(),
    notes: z.string().optional(),
    addToToday: z.boolean().optional(),
  }),
  taskPatch: z.object({
    title: z.string().optional(),
    list: z.string().optional(),
    due: YMD.nullable().optional(),
    checkpoints: z.array(z.string()).optional(),
    notes: z.string().optional(),
  }),
  taskStatus: z.enum(['open', 'done', 'dropped']),
  weight: z.number().positive().max(500),
  workout: z.object({ summary: z.string().min(1), durationMin: z.number().nonnegative().nullable() }),
  settingsPatch: z.object({
    provider: z.object({ kind: ProviderKind.optional(), baseURL: z.string().optional(), model: z.string().optional() }).optional(),
    contextStrategy: ContextStrategy.optional(),
    actionMode: ActionMode.optional(),
    dayStartsAt: HHmm.optional(),
    weights: HeatmapWeights.partial().optional(),
    reminders: z
      .object({ enabled: z.boolean().optional(), plan: HHmm.nullable().optional(), review: HHmm.nullable().optional() })
      .optional(),
  }),
  profile: ProfileFile,
  modelConfig: z.object({ kind: ProviderKind, baseURL: z.string(), model: z.string() }),
  aiSave: z.object({
    provider: z.object({ kind: ProviderKind, baseURL: z.string(), model: z.string() }),
    contextStrategy: ContextStrategy,
    actionMode: ActionMode,
    apiKey: z.string().optional(),
    clearKey: z.boolean().optional(),
  }),
  aiTest: z.object({
    provider: z.object({ kind: ProviderKind, baseURL: z.string(), model: z.string() }),
    apiKey: z.string().optional(),
  }),
  petSettings: z.object({
    enabled: z.boolean(),
    baseUrl: z.string(),
    petId: z.string(),
    status: z.boolean(),
    menu: z.boolean(),
    lines: z.boolean(),
    linesUseModel: z.boolean(),
    linesMinIntervalMin: z.number(),
  }),
  petTest: z.object({ baseUrl: z.string(), petId: z.string() }),
  aiSend: z.object({
    messages: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string() })).min(1).max(100),
    scene: z.enum(['chat', 'plan', 'review', 'weekly']),
  }),
}
