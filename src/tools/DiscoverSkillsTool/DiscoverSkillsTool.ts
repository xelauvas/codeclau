import { z } from 'zod/v4'
import type { Command } from '../../commands.js'
import { searchSkills } from '../../services/skillSearch/localSearch.js'
import { buildTool } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { DESCRIPTION, DISCOVER_SKILLS_TOOL_NAME } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    description: z.string().describe('What you are about to do, specifically'),
    limit: z.number().int().positive().max(10).optional().describe('Max results (default 5)'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    skills: z.array(z.object({ name: z.string(), description: z.string() })),
    message: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

export const DiscoverSkillsTool = buildTool({
  name: DISCOVER_SKILLS_TOOL_NAME,
  searchHint: 'find installed skills relevant to a task',
  maxResultSizeChars: 20_000,
  userFacingName: () => 'Discover skills',
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  async checkPermissions(input) {
    return { behavior: 'allow', updatedInput: input }
  },
  async description({ description }) {
    return `Find skills for: ${description.slice(0, 60)}`
  },
  async prompt() {
    return DESCRIPTION
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content:
        output.skills.length === 0
          ? output.message
          : output.skills.map(s => `- ${s.name}: ${s.description}`).join('\n') + `\n\nInvoke with Skill("<name>").`,
    }
  },
  renderToolUseMessage(input: { description?: string }) {
    return input.description ?? ''
  },
  renderToolResultMessage(output: Output) {
    return output.skills.length ? output.skills.map(s => s.name).join(', ') : 'no matching skills'
  },
  async call({ description, limit }, context) {
    const commands = ((context.options as { commands?: Command[] } | undefined)?.commands ?? []).filter(c => c.type === 'prompt')
    const hits = searchSkills(description, commands, { limit: limit ?? 5, minScore: 1.5 })
    for (const h of hits) context.discoveredSkillNames?.add(h.name)
    return {
      data: {
        skills: hits.map(h => ({ name: h.name, description: h.description })),
        message: hits.length ? `${hits.length} skills match.` : 'No installed skill matches that description.',
      },
    }
  },
})
