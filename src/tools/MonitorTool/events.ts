import {
  OUTPUT_FILE_TAG,
  SUMMARY_TAG,
  TASK_ID_TAG,
  TASK_NOTIFICATION_TAG,
  TOOL_USE_ID_TAG,
} from '../../constants/xml.js'
import type { AgentId } from '../../types/ids.js'
import { enqueuePendingNotification } from '../../utils/messageQueueManager.js'
import { getTaskOutputPath } from '../../utils/task/diskOutput.js'
import { escapeXml } from '../../utils/xml.js'

// Lines arriving within this window are delivered as one notification
export const EVENT_BATCH_MS = 200
// A monitor emitting more than this many notifications per minute is stopped:
// the filter is too wide and would flood the conversation
export const MAX_EVENTS_PER_MINUTE = 30

/**
 * Builds the batching event emitter shared by the shell and WebSocket
 * monitors. Lines pushed within EVENT_BATCH_MS become one task notification
 * (no <status> tag, so the task stays open). Returns `false` from push() once
 * the rate limit tripped, so the caller can stop the source.
 */
export function createEventEmitter(opts: {
  taskId: string
  description: string
  toolUseId?: string
  agentId?: AgentId
  onFlood: () => void
}): { push: (line: string) => boolean; flush: () => void } {
  const { taskId, description, toolUseId, agentId, onFlood } = opts
  const outputPath = getTaskOutputPath(taskId)
  const toolUseIdLine = toolUseId
    ? `\n<${TOOL_USE_ID_TAG}>${toolUseId}</${TOOL_USE_ID_TAG}>`
    : ''
  let pending: string[] = []
  let timer: NodeJS.Timeout | null = null
  let flooded = false
  const recent: number[] = []

  function flush(): void {
    timer = null
    if (pending.length === 0) return
    const lines = pending
    pending = []
    const now = Date.now()
    recent.push(now)
    while (recent.length > 0 && now - recent[0]! > 60_000) recent.shift()
    if (recent.length > MAX_EVENTS_PER_MINUTE && !flooded) {
      flooded = true
      onFlood()
      return
    }
    const summary = `Monitor "${description}": ${lines.length === 1 ? '1 event' : `${lines.length} events`}`
    const message = `<${TASK_NOTIFICATION_TAG}>
<${TASK_ID_TAG}>${taskId}</${TASK_ID_TAG}>${toolUseIdLine}
<${OUTPUT_FILE_TAG}>${outputPath}</${OUTPUT_FILE_TAG}>
<${SUMMARY_TAG}>${escapeXml(summary)}</${SUMMARY_TAG}>
</${TASK_NOTIFICATION_TAG}>
${lines.join('\n')}`
    if (process.env.XELA_MONITOR_DEBUG) process.stderr.write(`[monitor] flush ${lines.length} lines -> notification\n`)
    enqueuePendingNotification({
      value: message,
      mode: 'task-notification',
      priority: 'next',
      agentId,
    })
  }

  return {
    push(line: string): boolean {
      if (flooded) return false
      pending.push(line)
      if (!timer) {
        timer = setTimeout(flush, EVENT_BATCH_MS)
        timer.unref()
      }
      return true
    },
    flush,
  }
}

