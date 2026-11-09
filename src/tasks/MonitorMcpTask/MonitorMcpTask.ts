import WebSocket from 'ws'
import {
  OUTPUT_FILE_TAG,
  STATUS_TAG,
  SUMMARY_TAG,
  TASK_ID_TAG,
  TASK_NOTIFICATION_TAG,
  TOOL_USE_ID_TAG,
} from '../../constants/xml.js'
import type { AppState } from '../../state/AppState.js'
import {
  createTaskStateBase,
  generateTaskId,
  type SetAppState,
  type Task,
  type TaskContext,
  type TaskHandle,
  type TaskStateBase,
} from '../../Task.js'
import { createEventEmitter } from '../../tools/MonitorTool/events.js'
import type { AgentId } from '../../types/ids.js'
import { registerCleanup } from '../../utils/cleanupRegistry.js'
import { enqueuePendingNotification } from '../../utils/messageQueueManager.js'
import {
  appendTaskOutput,
  getTaskOutputPath,
  initTaskOutput,
} from '../../utils/task/diskOutput.js'
import { registerTask, updateTaskState } from '../../utils/task/framework.js'
import { escapeXml } from '../../utils/xml.js'

/**
 * WebSocket monitor: each text frame is an event, socket close ends the
 * watch. Called "monitor_mcp" for compatibility with the task type the rest
 * of the app knows about (dialogs, pills, kill paths).
 */
export type MonitorMcpTaskState = TaskStateBase & {
  type: 'monitor_mcp'
  url: string
  eventCount: number
  closeCode?: number
  error?: string
  agentId?: AgentId
  socket?: WebSocket | null
  timeoutId?: NodeJS.Timeout
  unregisterCleanup?: () => void
}

export function isMonitorMcpTask(task: unknown): task is MonitorMcpTaskState {
  return (
    typeof task === 'object' &&
    task !== null &&
    'type' in task &&
    (task as { type: unknown }).type === 'monitor_mcp'
  )
}

export const MonitorMcpTask: Task = {
  name: 'MonitorMcpTask',
  type: 'monitor_mcp',
  async kill(taskId, setAppState) {
    killMonitorMcp(taskId, setAppState)
  },
}

function notifyTerminal(
  task: MonitorMcpTaskState,
  status: 'completed' | 'failed' | 'killed',
  summary: string,
  setAppState: SetAppState,
): void {
  let shouldEnqueue = false
  updateTaskState<MonitorMcpTaskState>(task.id, setAppState, t => {
    if (t.notified) return t
    shouldEnqueue = true
    return { ...t, notified: true }
  })
  if (!shouldEnqueue) return
  const toolUseIdLine = task.toolUseId
    ? `\n<${TOOL_USE_ID_TAG}>${task.toolUseId}</${TOOL_USE_ID_TAG}>`
    : ''
  enqueuePendingNotification({
    value: `<${TASK_NOTIFICATION_TAG}>
<${TASK_ID_TAG}>${task.id}</${TASK_ID_TAG}>${toolUseIdLine}
<${OUTPUT_FILE_TAG}>${getTaskOutputPath(task.id)}</${OUTPUT_FILE_TAG}>
<${STATUS_TAG}>${status}</${STATUS_TAG}>
<${SUMMARY_TAG}>${escapeXml(summary)}</${SUMMARY_TAG}>
</${TASK_NOTIFICATION_TAG}>`,
    mode: 'task-notification',
    priority: 'next',
    agentId: task.agentId,
  })
}

function finish(
  taskId: string,
  status: 'completed' | 'failed' | 'killed',
  summaryFor: (t: MonitorMcpTaskState) => string,
  patch: Partial<MonitorMcpTaskState>,
  setAppState: SetAppState,
): void {
  let snapshot: MonitorMcpTaskState | null = null
  updateTaskState<MonitorMcpTaskState>(taskId, setAppState, t => {
    if (t.status !== 'running' && t.status !== 'pending') return t
    if (t.timeoutId) clearTimeout(t.timeoutId)
    t.unregisterCleanup?.()
    const next: MonitorMcpTaskState = {
      ...t,
      ...patch,
      status,
      endTime: Date.now(),
      socket: null,
      timeoutId: undefined,
      unregisterCleanup: undefined,
    }
    snapshot = next
    return next
  })
  if (snapshot) {
    const s = snapshot as MonitorMcpTaskState
    notifyTerminal(s, status, summaryFor(s), setAppState)
  }
}

