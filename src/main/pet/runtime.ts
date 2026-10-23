import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * 独立运行的 dsh-pet 每次启动都会换一个访问令牌，所有写请求都要带（读请求不用）。
 * 它把端口和令牌写在 $DSH_HOME/dsh-pet/standalone-runtime.json 里，专门给本机其他程序读取。
 * 装进 DSH 里运行的 dsh-pet 没有这个限制，也没有这个文件。
 */
export interface StandaloneRuntime {
  port: number
  token: string
}

/** 和 dsh-pet 一样：环境变量 DSH_HOME，没设置就是用户目录下的 .dsh */
export function dshHome(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.DSH_HOME?.trim()
  return home ? home : join(homedir(), '.dsh')
}

export async function readStandaloneRuntime(home: string = dshHome()): Promise<StandaloneRuntime | null> {
  try {
    const data = JSON.parse(await readFile(join(home, 'dsh-pet', 'standalone-runtime.json'), 'utf8')) as Record<string, unknown>
    if (typeof data.port !== 'number' || typeof data.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(data.token)) return null
    return { port: data.port, token: data.token }
  } catch {
    return null // 没有这个文件：不是独立运行的，或者没在运行
  }
}

/** 要发给 baseUrl 的令牌。只有运行状态文件里的端口和地址的端口一致时才给，免得把令牌发给别的服务 */
export async function tokenFor(baseUrl: string, home?: string): Promise<string | undefined> {
  const runtime = await readStandaloneRuntime(home)
  if (!runtime) return undefined
  try {
    return runtime.port === Number(new URL(baseUrl).port || 80) ? runtime.token : undefined
  } catch {
    return undefined
  }
}
