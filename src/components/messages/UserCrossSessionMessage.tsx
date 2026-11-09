import React from 'react'
import { Box, Text } from '../../ink.js'

/**
 * Renders an incoming <cross-session-message from="uds:..."> prompt as a
 * labeled block instead of raw XML.
 */
export function UserCrossSessionMessage({
  addMargin,
  param,
}: {
  addMargin: boolean
  param: { text: string }
}): React.ReactNode {
  const from = /from="([^"]*)"/.exec(param.text)?.[1]?.replace(/&quot;/g, '"') ?? 'another session'
  const body = param.text
    .replace(/<cross-session-message[^>]*>/, '')
    .replace(/<\/cross-session-message>/, '')
    .trim()
  return (
    <Box flexDirection="column" marginTop={addMargin ? 1 : 0}>
      <Text dimColor>✉ message from {from}</Text>
      <Text>{body}</Text>
    </Box>
  )
}
