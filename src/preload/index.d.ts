import type { ViewDeckBridge } from '@shared/ipc'

declare global {
  interface Window {
    /** Typed IPC bridge installed by src/preload/index.ts. */
    viewdeck: ViewDeckBridge
  }
}

export {}
