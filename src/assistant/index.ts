import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { getCwd } from '../utils/cwd.js'
import { isEnvTruthy } from '../utils/envUtils.js'

/**
 * Assistant mode: a long-lived session that behaves like a personal
 * assistant (brief status messages, proactive ticks, an in-process team it
 * can delegate to). Activated by `--assistant`, CLAUDE_CODE_ASSISTANT=1, or a
 * project that ships `.claude/agents/assistant.md`.
 */
type AssistantState = { forced: boolean; teamInitialized: boolean }
const state: AssistantState = ((globalThis as unknown as { __xelaAssistant?: AssistantState })
  .__xelaAssistant ??= { forced: false, teamInitialized: false })

export const ASSISTANT_TEAM_NAME = 'assistant'

export function markAssistantForced(): void {
  state.forced = true
}

export function isAssistantForced(): boolean {
  return state.forced
}

function assistantDefinitionPath(): string {
  return join(getCwd(), '.claude', 'agents', 'assistant.md')
}

export function isAssistantMode(): boolean {
  if (state.forced) return true
  if (isEnvTruthy(process.env.CLAUDE_CODE_ASSISTANT)) return true
  try {
    return existsSync(assistantDefinitionPath())
  } catch {
    return false
  }
}

export type AssistantTeamContext = {
  teamName: string
  definitionPath: string | null
}

/**
 * Pre-seeds the in-process team so `Agent(name: "...")` can spawn teammates
 * without TeamCreate. The team itself is created lazily by the Agent tool;
 * here we only record that assistant mode owns it.
 */
export async function initializeAssistantTeam(): Promise<AssistantTeamContext> {
  state.teamInitialized = true
  const path = assistantDefinitionPath()
  return { teamName: ASSISTANT_TEAM_NAME, definitionPath: existsSync(path) ? path : null }
}

/** How assistant mode got turned on, for diagnostics. */
export function getAssistantActivationPath(): string {
  if (state.forced) return 'flag'
  if (isEnvTruthy(process.env.CLAUDE_CODE_ASSISTANT)) return 'env'
  return existsSync(assistantDefinitionPath()) ? 'agent_file' : 'none'
}

export function isAssistantTeamInitialized(): boolean {
  return state.teamInitialized
}

function readAssistantDefinition(): string | null {
  try {
    const path = assistantDefinitionPath()
    if (!existsSync(path)) return null
    const raw = readFileSync(path, 'utf8')
    // Drop YAML frontmatter; the body is the instructions.
    const m = /^---\n[\s\S]*?\n---\n?/.exec(raw)
    return (m ? raw.slice(m[0].length) : raw).trim() || null
  } catch {
    return null
  }
}

export function getAssistantSystemPromptAddendum(): string {
  const custom = readAssistantDefinition()
  return [
    '# Assistant Mode',
    'You are running as a long-lived personal assistant session. Keep the user informed with short status messages rather than long reports, remember what they ask you to remember, and delegate independent work to teammates with the Agent tool when it helps. Between prompts you may receive <tick> check-ins: do something useful or call Sleep.',
    custom ? `## Assistant instructions\n\n${custom}` : null,
  ]
    .filter(Boolean)
    .join('\n\n')
}
