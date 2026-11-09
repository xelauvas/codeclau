import { logForDebugging } from '../../utils/debug.js'

export function logRemoteSkillLoaded(slug: string, details?: Record<string, unknown>): void {
  logForDebugging(`[skill-search] remote skill loaded ${slug} ${details ? JSON.stringify(details) : ''}`)
}

export function logSkillDiscovery(details: Record<string, unknown>): void {
  logForDebugging(`[skill-search] ${JSON.stringify(details)}`)
}
