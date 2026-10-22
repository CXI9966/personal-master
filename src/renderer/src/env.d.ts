import type { ButlerApi } from '../../shared/ipc'

declare global {
  interface Window {
    /** preload 暴露的全部能力 */
    butler: ButlerApi
  }
}
