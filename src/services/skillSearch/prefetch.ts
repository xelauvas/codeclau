import type { Command } from '../../commands.js'
import type { ToolUseContext } from '../../Tool.js'
import type { Message } from '../../types/message.js'
import type { Attachment } from '../../utils/attachments.js'
import { logForDebugging } from '../../utils/debug.js'
import { isSkillSearchEnabled } from './featureCheck.js'
import { searchSkills } from './localSearch.js'
import type { DiscoverySignal } from './signals.js'

export type PendingSkillPrefetch = {
  promise: Promise<Attachment[]>
  signal: DiscoverySignal
  startedAt: number
}

// Skills already surfaced in this process, per agent, so suggestions are not repeated
const surfaced = new Map<string, Set<string>>()

function surfacedFor(context: ToolUseContext): Set<string> {
  const key = (context as { agentId?: string }).agentId ?? 'main'
  let set = surfaced.get(key)
  if (!set) {
    set = new Set()
    surfaced.set(key, set)
  }
  return set
}

function textOf(message: Message | undefined): string {
  if (!message) return ''
  const m = message as { type: string; message?: { content?: unknown } }
  if (m.type !== 'user' && m.type !== 'assistant') return ''
  const content = m.message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return (content as Array<{ type: string; text?: string; name?: string }>)
    .map(b => (b.type === 'text' ? b.text ?? '' : b.type === 'tool_use' ? b.name ?? '' : ''))
    .join(' ')
}

/** Skills that the listing already shows (bundled + MCP) are never "discovered". */
function discoverable(cmd: { loadedFrom?: string; source?: string }): boolean {
  const from = cmd.loadedFrom ?? cmd.source
  return from !== 'bundled' && from !== 'mcp' && from !== 'builtin'
}

async function discover(
  query: string,
  signal: DiscoverySignal,
  context: ToolUseContext,
): Promise<Attachment[]> {
  if (!isSkillSearchEnabled()) return []
  const text = query.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim()
  if (text.length < 12) return []
  // The session's command list travels on the tool-use context; loading it
  // here would drag the whole command graph through the CJS require shim.
  const all = (context.options as { commands?: Command[] } | undefined)?.commands ?? []
  const commands = all.filter(discoverable)
  if (commands.length === 0) {
    logForDebugging('[skill-search] no commands on context; skipping discovery')
    return []
  }
  logForDebugging(`[skill-search] ${signal}: ${commands.length} candidate skills, query "${text.slice(0, 80)}"`)
  const already = surfacedFor(context)
  const hits = searchSkills(text, commands, { limit: 4, exclude: already })
  if (hits.length === 0) return []
  for (const h of hits) {
    already.add(h.name)
    context.discoveredSkillNames?.add(h.name)
  }
  if (!context.discoveredSkillNames) {
    ;(context as { discoveredSkillNames?: Set<string> }).discoveredSkillNames = new Set(hits.map(h => h.name))
  }
  logForDebugging(`[skill-search] ${signal}: ${hits.map(h => `${h.name}(${h.score.toFixed(1)})`).join(', ')}`)
  return [
    {
      type: 'skill_discovery',
      skills: hits.map(h => ({ name: h.name, description: h.description })),
      signal,
      source: 'native',
    } as Attachment,
  ]
}

/** Turn 0: the user's own words are the signal. Blocking, but the index is in-memory. */
export async function getTurnZeroSkillDiscovery(
  input: string,
  _messages: Message[],
  context: ToolUseContext,
): Promise<Attachment[]> {
  return discover(input, 'user_input', context)
}

/**
 * Between turns: what the assistant just said and what the user asked
 * before are the signal. Runs while the main turn is in flight; the result
 * is collected by collectSkillDiscoveryPrefetch before the next model call.
 */
export function startSkillDiscoveryPrefetch(
  signal: DiscoverySignal | null,
  messages: Message[],
  context: ToolUseContext,
): PendingSkillPrefetch | null {
  if (!isSkillSearchEnabled()) return null
  const lastAssistant = [...messages].reverse().find(m => m.type === 'assistant')
  if (!lastAssistant) return null
  const lastUser = [...messages].reverse().find(m => m.type === 'user' && !(m as { isMeta?: boolean }).isMeta)
  const query = `${textOf(lastUser)} ${textOf(lastAssistant)}`.slice(0, 4000)
  const effective: DiscoverySignal = signal ?? 'assistant_turn'
  return {
    promise: discover(query, effective, context).catch(() => []),
    signal: effective,
    startedAt: Date.now(),
  }
}

export async function collectSkillDiscoveryPrefetch(
  pending: PendingSkillPrefetch,
): Promise<Attachment[]> {
  return pending.promise
}

export function resetSkillDiscoveryState(): void {
  surfaced.clear()
}
