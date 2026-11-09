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
  type TaskStateBase,
} from '../../Task.js'
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

export type WorkflowAgentStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'

export type WorkflowAgentRecord = {
  id: string
  index: number
  label: string
  phase?: string
  status: WorkflowAgentStatus
  startTime: number
  endTime?: number
  error?: string
  resultPreview?: string
  /** Set when the user asked for a retry from the task panel. */
  retryRequested?: boolean
}

export type WorkflowPhaseRecord = {
  title: string
  detail?: string
  status: 'pending' | 'running' | 'completed'
}

/**
 * Per-agent controller, kept outside the (immutable) task state so skip/retry
 * from the UI can reach the running agent.
 */
export type WorkflowAgentController = {
  abortController: AbortController
  retry: boolean
}

export type LocalWorkflowTaskState = TaskStateBase & {
  type: 'local_workflow'
  runId: string
  name: string
  workflowDescription: string
  args?: unknown
  phases: WorkflowPhaseRecord[]
  currentPhase?: string
  agents: WorkflowAgentRecord[]
  result?: unknown
  error?: string
  abortController: AbortController
  agentControllers: Map<string, WorkflowAgentController>
  isBackgrounded: boolean
  agentId?: AgentId
  unregisterCleanup?: () => void
}

export function isLocalWorkflowTask(
  task: unknown,
): task is LocalWorkflowTaskState {
  return (
    typeof task === 'object' &&
    task !== null &&
    'type' in task &&
    (task as { type: unknown }).type === 'local_workflow'
  )
}

export const LocalWorkflowTask: Task = {
  name: 'LocalWorkflowTask',
  type: 'local_workflow',
  async kill(taskId, setAppState) {
    killWorkflowTask(taskId, setAppState)
  },
}

export function killWorkflowTask(
  taskId: string,
  setAppState: SetAppState,
): void {
  let state: LocalWorkflowTaskState | undefined
  setAppState(prev => {
    const t = prev.tasks?.[taskId]
    if (isLocalWorkflowTask(t)) state = t
    return prev
  })
  if (!state) return
  for (const ctrl of state.agentControllers.values()) ctrl.abortController.abort()
  state.abortController.abort()
  finishWorkflow(taskId, 'killed', undefined, 'Stopped by user', setAppState)
}

export function skipWorkflowAgent(
  taskId: string,
  agentId: string,
  setAppState: SetAppState,
): void {
  let ctrl: WorkflowAgentController | undefined
  setAppState(prev => {
    const t = prev.tasks?.[taskId]
    if (isLocalWorkflowTask(t)) ctrl = t.agentControllers.get(agentId)
    return prev
  })
  if (!ctrl) return
  ctrl.retry = false
  ctrl.abortController.abort()
}

export function retryWorkflowAgent(
  taskId: string,
  agentId: string,
  setAppState: SetAppState,
): void {
  let ctrl: WorkflowAgentController | undefined
  setAppState(prev => {
    const t = prev.tasks?.[taskId]
    if (isLocalWorkflowTask(t)) ctrl = t.agentControllers.get(agentId)
    return prev
  })
  if (!ctrl) return
  ctrl.retry = true
  ctrl.abortController.abort()
}

export function updateWorkflowAgent(
  taskId: string,
  agentId: string,
  patch: Partial<WorkflowAgentRecord>,
  setAppState: SetAppState,
): void {
  updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, t => ({
    ...t,
    agents: t.agents.map(a => (a.id === agentId ? { ...a, ...patch } : a)),
  }))
}

export function addWorkflowAgent(
  taskId: string,
  record: WorkflowAgentRecord,
  controller: WorkflowAgentController,
  setAppState: SetAppState,
): void {
  updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, t => {
    t.agentControllers.set(record.id, controller)
    return { ...t, agents: [...t.agents, record] }
  })
}

export function setWorkflowPhase(
  taskId: string,
  title: string,
  setAppState: SetAppState,
): void {
  updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, t => {
    const known = t.phases.some(p => p.title === title)
    const phases = (known ? t.phases : [...t.phases, { title, status: 'pending' as const }]).map(
      p => {
        if (p.title === title) return { ...p, status: 'running' as const }
        if (p.status === 'running') return { ...p, status: 'completed' as const }
        return p
      },
    )
    return { ...t, phases, currentPhase: title }
  })
}

