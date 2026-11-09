import { randomUUID } from 'crypto'
import { feature } from 'bun:bundle'
import { SNIP_TOOL_NAME } from '../../tools/SnipTool/prompt.js'
import type { Message } from '../../types/message.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { deriveShortMessageId } from '../../utils/messages.js'
import {
  collectSnippedUuids,
  isSnipBoundaryMessage,
  projectSnippedView,
  SNIP_BOUNDARY_SUBTYPE,
  type SnipBoundaryMessage,
} from './snipProjection.js'

// Turns at the end of the conversation that a snip can never reach
const PROTECTED_TAIL_USER_TURNS = 2
// Growth (estimated tokens) between context-efficiency nudges
const NUDGE_INTERVAL_TOKENS = 10_000
// Below this total the conversation is small enough that nudging is noise
const NUDGE_MIN_TOTAL_TOKENS = 30_000

export const SNIP_NUDGE_TEXT =
  `Context check: the conversation has grown. If earlier messages are no longer useful ` +
  `(large tool output you already acted on, dead-end attempts, resolved sub-tasks), remove them with the ${SNIP_TOOL_NAME} tool: ` +
  `pass the [id:...] tag of the first and last message of the range. Do this only when it clearly helps; never snip what you may still need.`

export type SnipResult = {
  messages: Message[]
  tokensFreed: number
  boundaryMessage?: SnipBoundaryMessage
  executed: boolean
}

export function isSnipRuntimeEnabled(): boolean {
  if (!feature('HISTORY_SNIP')) return false
  return !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_SNIP)
}

/** Snip markers are not used by this implementation (the tool call itself is the marker). */
export function isSnipMarkerMessage(_message: Message): boolean {
  return false
}

export function estimateMessageTokens(message: Message): number {
  const m = message as { message?: { content?: unknown }; content?: unknown }
  const content = m.message?.content ?? m.content ?? ''
  const text = typeof content === 'string' ? content : JSON.stringify(content)
  return Math.ceil(text.length / 4) + 8
}

type SnipRequest = {
  toolUseId: string
  startId: string
  endId: string
  reason?: string
  /** index of the assistant message that issued the Snip call */
  callerIndex: number
}

function findSnipRequests(
  messages: readonly Message[],
  alreadyApplied: Set<string>,
): SnipRequest[] {
  const requests: SnipRequest[] = []
  messages.forEach((m, index) => {
    if (m.type !== 'assistant') return
    const content = (m as { message: { content: unknown } }).message.content
    if (!Array.isArray(content)) return
    for (const block of content as Array<{
      type: string
      id?: string
      name?: string
      input?: { start_id?: string; end_id?: string; reason?: string }
    }>) {
      if (block.type !== 'tool_use' || block.name !== SNIP_TOOL_NAME || !block.id) continue
      if (alreadyApplied.has(block.id)) continue
      const start = block.input?.start_id?.trim()
      const end = block.input?.end_id?.trim()
      if (!start || !end) continue
      requests.push({
        toolUseId: block.id,
        startId: start.replace(/^\[?id:/, '').replace(/\]$/, ''),
        endId: end.replace(/^\[?id:/, '').replace(/\]$/, ''),
        reason: block.input?.reason,
        callerIndex: index,
      })
    }
  })
  return requests
}

function toolUseIdsOf(message: Message): string[] {
  if (message.type !== 'assistant') return []
  const content = (message as { message: { content: unknown } }).message.content
  if (!Array.isArray(content)) return []
  return (content as Array<{ type: string; id?: string }>)
    .filter(b => b.type === 'tool_use' && b.id)
    .map(b => b.id!)
}

function toolResultIdsOf(message: Message): string[] {
  if (message.type !== 'user') return []
  const content = (message as { message: { content: unknown } }).message.content
  if (!Array.isArray(content)) return []
  return (content as Array<{ type: string; tool_use_id?: string }>)
    .filter(b => b.type === 'tool_result' && b.tool_use_id)
    .map(b => b.tool_use_id!)
}

function isRealUserTurn(message: Message): boolean {
  if (message.type !== 'user') return false
  if ((message as { isMeta?: boolean }).isMeta) return false
  return toolResultIdsOf(message).length === 0
}

/**
 * Resolves one Snip request to the set of uuids to remove: the tagged range,
 * closed over tool_use/tool_result pairs so the API never sees a half pair,
 * and clipped before the protected tail.
 */
