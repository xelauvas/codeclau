import type { RemoteSkillMeta } from './remoteSkillState.js'

export type RemoteSkillLoadResult = { content: string; fromCache: boolean }

export async function loadRemoteSkill(meta: RemoteSkillMeta): Promise<RemoteSkillLoadResult> {
  throw new Error(
    `Remote skills are not available in this build (requested ${meta.slug}). Install the skill locally under .claude/skills or the config dir.`,
  )
}