export function finishWorkflow(
  taskId: string,
  status: 'completed' | 'failed' | 'killed',
  result: unknown,
  error: string | undefined,
  setAppState: SetAppState,
): void {
  let snapshot: LocalWorkflowTaskState | null = null
  updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, t => {
    if (t.status !== 'running' && t.status !== 'pending') return t
    t.unregisterCleanup?.()
    const next: LocalWorkflowTaskState = {
      ...t,
      status,
      result,
      error,
      endTime: Date.now(),
      currentPhase: undefined,
      phases: t.phases.map(p =>
        p.status === 'running' ? { ...p, status: 'completed' as const } : p,
      ),
      unregisterCleanup: undefined,
    }
    snapshot = next
    return next
  })
  if (!snapshot) return
  const s = snapshot as LocalWorkflowTaskState
  let shouldEnqueue = false
  updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, t => {
    if (t.notified) return t
    shouldEnqueue = true
    return { ...t, notified: true }
  })
  if (!shouldEnqueue) return
  const done = s.agents.filter(a => a.status === 'completed').length
  const summary =
    status === 'completed'
      ? `Workflow "${s.name}" completed (${done}/${s.agents.length} agents succeeded)`
      : status === 'failed'
        ? `Workflow "${s.name}" failed: ${error ?? 'unknown error'}`
        : `Workflow "${s.name}" stopped`
  const toolUseIdLine = s.toolUseId
    ? `\n<${TOOL_USE_ID_TAG}>${s.toolUseId}</${TOOL_USE_ID_TAG}>`
    : ''
  let resultText = ''
  if (status === 'completed') {
    try {
      resultText = JSON.stringify(result, null, 2) ?? ''
    } catch {
      resultText = String(result)
    }
    if (resultText.length > 20_000) {
      resultText = resultText.slice(0, 20_000) + `\n… (truncated; full result in ${getTaskOutputPath(taskId)})`
    }
  }
  enqueuePendingNotification({
    value: `<${TASK_NOTIFICATION_TAG}>
<${TASK_ID_TAG}>${taskId}</${TASK_ID_TAG}>${toolUseIdLine}
<${OUTPUT_FILE_TAG}>${getTaskOutputPath(taskId)}</${OUTPUT_FILE_TAG}>
<${STATUS_TAG}>${status}</${STATUS_TAG}>
<${SUMMARY_TAG}>${escapeXml(summary)}</${SUMMARY_TAG}>
</${TASK_NOTIFICATION_TAG}>${resultText ? `\nWorkflow result:\n${resultText}` : ''}`,
    mode: 'task-notification',
    priority: 'next',
    agentId: s.agentId,
  })
}

export async function registerWorkflowTask(
  input: {
    name: string
    description: string
    args?: unknown
    phases: Array<{ title: string; detail?: string }>
    toolUseId?: string
    agentId?: AgentId
    isBackgrounded: boolean
  },
  setAppState: SetAppState,
): Promise<LocalWorkflowTaskState> {
  const taskId = generateTaskId('local_workflow')
  await initTaskOutput(taskId)
  const abortController = new AbortController()
  const unregisterCleanup = registerCleanup(async () => {
    abortController.abort()
  })
  const state: LocalWorkflowTaskState = {
    ...createTaskStateBase(taskId, 'local_workflow', input.description, input.toolUseId),
    type: 'local_workflow',
    status: 'running',
    runId: `wf_${taskId}`,
    name: input.name,
    workflowDescription: input.description,
    args: input.args,
    phases: input.phases.map(p => ({ ...p, status: 'pending' as const })),
    agents: [],
    abortController,
    agentControllers: new Map(),
    isBackgrounded: input.isBackgrounded,
    agentId: input.agentId,
    unregisterCleanup,
  }
  registerTask(state, setAppState)
  appendTaskOutput(taskId, `[workflow] ${input.name}: ${input.description}\n`)
  return state
}

export function getWorkflowTasks(state: AppState): LocalWorkflowTaskState[] {
  return Object.values(state.tasks ?? {}).filter(isLocalWorkflowTask)
}
