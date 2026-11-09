import React from 'react'
import { Box, Text } from '../../ink.js'
import type { SnipBoundaryMessage as SnipBoundary } from '../../services/compact/snipProjection.js'

export function SnipBoundaryMessage({
  message,
}: {
  message: SnipBoundary
}): React.ReactNode {
  return (
    <Box flexDirection="row" marginTop={1}>
      <Text dimColor>✂ {message.content}</Text>
    </Box>
  )
}
