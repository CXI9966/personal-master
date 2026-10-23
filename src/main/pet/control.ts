import type { PetSettings, PetTestResult } from '../../shared/pet'

/** 设置页对桌宠接入能做的三件事（读、存并立即生效、试连） */
export interface PetControl {
  get(): Promise<PetSettings>
  save(next: PetSettings): Promise<PetSettings>
  test(input: { baseUrl: string; petId: string }): Promise<PetTestResult>
}
