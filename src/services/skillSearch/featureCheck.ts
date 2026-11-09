import { feature } from 'bun:bundle'
import { isEnvTruthy } from '../../utils/envUtils.js'

/**
 * Skill search replaces the full skill listing in the system prompt with
 * per-turn "skills relevant to your task" suggestions. Local-only here: the
 * index is lexical, over the skills installed on this machine.
 */
export function isSkillSearchEnabled(): boolean {
  if (!feature('EXPERIMENTAL_SKILL_SEARCH')) return false
  return !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_SKILL_SEARCH)
}
