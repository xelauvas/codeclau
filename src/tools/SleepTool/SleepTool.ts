import { z } from 'zod/v4'
import { isProactiveActive, scheduleNextTick } from '../../proactive/index.js'
import { buildTool } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { DESCRIPTION, SLEEP_TOOL_NAME, SLEEP_TOOL_PROMPT } from './prompt.js'

const MAX_SECONDS = 60 * 60

const inputSchema = lazySchema(() =>
  z.strictObject({
    seconds: z
      .number()
      .positive()
      .max(MAX_SECONDS)
      .describe(`How long to wait, in seconds (at most ${MAX_SECONDS})`),
    reason: z.string().optional().describe('Why you are waiting (shown to the user)'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    sleptMs: z.number(),
    interrupted: z.boolean(),
    message: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

export const SleepTool = buildTool({
  name: SLEEP_TOOL_NAME,
  searchHint: 'wait without holding a shell',
  maxResultSizeChars: 1000,
  userFacingName: () => 'Sleep',
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
  // Only offered while proactive mode is running; otherwise the model has no
  // reason to wait and would only burn a turn.
  isEnabled() {
    return isProactiveActive()
  },
  async checkPermissions(input) {
    return { behavior: 'allow', updatedInput: input }
  },
  async description({ seconds, reason }) {
    return `${DESCRIPTION}: ${seconds}s${reason ? ` (${reason})` : ''}`
  },
  async prompt() {
    return SLEEP_TOOL_PROMPT
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return { tool_use_id: toolUseID, type: 'tool_result', content: output.message }
  },
  renderToolUseMessage(input: { seconds?: number; reason?: string }) {
    return `${input.seconds ?? '?'}s${input.reason ? ` · ${input.reason}` : ''}`
  },
  renderToolResultMessage(output: Output) {
    return output.interrupted ? `interrupted after ${Math.round(output.sleptMs / 1000)}s` : `slept ${Math.round(output.sleptMs / 1000)}s`
  },
  async call({ seconds }, { abortController }) {
    // In proactive mode the wait is the gap until the next <tick>: schedule
    // it and end the turn instead of holding the loop open.
    if (isProactiveActive()) {
      const ms = Math.min(seconds, MAX_SECONDS) * 1000
      scheduleNextTick(ms)
      return {
        data: {
          sleptMs: 0,
          interrupted: false,
          message: `Sleeping ${Math.round(ms / 1000)}s. You will be woken by the next tick; end your turn now.`,
        },
      }
    }
    const start = Date.now()
    const ms = Math.min(seconds, MAX_SECONDS) * 1000
    const interrupted = await new Promise<boolean>(resolve => {
      if (abortController.signal.aborted) return resolve(true)
      const timer = setTimeout(() => {
        abortController.signal.removeEventListener('abort', onAbort)
        resolve(false)
      }, ms)
      const onAbort = (): void => {
        clearTimeout(timer)
        resolve(true)
      }
      abortController.signal.addEventListener('abort', onAbort, { once: true })
    })
    const sleptMs = Date.now() - start
    return {
      data: {
        sleptMs,
        interrupted,
        message: interrupted
          ? `Sleep interrupted after ${Math.round(sleptMs / 1000)}s.`
          : `Slept for ${Math.round(sleptMs / 1000)}s.`,
      },
    }
  },
})
