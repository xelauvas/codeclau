import React from 'react'
import { MessageResponse } from '../../components/MessageResponse.js'
import { Text } from '../../ink.js'
import type { MonitorInput, Output } from './MonitorTool.js'

export function renderToolUseMessage(
  input: Partial<MonitorInput>,
  { verbose }: { verbose: boolean },
): React.ReactNode {
  const source = input.command ?? input.ws?.url ?? ''
  const shown =
    verbose || source.length <= 80 ? source : source.slice(0, 77) + '…'
  return input.description ? `${input.description} · ${shown}` : shown
}

export function renderToolResultMessage(output: Output): React.ReactNode {
  return (
    <MessageResponse>
      <Text>
        Monitor armed · {output.description} · task {output.taskId} · expires
        in {Math.round(output.timeoutMs / 1000)}s
      </Text>
    </MessageResponse>
  )
}
