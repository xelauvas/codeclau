import React, { useMemo } from 'react'
import { Box, Text } from '../../../ink.js'
import { resolveArtifactPath } from '../../../tools/ReviewArtifactTool/ReviewArtifactTool.js'
import { getCwd } from '../../../utils/cwd.js'
import { relative } from 'path'
import { type OptionWithDescription, Select } from '../../CustomSelect/select.js'
import { type UnaryEvent, usePermissionRequestLogging } from '../hooks.js'
import { PermissionDialog } from '../PermissionDialog.js'
import type { PermissionRequestProps } from '../PermissionRequest.js'
import { PermissionRuleExplanation } from '../PermissionRuleExplanation.js'
import { logUnaryPermissionEvent } from '../utils.js'

const PREVIEW_LINES = 18

/**
 * Approval dialog for ReviewArtifact: shows the title, target path and the
 * first lines of the report before anything is written to disk.
 */
export function ReviewArtifactPermissionRequest({
  toolUseConfirm,
  onDone,
  onReject,
  workerBadge,
}: PermissionRequestProps): React.ReactNode {
  const input = toolUseConfirm.input as {
    title: string
    content: string
    path?: string
    findings?: number
    severity?: string
  }
  const target = relative(getCwd(), resolveArtifactPath(input))
  const lines = input.content.split('\n')
  const preview = lines.slice(0, PREVIEW_LINES)
  const hidden = lines.length - preview.length

  const unaryEvent = useMemo<UnaryEvent>(
    () => ({ completion_type: 'tool_use_single', language_name: 'markdown' }),
    [],
  )
  usePermissionRequestLogging(toolUseConfirm, unaryEvent)

  const options = useMemo((): OptionWithDescription<string>[] => {
    return [
      { label: 'Yes, write the report', value: 'yes' },
      {
        label: (
          <Text>
            No, and tell Claude what to change <Text bold>(esc)</Text>
          </Text>
        ),
        value: 'no',
      },
    ]
  }, [])

  function onChange(newValue: string): void {
    switch (newValue) {
      case 'yes':
        logUnaryPermissionEvent('tool_use_single', toolUseConfirm, 'accept')
        toolUseConfirm.onAllow(toolUseConfirm.input, [])
        onDone()
        break
      case 'no':
        logUnaryPermissionEvent('tool_use_single', toolUseConfirm, 'reject')
        toolUseConfirm.onReject()
        onReject()
        onDone()
        break
    }
  }

  return (
    <PermissionDialog title="Review artifact" workerBadge={workerBadge}>
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold>{input.title}</Text>
        <Text dimColor>
          {target}
          {input.findings !== undefined ? ` · ${input.findings} finding${input.findings === 1 ? '' : 's'}` : ''}
          {input.severity && input.severity !== 'none' ? ` · ${input.severity}` : ''}
        </Text>
        <Box flexDirection="column" marginTop={1} borderStyle="round" borderDimColor paddingX={1}>
          {preview.map((line, i) => (
            <Text key={i}>{line || ' '}</Text>
          ))}
          {hidden > 0 && <Text dimColor>… {hidden} more lines</Text>}
        </Box>
      </Box>
      <Box flexDirection="column">
        <PermissionRuleExplanation permissionResult={toolUseConfirm.permissionResult} toolType="tool" />
        <Text>Write this review report to the project?</Text>
        <Select options={options} onChange={onChange} onCancel={() => onChange('no')} />
      </Box>
    </PermissionDialog>
  )
}
