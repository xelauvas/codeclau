import { z } from 'zod/v4'
import { spawnShellTask } from '../../tasks/LocalShellTask/LocalShellTask.js'
import { killTask } from '../../tasks/LocalShellTask/killShellTasks.js'
import { spawnMonitorMcpTask } from '../../tasks/MonitorMcpTask/MonitorMcpTask.js'
import { buildTool } from '../../Tool.js'
import type { AgentId } from '../../types/ids.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { enqueuePendingNotification } from '../../utils/messageQueueManager.js'
import { exec } from '../../utils/Shell.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { getTaskOutputPath } from '../../utils/task/diskOutput.js'
import { TaskOutput } from '../../utils/task/TaskOutput.js'
import { tailFile } from '../../utils/fsOperations.js'
import { bashToolHasPermission } from '../BashTool/bashPermissions.js'
import { createEventEmitter, MAX_EVENTS_PER_MINUTE } from './events.js'
import { DESCRIPTION, MONITOR_TOOL_NAME } from './prompt.js'
import { renderToolResultMessage, renderToolUseMessage } from './UI.js'

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000
const MAX_TIMEOUT_MS = 30 * 60 * 1000
const inputSchema = lazySchema(() =>
  z.strictObject({
    command: z
      .string()
      .optional()
      .describe(
        'Shell command or script. Each stdout line is an event; exit ends the watch.',
      ),
    ws: z
      .object({
        url: z.string(),
        protocols: z.array(z.string()).optional(),
      })
      .optional()
      .describe(
        'WebSocket to open. Each text frame is an event; socket close ends the watch. Cannot be combined with command.',
      ),
    description: z
      .string()
      .describe(
        'Short human-readable description of what you are monitoring (shown in notifications).',
      ),
    timeout_ms: z
      .number()
      .optional()
      .describe(
        'Kill the monitor after this deadline. Default 300000ms, at most 1800000ms. You are notified at expiry and can re-arm.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
export type MonitorInput = z.infer<InputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    taskId: z.string(),
    description: z.string(),
    source: z.enum(['command', 'ws']),
    outputFile: z.string(),
    timeoutMs: z.number(),
    message: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

export function clampTimeout(timeoutMs: number | undefined): number {
  if (!timeoutMs || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return DEFAULT_TIMEOUT_MS
  }
  return Math.min(timeoutMs, MAX_TIMEOUT_MS)
}

export const MonitorTool = buildTool({
  name: MONITOR_TOOL_NAME,
  searchHint: 'watch a log, process or socket and get notified on each event',
  maxResultSizeChars: 100_000,
  userFacingName: () => 'Monitor',
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
    return false
  },
  toAutoClassifierInput(input) {
    return input.command ?? (input.ws ? `ws ${input.ws.url}` : '')
  },
  async validateInput({ command, ws, timeout_ms }) {
    if (!command && !ws) {
      return {
        result: false,
        message: 'Provide either command or ws',
        errorCode: 1,
      }
    }
    if (command && ws) {
      return {
        result: false,
        message: 'command and ws cannot be combined',
        errorCode: 1,
      }
    }
    if (ws && !/^wss?:\/\//.test(ws.url)) {
      return {
        result: false,
        message: 'ws.url must start with ws:// or wss://',
        errorCode: 1,
      }
    }
    if (timeout_ms !== undefined && timeout_ms < 1000) {
      return {
        result: false,
        message: 'timeout_ms must be at least 1000',
        errorCode: 1,
      }
    }
    return { result: true }
  },
  async checkPermissions(input, context) {
    // A shell monitor is a Bash command: same rules, same prompts
    if (input.command) {
      const result = await bashToolHasPermission(
        { command: input.command, description: input.description },
        context,
      )
      // Pass the monitor input through, not the Bash-shaped input
      if (result.behavior === 'allow') {
        return { ...result, updatedInput: input }
      }
      return result
    }
    return {
      behavior: 'ask',
      message: `Open WebSocket ${input.ws?.url ?? ''}`,
    }
  },
  async description({ description }) {
    return description
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
  renderToolUseMessage,
  renderToolResultMessage,
  async call(input, context) {
    const { abortController, getAppState, setAppState } = context
    const toolUseId = (context as { toolUseId?: string }).toolUseId
    const agentId = (context as { agentId?: AgentId }).agentId
    const timeoutMs = clampTimeout(input.timeout_ms)
    const description = input.description

    if (input.ws) {
      const handle = await spawnMonitorMcpTask(
        {
          url: input.ws.url,
          protocols: input.ws.protocols,
          description,
          timeoutMs,
          toolUseId,
          agentId,
        },
        { abortController, getAppState, setAppState },
      )
      return {
        data: {
          taskId: handle.taskId,
          description,
          source: 'ws' as const,
          outputFile: getTaskOutputPath(handle.taskId),
          timeoutMs,
          message: `Monitor "${description}" armed on ${input.ws.url} (task ${handle.taskId}, expires in ${Math.round(timeoutMs / 1000)}s). Each text frame arrives as a notification.`,
        },
      }
    }

    const command = input.command!
    let emitter: ReturnType<typeof createEventEmitter> | null = null
    let seenLines = 0
    let taskId: string | null = null

    // The poller hands over the last ~100 lines plus the total line count, so
    // new lines are the tail slice beyond what was already delivered.
    function deliver(content: string, totalLines: number): void {
      if (!emitter || totalLines <= seenLines) return
      const lines = content.split('\n')
      if (lines[lines.length - 1] === '') lines.pop()
      const fresh = lines.slice(Math.max(0, lines.length - (totalLines - seenLines)))
      seenLines = totalLines
      for (const line of fresh) {
        if (line.trim() === '') continue
        if (!emitter.push(line)) break
      }
    }

    const shellCommand = await exec(command, abortController.signal, 'bash', {
      timeout: timeoutMs,
      onProgress(_lastLines, allLines, totalLines) {
        if (process.env.XELA_MONITOR_DEBUG) process.stderr.write(`[monitor] progress total=${totalLines} seen=${seenLines}\n`)
        deliver(allLines, totalLines)
      },
    })

    const handle = await spawnShellTask(
      {
        command,
        description,
        shellCommand,
        toolUseId,
        agentId,
        kind: 'monitor',
        timeout: timeoutMs,
      },
      { abortController, getAppState, setAppState },
    )
    taskId = handle.taskId
    emitter = createEventEmitter({
      taskId,
      description,
      toolUseId,
      agentId,
      onFlood: () => {
        enqueuePendingNotification({
          value: `Monitor "${description}" (task ${taskId}) produced more than ${MAX_EVENTS_PER_MINUTE} events per minute and was stopped. Restart it with a tighter filter.`,
          mode: 'task-notification',
          priority: 'next',
          agentId,
        })
        if (taskId) killTask(taskId, setAppState)
      },
    })

    // Progress callbacks only fire while the shared poller watches this task
    const outputId = shellCommand.taskOutput.taskId
    TaskOutput.startPolling(outputId)
    void shellCommand.result.then(async () => {
      TaskOutput.stopPolling(outputId)
      // The script may exit between two polls: deliver whatever the last
      // tick missed, then flush so the events precede the "stream ended" notice
      try {
        const { content } = await tailFile(getTaskOutputPath(outputId), 256 * 1024)
        const total = content.split('\n').filter((l, i, a) => !(i === a.length - 1 && l === '')).length
        deliver(content, Math.max(total, seenLines))
      } catch {
        // output file may be gone already
      }
      emitter?.flush()
    })

    return {
      data: {
        taskId,
        description,
        source: 'command' as const,
        outputFile: getTaskOutputPath(taskId),
        timeoutMs,
        message: `Monitor "${description}" armed (task ${taskId}, expires in ${Math.round(timeoutMs / 1000)}s). Each stdout line arrives as a notification; the script exiting ends the watch.`,
      },
    }
  },
})
