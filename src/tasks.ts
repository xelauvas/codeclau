import { feature } from 'bun:bundle'
import type { Task, TaskType } from './Task.js'
import { DreamTask } from './tasks/DreamTask/DreamTask.js'
import { LocalAgentTask } from './tasks/LocalAgentTask/LocalAgentTask.js'
import { LocalShellTask } from './tasks/LocalShellTask/LocalShellTask.js'
import { MonitorMcpTask as MonitorMcpTaskImpl } from './tasks/MonitorMcpTask/MonitorMcpTask.js'
import { LocalWorkflowTask as LocalWorkflowTaskImpl } from './tasks/LocalWorkflowTask/LocalWorkflowTask.js'
import { RemoteAgentTask } from './tasks/RemoteAgentTask/RemoteAgentTask.js'

/* eslint-disable @typescript-eslint/no-require-imports */
// Resolved lazily: these task modules import the task framework, which
// imports this file. Reading the export at top level during a CJS require
// hits the temporal dead zone ("Cannot access before initialization").
let LocalWorkflowTask: Task | null | undefined
let MonitorMcpTask: Task | null | undefined
function getOptionalTasks(): Task[] {
  if (LocalWorkflowTask === undefined) {
    LocalWorkflowTask = feature('WORKFLOW_SCRIPTS') ? LocalWorkflowTaskImpl : null
  }
  if (MonitorMcpTask === undefined) {
    // Static import: the WebSocket monitor shares the task registry and
    // notification queue with the app, so it must not be a CJS copy
    MonitorMcpTask = feature('MONITOR_TOOL') ? MonitorMcpTaskImpl : null
  }
  const tasks: Task[] = []
  if (LocalWorkflowTask) tasks.push(LocalWorkflowTask)
  if (MonitorMcpTask) tasks.push(MonitorMcpTask)
  return tasks
}
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * Get all tasks.
 * Mirrors the pattern from tools.ts
 * Note: Returns array inline to avoid circular dependency issues with top-level const
 */
export function getAllTasks(): Task[] {
  const tasks: Task[] = [
    LocalShellTask,
    LocalAgentTask,
    RemoteAgentTask,
    DreamTask,
  ]
  tasks.push(...getOptionalTasks())
  return tasks
}

/**
 * Get a task by its type.
 */
export function getTaskByType(type: TaskType): Task | undefined {
  return getAllTasks().find(t => t.type === type)
}