function resolveRange(
  view: readonly Message[],
  req: SnipRequest,
): { uuids: Set<string>; error?: string } {
  const indexById = new Map<string, number>()
  view.forEach((m, i) => {
    if (m.type === 'user' || m.type === 'assistant') {
      indexById.set(deriveShortMessageId(m.uuid), i)
    }
  })
  let start = indexById.get(req.startId)
  let end = indexById.get(req.endId)
  if (start === undefined || end === undefined) {
    return { uuids: new Set(), error: `unknown message id ${start === undefined ? req.startId : req.endId}` }
  }
  if (start > end) [start, end] = [end, start]

  // Protected tail: the last N real user turns and everything after them
  let protectedFrom = view.length
  let turns = 0
  for (let i = view.length - 1; i >= 0; i--) {
    if (isRealUserTurn(view[i]!)) {
      turns++
      if (turns === PROTECTED_TAIL_USER_TURNS) {
        protectedFrom = i
        break
      }
    }
  }
  // The Snip call itself (and its result) must survive, otherwise the model
  // forgets it already snipped and repeats the request
  protectedFrom = Math.min(protectedFrom, req.callerIndex)
  if (end >= protectedFrom) end = protectedFrom - 1
  if (end < start) return { uuids: new Set(), error: 'range is entirely inside the protected recent turns' }

  const uuids = new Set<string>()
  for (let i = start; i <= end; i++) uuids.add(view[i]!.uuid)

  // Close over tool pairs
  const useToUuid = new Map<string, string>()
  const resultToUuid = new Map<string, string>()
  for (const m of view) {
    for (const id of toolUseIdsOf(m)) useToUuid.set(id, m.uuid)
    for (const id of toolResultIdsOf(m)) resultToUuid.set(id, m.uuid)
  }
  let changed = true
  while (changed) {
    changed = false
    for (const m of view) {
      if (!uuids.has(m.uuid)) continue
      for (const id of toolUseIdsOf(m)) {
        const r = resultToUuid.get(id)
        if (r && !uuids.has(r)) { uuids.add(r); changed = true }
      }
      for (const id of toolResultIdsOf(m)) {
        const u = useToUuid.get(id)
        if (u && !uuids.has(u)) { uuids.add(u); changed = true }
      }
    }
  }
  // Pair closure must not reach into the protected tail
  for (let i = protectedFrom; i < view.length; i++) uuids.delete(view[i]!.uuid)
  return { uuids }
}

/**
 * Applies pending Snip requests. Returns the model-facing message list plus
 * (at most) one new boundary describing what was removed this time. With
 * `force` the caller is replaying on its own store (QueryEngine) and wants
 * the full projected list back even when nothing new was snipped.
 */
export function snipCompactIfNeeded(
  messages: Message[],
  options: { force?: boolean } = {},
): SnipResult {
  if (!isSnipRuntimeEnabled()) {
    return { messages, tokensFreed: 0, executed: false }
  }
  const applied = new Set<string>()
  for (const m of messages) {
    if (isSnipBoundaryMessage(m)) for (const id of m.snipToolUseIds) applied.add(id)
  }
  const view = projectSnippedView(messages)
  const requests = findSnipRequests(view, applied)
  if (requests.length === 0) {
    const projected = options.force ? view : messages
    return { messages: projected, tokensFreed: 0, executed: options.force ? view.length !== messages.length : false }
  }

  const removed = new Set<string>()
  const handled: string[] = []
  const reasons: string[] = []
  for (const req of requests) {
    const { uuids, error } = resolveRange(view, req)
    handled.push(req.toolUseId)
    if (error) continue
    for (const u of uuids) removed.add(u)
    if (req.reason) reasons.push(req.reason)
  }
  if (removed.size === 0) {
    // Nothing removable; still record the tool uses so they are not retried
    const boundary = makeBoundary([], handled, 0, reasons[0])
    return { messages: options.force ? [...view, boundary] : [...messages, boundary], tokensFreed: 0, boundaryMessage: boundary, executed: true }
  }
  let tokensFreed = 0
  for (const m of view) if (removed.has(m.uuid)) tokensFreed += estimateMessageTokens(m)
  const boundary = makeBoundary([...removed], handled, tokensFreed, reasons[0])
  const base = options.force ? messages : messages
  const next = projectSnippedView([...base, boundary])
  return { messages: next, tokensFreed, boundaryMessage: boundary, executed: true }
}

function makeBoundary(
  snippedUuids: string[],
  snipToolUseIds: string[],
  tokensFreed: number,
  reason?: string,
): SnipBoundaryMessage {
  const n = snippedUuids.length
  const content =
    n === 0
      ? 'Snip: nothing removed (range was inside the protected recent turns or unknown)'
      : `Snipped ${n} ${n === 1 ? 'message' : 'messages'} (~${tokensFreed.toLocaleString()} tokens)${reason ? `: ${reason}` : ''}`
  return {
    type: 'system',
    subtype: SNIP_BOUNDARY_SUBTYPE,
    content,
    isMeta: false,
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
    level: 'info',
    snippedUuids,
    snipToolUseIds,
    tokensFreed,
    reason,
  } as SnipBoundaryMessage
}

/**
 * Nudge pacing: once the context grew by NUDGE_INTERVAL_TOKENS since the last
 * nudge, snip boundary or compact boundary, remind the model the tool exists.
 */
export function shouldNudgeForSnips(messages: readonly Message[]): boolean {
  if (!isSnipRuntimeEnabled()) return false
  const snipped = collectSnippedUuids(messages)
  let total = 0
  let sinceAnchor = 0
  for (const m of messages) {
    if (snipped.has(m.uuid)) continue
    const isAnchor =
      isSnipBoundaryMessage(m) ||
      (m.type === 'system' && (m as { subtype?: string }).subtype === 'compact_boundary') ||
      (m.type === 'user' &&
        (m as { isMeta?: boolean }).isMeta &&
        JSON.stringify((m as { message: { content: unknown } }).message.content).includes(SNIP_NUDGE_TEXT.slice(0, 40)))
    const t = estimateMessageTokens(m)
    total += t
    if (isAnchor) sinceAnchor = 0
    else sinceAnchor += t
  }
  return total >= NUDGE_MIN_TOTAL_TOKENS && sinceAnchor >= NUDGE_INTERVAL_TOKENS
}
