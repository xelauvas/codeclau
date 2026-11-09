import { isEnvTruthy } from '../utils/envUtils.js'

/**
 * Entitlement gate for assistant (KAIROS) mode. Upstream this asks a remote
 * feature service; a local build has nobody to ask, so it is on unless
 * explicitly disabled.
 */
export async function isKairosEnabled(): Promise<boolean> {
  if (isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_ASSISTANT)) return false
  return true
}

export function isKairosEnabledSync(): boolean {
  return !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_ASSISTANT)
}
