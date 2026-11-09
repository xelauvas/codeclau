import { z } from 'zod/v4'
import {
  getStore,
  renderMessageForSummary,
} from '../../services/contextCollapse/operations.js'
import { buildTool } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'

export const CTX_INSPECT_TOOL_NAME = 'CtxInspect'

const DESCRIPTION = `Look inside the context window's collapsed spans. Earlier parts of this conversation may have been replaced by <collapsed id="..."> summaries to save space. Call with no id to list the collapsed spans (id, size, first line of the summary); call with an id to read that span's full summary, or with id and detail "messages" to read the original messages verbatim (large — only when the summary is not enough). Also lists spans that are staged (summarized, not yet swapped in).`

const inputSchema = lazySchema(() =>
  z.strictObject({
    id: z.string().optional().describe('Collapse id from a <collapsed id="..."> placeholder'),
    detail: z.enum(['summary', 'messages']).optional().describe('What to return for an id (default summary)'),
    limit: z.number().int().positive().max(200_000).optional().describe('Max characters of original messages to return (default 30000)'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    text: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

export const CtxInspectTool = buildTool({
  name: CTX_INSPECT_TOOL_NAME,
  searchHint: 'read summaries or originals of collapsed conversation spans',
  maxResultSizeChars: 250_000,
  userFacingName: () => 'Context inspect',
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
  async description({ id }) {
    return id ? `Inspect collapsed span ${id}` : 'List collapsed spans'
  },
  async prompt() {
    return DESCRIPTION
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return { tool_use_id: toolUseID, type: 'tool_result', content: output.text }
  },
  renderToolUseMessage(input: { id?: string; detail?: string }) {
    return input.id ? `${input.id}${input.detail === 'messages' ? ' (messages)' : ''}` : 'list'
  },
  renderToolResultMessage(output: Output) {
    return output.text.split('\n')[0]?.slice(0, 100) ?? ''
  },
  async call({ id, detail, limit }) {
    const store = getStore()
    if (!id) {
      const lines: string[] = []
      if (store.commits.length === 0 && store.staged.length === 0) {
        lines.push('No collapsed spans yet. The conversation is still fully in context.')
      }
      if (store.commits.length > 0) {
        lines.push(`Collapsed spans (${store.commits.length}):`)
        for (const c of store.commits) {
          const first = c.summary.split('\n').find(l => l.trim()) ?? ''
          lines.push(`- id ${c.collapseId}: ${c.archived.length} messages — ${first.slice(0, 140)}`)
        }
      }
      if (store.staged.length > 0) {
        lines.push(`Staged (summarized, not yet swapped in): ${store.staged.length}`)
        for (const s of store.staged) {
          lines.push(`- ${s.startUuid.slice(0, 8)}..${s.endUuid.slice(0, 8)}: ${s.summary.split('\n')[0]?.slice(0, 120) ?? ''}`)
        }
      }
      return { data: { text: lines.join('\n') } }
    }
    const commit = store.commits.find(c => c.collapseId === id || c.collapseId === id.padStart(16, '0'))
    if (!commit) {
      return { data: { text: `No collapsed span with id ${id}. Call without an id to list them.` } }
    }
    if (detail === 'messages') {
      if (commit.archived.length === 0) {
        return { data: { text: `The original messages of span ${id} are not loaded in this session (they live in the transcript). Summary:\n\n${commit.summary}` } }
      }
      const max = limit ?? 30_000
      let text = commit.archived.map(renderMessageForSummary).join('\n\n')
      if (text.length > max) text = text.slice(0, max) + `\n… (${text.length - max} more characters)`
      return { data: { text: `Original messages of span ${id} (${commit.archived.length}):\n\n${text}` } }
    }
    return { data: { text: `Summary of span ${id} (${commit.archived.length} messages):\n\n${commit.summary}` } }
  },
})