export function killMonitorMcp(taskId: string, setAppState: SetAppState): void {
  let socket: WebSocket | null | undefined
  setAppState(prev => {
    const t = prev.tasks?.[taskId]
    if (isMonitorMcpTask(t)) socket = t.socket
    return prev
  })
  try {
    socket?.close(1000, 'stopped')
  } catch {
    // already closed
  }
  finish(
    taskId,
    'killed',
    t => `Monitor "${t.description}" stopped`,
    {},
    setAppState,
  )
}

export function killMonitorMcpTasksForAgent(
  agentId: AgentId,
  getAppState: () => AppState,
  setAppState: SetAppState,
): void {
  const tasks = getAppState().tasks ?? {}
  for (const task of Object.values(tasks)) {
    if (
      isMonitorMcpTask(task) &&
      task.agentId === agentId &&
      (task.status === 'running' || task.status === 'pending')
    ) {
      killMonitorMcp(task.id, setAppState)
    }
  }
}

export async function spawnMonitorMcpTask(
  input: {
    url: string
    protocols?: string[]
    description: string
    timeoutMs: number
    toolUseId?: string
    agentId?: AgentId
  },
  context: TaskContext,
): Promise<TaskHandle> {
  const { url, protocols, description, timeoutMs, toolUseId, agentId } = input
  const { setAppState } = context
  const taskId = generateTaskId('monitor_mcp')
  await initTaskOutput(taskId)

  const unregisterCleanup = registerCleanup(async () => {
    killMonitorMcp(taskId, setAppState)
  })

  const socket = new WebSocket(url, protocols)
  const timeoutId = setTimeout(() => {
    try {
      socket.close(1000, 'timeout')
    } catch {
      // ignore
    }
    finish(
      taskId,
      'completed',
      t =>
        `Monitor "${t.description}" expired after ${Math.round(timeoutMs / 1000)}s (${t.eventCount} events)`,
      {},
      setAppState,
    )
  }, timeoutMs)
  timeoutId.unref()

  const taskState: MonitorMcpTaskState = {
    ...createTaskStateBase(taskId, 'monitor_mcp', description, toolUseId),
    type: 'monitor_mcp',
    status: 'running',
    url,
    eventCount: 0,
    agentId,
    socket,
    timeoutId,
    unregisterCleanup,
  }
  registerTask(taskState, setAppState)

  const emitter = createEventEmitter({
    taskId,
    description,
    toolUseId,
    agentId,
    onFlood: () => {
      enqueuePendingNotification({
        value: `Monitor "${description}" (task ${taskId}) produced too many events per minute and was stopped. Subscribe to a filtered feed where one exists.`,
        mode: 'task-notification',
        priority: 'next',
        agentId,
      })
      killMonitorMcp(taskId, setAppState)
    },
  })

  socket.on('message', (data, isBinary) => {
    const line = isBinary
      ? `[binary frame, ${Buffer.byteLength(data as Buffer)} bytes]`
      : data.toString()
    appendTaskOutput(taskId, line + '\n')
    updateTaskState<MonitorMcpTaskState>(taskId, setAppState, t => ({
      ...t,
      eventCount: t.eventCount + 1,
    }))
    emitter.push(line)
  })
  socket.on('error', err => {
    appendTaskOutput(taskId, `[error] ${err.message}\n`)
    finish(
      taskId,
      'failed',
      t => `Monitor "${t.description}" socket error: ${err.message}`,
      { error: err.message },
      setAppState,
    )
  })
  socket.on('close', (code, reason) => {
    emitter.flush()
    appendTaskOutput(
      taskId,
      `[closed] code ${code}${reason?.length ? ` ${reason.toString()}` : ''}\n`,
    )
    finish(
      taskId,
      'completed',
      t =>
        `Monitor "${t.description}" socket closed (code ${code}, ${t.eventCount} events)`,
      { closeCode: code },
      setAppState,
    )
  })

  return {
    taskId,
    cleanup: () => {
      unregisterCleanup()
    },
  }
}
