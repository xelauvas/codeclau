/**
 * Remote ("canonical") skills live on Anthropic infrastructure and are not
 * reachable from a local build. The API is kept so SkillTool compiles and
 * behaves: nothing is ever discovered, so the prefixed names are rejected
 * with a clear message instead of a crash.
 */
export type RemoteSkillMeta = { slug: string; url: string; description?: string }

const CANONICAL_PREFIX = '_canonical_'

export function stripCanonicalPrefix(name: string): string | null {
  return name.startsWith(CANONICAL_PREFIX) ? name.slice(CANONICAL_PREFIX.length) : null
}

export function getDiscoveredRemoteSkill(_slug: string): RemoteSkillMeta | undefined {
  return undefined
}

export function registerDiscoveredRemoteSkill(_meta: RemoteSkillMeta): void {}

export function clearDiscoveredRemoteSkills(): void {}
