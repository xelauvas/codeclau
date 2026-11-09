import { z } from 'zod/v4'
import { buildTool } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { DESCRIPTION, SNIP_TOOL_NAME } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    start_id: z
      .string()
      .describe('The [id:...] tag of the first message to remove (just the id, e.g. "3kd92a")'),
    end_id: z
      .string()
      .describe('The [id:...] tag of the last message to remove (inclusive)'),
    reason: z
      .string()
      .optional()
      .describe('One short phrase on why this range is no longer needed'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    scheduled: z.literal(true),
    start_id: z.string(),
    end_id: z.string(),
    message: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

/**
 * The tool call itself is the snip marker: the next query pass
 * (snipCompactIfNeeded) finds Snip tool_use blocks without a matching
 * boundary, removes the tagged range and leaves a boundary behind.
 */
export const SnipTool = buildTool({
  name: SNIP_TOOL_NAME,
  searchHint: 'drop stale earlier messages from the context window',
  maxResultSizeChars: 10_000,
  userFacingName: () => 'Snip',
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
  async description({ start_id, end_id }) {
    return `Snip messages ${start_id}..${end_id}`
  },
  async prompt() {
    return DESCRIPTION
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: jsonStringify(output),
    }
  },
  renderToolUseMessage(input: { start_id?: string; end_id?: string; reason?: string }) {
    return `${input.start_id ?? '?'} → ${input.end_id ?? '?'}${input.reason ? ` · ${input.reason}` : ''}`
  },
  renderToolResultMessage() {
    return null
  },
  async call({ start_id, end_id }) {
    const clean = (s: string): string => s.trim().replace(/^\[?id:/, '').replace(/\]$/, '')
    return {
      data: {
        scheduled: true as const,
        start_id: clean(start_id),
        end_id: clean(end_id),
        message:
          'Scheduled. The range is removed from your context starting with the next turn; a boundary note will mark where it was.',
      },
    }
  },
})
