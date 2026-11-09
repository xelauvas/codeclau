import type { Message } from '../../types/message.js'

export const SNIP_BOUNDARY_SUBTYPE = 'snip_boundary'

/**
 * Boundary left behind by a snip. It is a system message so the REPL shows
 * it (SnipBoundaryMessage) and normalizeMessagesForAPI drops it; it carries
 * the removed uuids so the projection needs no module state and survives a
 * session restore (the boundary lives in the transcript).
 */
export type SnipBoundaryMessage = Message & {
  type: 'system'
  subtype: typeof SNIP_BOUNDARY_SUBTYPE
  content: string
  snippedUuids: string[]
  snipToolUseIds: string[]
  tokensFreed: number
  reason?: string
}

export function isSnipBoundaryMessage(
  message: Message | undefined | null,
): message is SnipBoundaryMessage {
  return (
    !!message &&
    message.type === 'system' &&
    (message as { subtype?: string }).subtype === SNIP_BOUNDARY_SUBTYPE
  )
}

/** All uuids removed by every boundary present in the list. */
export function collectSnippedUuids(messages: readonly Message[]): Set<string> {
  const snipped = new Set<string>()
  for (const m of messages) {
    if (isSnipBoundaryMessage(m)) {
      for (const u of m.snippedUuids) snipped.add(u)
    }
  }
  return snipped
}

/**
 * The model-facing view: drops every message a boundary snipped. Cheap on
 * the hot path when nothing was snipped (one pass, no allocation).
 */
export function projectSnippedView<T extends Message>(messages: T[]): T[] {
  const snipped = collectSnippedUuids(messages)
  if (snipped.size === 0) return messages
  return messages.filter(m => !snipped.has(m.uuid))
}
