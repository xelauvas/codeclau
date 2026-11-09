import { spawnSync } from 'child_process'
import { z } from 'zod/v4'
import { buildTool } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { getTerminalPanelSocket } from '../../utils/terminalPanel.js'
import { DESCRIPTION, TERMINAL_CAPTURE_TOOL_NAME } from './prompt.js'

const TMUX_SESSION = 'panel'

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z.enum(['capture', 'send']).optional().describe('capture (default) or send'),
    lines: z.number().int().positive().max(5000).optional().describe('History lines to include (default 200)'),
    keys: z.string().optional().describe('For action "send": text to type into the panel; Enter is appended'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    available: z.boolean(),
    content: z.string(),
    lines: z.number(),
    message: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

function tmux(args: string[]): { ok: boolean; out: string; err: string } {
  const r = spawnSync('tmux', ['-L', getTerminalPanelSocket(), ...args], {
    encoding: 'utf-8',
    timeout: 5000,
  })
  return { ok: r.status === 0, out: r.stdout ?? '', err: r.stderr ?? '' }
}

function hasPanel(): boolean {
  return tmux(['has-session', '-t', TMUX_SESSION]).ok
}

function capture(lines: number): string {
  const r = tmux(['capture-pane', '-p', '-J', '-t', TMUX_SESSION, '-S', `-${lines}`])
  return r.ok ? r.out.replace(/\s+$/, '') : ''
}

export const TerminalCaptureTool = buildTool({
  name: TERMINAL_CAPTURE_TOOL_NAME,
  searchHint: "read the user's terminal panel (Alt+J shell) or type into it",
  maxResultSizeChars: 200_000,
  userFacingName: () => 'Terminal',
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly(input) {
    return (input?.action ?? 'capture') === 'capture'
  },
  toAutoClassifierInput(input) {
    return input.action === 'send' ? `tmux send-keys ${input.keys ?? ''}` : ''
  },
  async checkPermissions(input) {
    if ((input.action ?? 'capture') === 'capture') {
      return { behavior: 'allow', updatedInput: input }
    }
    return { behavior: 'ask', message: `Type into the terminal panel: ${input.keys ?? ''}` }
  },
  async validateInput({ action, keys }) {
    if (action === 'send' && !keys) {
      return { result: false, message: 'action "send" needs keys', errorCode: 1 }
    }
    return { result: true }
  },
  async description({ action, keys }) {
    return action === 'send' ? `Type into terminal panel: ${keys}` : 'Read the terminal panel'
  },
  async prompt() {
    return DESCRIPTION
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: output.available
        ? `Terminal panel (${output.lines} lines):\n${output.content}`
        : output.message ?? 'Terminal panel not available',
    }
  },
  renderToolUseMessage(input: { action?: string; keys?: string }) {
    return input.action === 'send' ? `send: ${input.keys ?? ''}` : 'capture'
  },
  renderToolResultMessage(output: Output) {
    return output.available ? `${output.lines} lines` : (output.message ?? 'not available')
  },
  async call({ action = 'capture', lines = 200, keys }) {
    if (!hasPanel()) {
      return {
        data: {
          available: false,
          content: '',
          lines: 0,
          message:
            'The terminal panel is not open. Ask the user to press Alt+J to open it (needs tmux), or use the Bash tool instead.',
        },
      }
    }
    if (action === 'send' && keys) {
      const r = tmux(['send-keys', '-t', TMUX_SESSION, keys, 'Enter'])
      if (!r.ok) {
        return { data: { available: true, content: '', lines: 0, message: `send-keys failed: ${r.err}` } }
      }
      await new Promise(resolve => setTimeout(resolve, 1500))
    }
    const content = capture(lines)
    return {
      data: {
        available: true,
        content,
        lines: content ? content.split('\n').length : 0,
      },
    }
  },
})
