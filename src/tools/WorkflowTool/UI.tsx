import React from 'react'
import { MessageResponse } from '../../components/MessageResponse.js'
import { Text } from '../../ink.js'
import type { Output, WorkflowInput } from './WorkflowTool.js'

export function renderToolUseMessage(input: Partial<WorkflowInput>): React.ReactNode {
  if (input.name) return `workflow ${input.name}`
  if (input.scriptPath) return `workflow ${input.scriptPath}`
  const meta = /name:\s*['"]([^'"]+)['"]/.exec(input.script ?? '')
  return meta ? `workflow ${meta[1]}` : 'workflow (inline script)'
}

export function renderToolResultMessage(output: Output): React.ReactNode {
  const status =
    output.status === 'running'
      ? `started · task ${output.taskId}`
      : output.status === 'completed'
        ? `completed · ${output.agentsLaunched} agents`
        : `failed · ${output.error ?? ''}`
  return (
    <MessageResponse>
      <Text>
        {output.name} · {status}
      </Text>
    </MessageResponse>
  )
}
