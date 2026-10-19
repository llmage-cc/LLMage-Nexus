/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Build-time switch that locks a deployment to its own XMage server
   * (`'1'` / `'true'` = ON). Unset / any other value = OFF (default).
   * See `src/setup/deploymentLock.ts`.
   */
  readonly VITE_LOCK_DEPLOYMENT?: string
}

declare const __DEMO__: boolean
