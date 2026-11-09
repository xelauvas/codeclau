import { z } from 'zod/v4'
import { buildTool } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'

export const VERIFY_PLAN_EXECUTION_TOOL_NAME = 'VerifyPlanExecution'

const PROMPT = `After implementing a plan that was approved in plan mode, call this tool once to record a verification of what was done.

Go through every item of the plan and check it against the actual code (read the files, run the tests or commands that prove it), then report each item as done, partial or skipped with concrete evidence (file:line, command output). Be honest: a partial or skipped item with a reason is far more useful than an optimistic "done". The result is shown to the user as the plan's completion report.`

const inputSchema = lazySchema(() =>
  z.strictObject({
    items: z
      .array(
        z.strictObject({
          item: z.string().describe('The plan item, in the plan\'s own words'),
          status: z.enum(['done', 'partial', 'skipped']),
          evidence: z.string().describe('How you verified it: file:line, command run and its result, or why it was skipped'),
        }),
      )
      .min(1),
    summary: z.string().describe('Two or three sentences: overall state, anything the user must still do'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    done: z.number(),
    partial: z.number(),
    skipped: z.number(),
    report: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

const MARK = { done: '✓', partial: '◐', skipped: '✗' } as const

export const VerifyPlanExecutionTool = buildTool({
  name: VERIFY_PLAN_EXECUTION_TOOL_NAME,
  searchHint: 'record verification of an implemented plan',
  maxResultSizeChars: 20_000,
  userFacingName: () => 'Verify plan',
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
  isEnabled() {
    return process.env.CLAUDE_CODE_VERIFY_PLAN === 'true'
  },
  async checkPermissions(input) {
    return { behavior: 'allow', updatedInput: input }
  },
  async description({ items }) {
    return `Verify ${items.length} plan item${items.length === 1 ? '' : 's'}`
  },
  async prompt() {
    return PROMPT
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return { tool_use_id: toolUseID, type: 'tool_result', content: output.report }
  },
  renderToolUseMessage(input: { items?: unknown[] }) {
    return `${input.items?.length ?? 0} items`
  },
  renderToolResultMessage(output: Output) {
    return `${output.done} done · ${output.partial} partial · ${output.skipped} skipped`
  },
  async call({ items, summary }, context) {
    const counts = { done: 0, partial: 0, skipped: 0 }
    const lines = items.map(i => {
      counts[i.status]++
      return `${MARK[i.status]} ${i.item}\n    ${i.evidence}`
    })
    const report = `Plan verification: ${counts.done}/${items.length} done${counts.partial ? `, ${counts.partial} partial` : ''}${counts.skipped ? `, ${counts.skipped} skipped` : ''}\n\n${lines.join('\n')}\n\n${summary}`
    context.setAppState(prev =>
      prev.pendingPlanVerification
        ? {
            ...prev,
            pendingPlanVerification: {
              ...prev.pendingPlanVerification,
              verificationStarted: true,
              verificationCompleted: true,
            },
          }
        : prev,
    )
    return { data: { ...counts, report } }
  },
})
