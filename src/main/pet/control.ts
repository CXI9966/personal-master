import type { PetLaunchStatus, PetSettings, PetTestResult } from '../../shared/pet'

/** 设置页对桌宠接入能做的几件事 */
export interface PetControl {
  get(): Promise<PetSettings>
  /** 保存并立即生效；开着“自动启动”的话，桌宠没在运行就顺手启动 */
  save(next: PetSettings): Promise<PetSettings>
  test(input: { baseUrl: string; petId: string }): Promise<PetTestResult>
  status(): PetLaunchStatus
  /** 现在就启动桌宠。最多等几秒，之后靠 status() 看进展 */
  launch(): Promise<PetLaunchStatus>
}
