import type { Command } from '../commands.js'
import type { MCPServerConnection } from '../services/mcp/types.js'
import { logForDebugging } from '../utils/debug.js'
import { memoizeWithLRU } from '../utils/memoize.js'
import { parseYaml } from '../utils/yaml.js'

/**
 * MCP skills: an MCP server can publish skills as resources. Any resource
 * whose URI uses the `skill://` scheme, or whose URI/name ends in SKILL.md,
 * is read, its frontmatter parsed, and exposed as a prompt command named
 * `mcp__<server>__<skill>` next to the server's prompts.
 */

type Resource = { uri: string; name?: string; description?: string; mimeType?: string }

function isSkillResource(r: Resource): boolean {
  const uri = r.uri || ''
  return uri.startsWith('skill://') || /SKILL\.md$/i.test(uri) || /SKILL\.md$/i.test(r.name || '')
}

function splitFrontmatter(raw: string): { meta: Record<string, unknown>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw)
  if (!m) return { meta: {}, body: raw }
  let meta: Record<string, unknown> = {}
  try {
    const parsed = parseYaml(m[1]!)
    if (parsed && typeof parsed === 'object') meta = parsed as Record<string, unknown>
  } catch {
    // keep going with the body only
  }
  return { meta, body: raw.slice(m[0].length) }
}

function normalizeName(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
}

function skillNameFromResource(r: Resource, meta: Record<string, unknown>): string {
  if (typeof meta.name === 'string' && meta.name.trim()) return normalizeName(meta.name.trim())
  const uri = r.uri.replace(/^skill:\/\//, '')
  const parts = uri.split('/').filter(Boolean)
  const last = parts[parts.length - 1] || ''
  const base = /SKILL\.md$/i.test(last) ? parts[parts.length - 2] || 'skill' : last
  return normalizeName(base)
}

export const fetchMcpSkillsForClient = memoizeWithLRU(
  async (client: MCPServerConnection): Promise<Command[]> => {
    if (client.type !== 'connected') return []
    if (!client.capabilities?.resources) return []
    try {
      const listed = (await client.client.listResources()) as { resources?: Resource[] }
      const skills = (listed.resources || []).filter(isSkillResource)
      if (skills.length === 0) return []
      const commands: Command[] = []
      for (const r of skills) {
        try {
          const read = (await client.client.readResource({ uri: r.uri })) as {
            contents?: Array<{ text?: string; blob?: string }>
          }
          const text = (read.contents || []).map(c => c.text || '').join('\n').trim()
          if (!text) continue
          const { meta, body } = splitFrontmatter(text)
          const skillName = skillNameFromResource(r, meta)
          const description =
            (typeof meta.description === 'string' && meta.description) || r.description || `Skill from ${client.name}`
          commands.push({
            type: 'prompt',
            name: `mcp__${normalizeName(client.name)}__${skillName}`,
            description,
            hasUserSpecifiedDescription: true,
            contentLength: body.length,
            isEnabled: () => true,
            isHidden: false,
            isMcp: true,
            progressMessage: 'running',
            userFacingName() {
              return `${client.name}:${skillName} (MCP skill)`
            },
            argNames: [],
            source: 'mcp',
            whenToUse: typeof meta['when-to-use'] === 'string' ? (meta['when-to-use'] as string) : undefined,
            async getPromptForCommand(args: string) {
              const prompt = args?.trim() ? `${body}\n\n## Arguments\n\n${args.trim()}` : body
              return [{ type: 'text', text: prompt }]
            },
          } as unknown as Command)
        } catch (e) {
          logForDebugging(`[mcpSkills] ${client.name}: cannot read ${r.uri}: ${String(e)}`)
        }
      }
      logForDebugging(`[mcpSkills] ${client.name}: ${commands.length} skill(s)`)
      return commands
    } catch (e) {
      logForDebugging(`[mcpSkills] ${client.name}: resources/list failed: ${String(e)}`)
      return []
    }
  },
  (client: MCPServerConnection) => client.name,
  50,
)
