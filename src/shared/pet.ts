// 桌宠（dsh-pet）接入的设置。放在这台电脑的 config.json 里，不进工作区。

export interface PetSettings {
  enabled: boolean
  /** dsh-pet 的接口地址，只接受本机 */
  baseUrl: string
  petId: string
  /** 把 Butler 的状态映射成桌宠的工作状态 */
  status: boolean
  /** 在桌宠右键菜单里加 Butler 的入口 */
  menu: boolean
  /** 管家台词 */
  lines: boolean
  /** 台词让模型写（限频）；关掉就只用本地模板 */
  linesUseModel: boolean
  /** 模型台词的最短间隔，单位分钟 */
  linesMinIntervalMin: number
  /** 打开 Butler 时，如果桌宠没在运行，就用下面的启动文件把它启动起来 */
  autoStart: boolean
  /** 桌宠的启动文件（.bat、.cmd 或 .exe），要写完整的路径。自动启动和“现在启动”才会用到 */
  launcher: string
}

/** 桌宠有没有在运行、是不是 Butler 启动的 */
export interface PetLaunchStatus {
  state: 'off' | 'external' | 'starting' | 'started' | 'missing' | 'failed' | 'stopped'
  message: string
}

export const DEFAULT_PET_SETTINGS: PetSettings = {
  enabled: false,
  baseUrl: 'http://127.0.0.1:3080/dsh-pet-7340',
  petId: 'main',
  status: true,
  menu: true,
  lines: true,
  linesUseModel: true,
  linesMinIntervalMin: 10,
  autoStart: false,
  launcher: '',
}

export interface PetTestResult {
  ok: boolean
  message: string
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** 地址只能是本机的 http 地址：任务名会发给它，不能发到别处。没问题返回 null */
export function loopbackProblem(baseUrl: string): string | null {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    return '地址不对，应该像 http://127.0.0.1:3080/dsh-pet-7340'
  }
  if (url.protocol !== 'http:') return '只支持 http 地址'
  if (!LOOPBACK_HOSTS.has(url.hostname)) return '只能连本机：地址里的主机要是 127.0.0.1、localhost 或 [::1]'
  return null
}

/** 读配置文件里的桌宠设置：缺的、类型不对的字段一律用默认值，不抛错 */
export function parsePetSettings(raw: unknown): PetSettings {
  const o = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const d = DEFAULT_PET_SETTINGS
  const bool = (key: keyof PetSettings, fallback: boolean): boolean => (typeof o[key] === 'boolean' ? o[key] : fallback)
  const text = (key: keyof PetSettings, fallback: string): string =>
    typeof o[key] === 'string' && (o[key] as string).trim() !== '' ? (o[key] as string).trim() : fallback
  const interval = o.linesMinIntervalMin
  return {
    enabled: bool('enabled', d.enabled),
    baseUrl: text('baseUrl', d.baseUrl),
    petId: text('petId', d.petId),
    status: bool('status', d.status),
    menu: bool('menu', d.menu),
    lines: bool('lines', d.lines),
    linesUseModel: bool('linesUseModel', d.linesUseModel),
    linesMinIntervalMin: typeof interval === 'number' && Number.isFinite(interval) && interval >= 1 && interval <= 240 ? Math.round(interval) : d.linesMinIntervalMin,
    autoStart: bool('autoStart', d.autoStart),
    launcher: text('launcher', d.launcher),
  }
}

/** 保存前检查。没问题返回 null，否则返回能直接给用户看的原因 */
export function checkPetSettings(input: PetSettings): string | null {
  const problem = loopbackProblem(input.baseUrl.trim())
  if (problem) return problem
  const id = input.petId.trim()
  if (id === '' || id.length > 64) return '宠物 id 不能为空，也不能超过 64 个字'
  if (!Number.isInteger(input.linesMinIntervalMin) || input.linesMinIntervalMin < 1 || input.linesMinIntervalMin > 240) {
    return '模型台词的最短间隔要在 1 到 240 分钟之间'
  }
  const launcher = input.launcher.trim()
  if (launcher !== '') {
    if (!/^[A-Za-z]:[\\/]/.test(launcher)) return '启动文件要写完整的路径，比如 C:\\tools\\dsh-pet\\start-pet.bat'
    if (!/\.(bat|cmd|exe)$/i.test(launcher)) return '启动文件只支持 .bat、.cmd 或 .exe'
    if (/[<>|*?"%&^]/.test(launcher)) return '启动文件的路径里有不能用的字符（< > | * ? " % & ^）'
  }
  return null
}

/** 去掉首尾空白和地址末尾的斜杠 */
export function normalizePetSettings(input: PetSettings): PetSettings {
  return { ...input, baseUrl: input.baseUrl.trim().replace(/\/+$/, ''), petId: input.petId.trim(), launcher: input.launcher.trim() }
}
