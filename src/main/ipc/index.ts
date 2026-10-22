import { z } from 'zod'
import type { Channel, Request, Response } from '../../shared/ipc'
import type { Platform } from '../app/context'
import { addCheckin, restoreFile, undoChange } from '../app/services'
import type { Session } from '../app/session'
import { buildToday } from '../app/snapshots'

/** 每个通道一个处理函数；少一个、多一个都会编译报错 */
export type Handlers = { [C in Channel]: (request: Request<C>) => Promise<Response<C>> }

const CheckinType = z.enum(['wake', 'sleep'])
const PersonaId = z.enum(['coach', 'gentle', 'strict'])
const Folder = z.string().min(1)

export function createHandlers(session: Session, platform: Platform): Handlers {
  return {
    'app:state': () => session.state(),
    'workspace:pick': () => platform.pickFolder(),
    'workspace:inspect': ({ root }) => session.inspect(Folder.parse(root)),
    'workspace:init': ({ root, persona }) => session.initialize(Folder.parse(root), PersonaId.parse(persona)),
    'workspace:open': ({ root }) => session.open(Folder.parse(root)),
    'today:get': () => buildToday(session.ctx()),
    'checkin:add': ({ type }) => addCheckin(session.ctx(), CheckinType.parse(type)),
    'history:undo': ({ changeId }) => undoChange(session.ctx(), z.string().min(1).parse(changeId)),
    'history:restore': ({ rel }) => restoreFile(session.ctx(), z.string().min(1).parse(rel)),
  }
}
