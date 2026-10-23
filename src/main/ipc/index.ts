import { z } from 'zod'
import type { Channel, Request, Response } from '../../shared/ipc'
import type { Platform } from '../app/context'
import { addCheckin, restoreFile, undoChange } from '../app/services'
import { updateEnergy, updatePlanTasks, updateReview, updateTimeline } from '../app/services-plan'
import { changeProfile, changeSettings, logWeight, logWorkout } from '../app/services-records'
import {
  changeListName,
  changeTaskStatus,
  createList,
  createTask,
  deleteList,
  editTask,
  removeTask,
} from '../app/services-tasks'
import type { AiService } from '../ai/service'
import type { Session } from '../app/session'
import { buildDay, buildRecords, buildSettings, buildToday, checkHealth } from '../app/snapshots'
import { buildWeeklyReports } from '../app/weekly'
import { DomainError } from '../domain/errors'
import { loadTasks } from '../domain/load'
import { PERSONA_PRESETS } from '../init/personas'
import { joinPersona } from '../../shared/persona'
import type { PetControl } from '../pet/control'
import { schemas as s } from './schemas'

/** 每个通道一个处理函数；少一个、多一个都会编译报错 */
export type Handlers = { [C in Channel]: (request: Request<C>) => Promise<Response<C>> }

const Id = z.string().min(1) // 这里的 Id 只要求非空：runId、卡片 id 不一定是 UUID

export function createHandlers(session: Session, platform: Platform, ai: AiService, pet: PetControl): Handlers {
  const ctx = () => session.ctx()
  return {
    'app:state': () => session.state(),
    'workspace:pick': () => platform.pickFolder(),
    'workspace:inspect': ({ root }) => session.inspect(s.folder.parse(root)),
    'workspace:init': ({ root, persona }) => session.initialize(s.folder.parse(root), s.persona.parse(persona)),
    'workspace:open': async ({ root }) => {
      const folder = s.folder.parse(root)
      if (session.isOpen()) await ai.abortAll() // 换工作区之前先中止进行中的管家对话
      return session.open(folder)
    },
    'workspace:migrate': async ({ root }) => {
      const folder = s.folder.parse(root)
      await ai.abortAll()
      return session.migrate(folder)
    },

    'today:get': () => buildToday(ctx()),
    'day:get': ({ date }) => buildDay(ctx(), s.date.parse(date)),
    'checkin:add': ({ type }) => addCheckin(ctx(), s.checkinType.parse(type)),

    'plan:energy': ({ energy }) => updateEnergy(ctx(), s.energy.parse(energy)),
    'plan:timeline': ({ items }) => updateTimeline(ctx(), s.timeline.parse(items)),
    'plan:tasks': ({ taskIds }) => updatePlanTasks(ctx(), s.ids.parse(taskIds)),
    'plan:review': (input) => updateReview(ctx(), s.review.parse(input)),

    'tasks:get': () => loadTasks(ctx().ws),
    'tasks:add': (input) => createTask(ctx(), s.newTask.parse(input)),
    'tasks:update': ({ id, patch }) => editTask(ctx(), Id.parse(id), s.taskPatch.parse(patch)),
    'tasks:status': ({ id, status }) => changeTaskStatus(ctx(), Id.parse(id), s.taskStatus.parse(status)),
    'tasks:delete': ({ id }) => removeTask(ctx(), Id.parse(id)),
    'lists:add': ({ name }) => createList(ctx(), z.string().parse(name)),
    'lists:rename': ({ from, to }) => changeListName(ctx(), z.string().parse(from), z.string().parse(to)),
    'lists:remove': ({ name }) => deleteList(ctx(), z.string().parse(name)),

    'weight:add': ({ kg }) => logWeight(ctx(), s.weight.parse(kg)),
    'workout:add': (input) => logWorkout(ctx(), s.workout.parse(input)),
    'records:get': () => buildRecords(ctx()),
    'weekly:list': () => buildWeeklyReports(ctx()),
    'weekly:comment': ({ weekStart }) => ai.commentWeek(s.date.parse(weekStart)),

    'settings:get': async () => buildSettings(ctx(), (await session.state()).workspaceRoot ?? '', platform.getAutostart()),
    'settings:update': (patch) => changeSettings(ctx(), s.settingsPatch.parse(patch)),
    'profile:update': ({ profile }) => changeProfile(ctx(), s.profile.parse(profile)),
    'autostart:set': async ({ enabled }) => {
      if (!platform.getAutostart().supported) throw new DomainError('invalid', '开机自启只有安装好的版本才能设置，现在是开发模式')
      platform.setAutostart(z.boolean().parse(enabled))
      return platform.getAutostart()
    },

    'history:last': async () => ctx().ws.lastChange(),
    'history:undo': ({ changeId }) => undoChange(ctx(), Id.parse(changeId)),
    'history:restore': ({ rel }) => restoreFile(ctx(), Id.parse(rel)),
    'data:health': () => checkHealth(ctx()),

    'ai:status': () => ai.status(),
    'ai:save': (input) => ai.saveConfig(s.aiSave.parse(input)),
    'ai:test': (input) => ai.test(s.aiTest.parse(input)),
    'ai:send': (input) => ai.send(s.aiSend.parse(input)),
    'ai:cancel': async ({ runId }) => ai.cancel(Id.parse(runId)),
    'ai:confirm': ({ cardId, accept }) => ai.confirm(Id.parse(cardId), z.boolean().parse(accept)),
    'ai:reset': async () => ai.reset(),
    'ai:usage': () => ai.usage(),
    'persona:get': () => ai.persona(),
    'persona:save': ({ markdown }) => ai.savePersona(z.string().parse(markdown)),
    'persona:presets': async () => PERSONA_PRESETS.map((p) => ({ id: p.id, name: p.name, summary: p.summary, markdown: joinPersona(p.sections) })),

    'pet:get': () => pet.get(),
    'pet:save': (input) => pet.save(s.petSettings.parse(input)),
    'pet:test': (input) => pet.test(s.petTest.parse(input)),
  }
}
