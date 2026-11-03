import type { ZenithApi } from '@shared/types'

declare global {
  interface Window {
    zenith: ZenithApi
  }
}

export const api: ZenithApi = window.zenith
