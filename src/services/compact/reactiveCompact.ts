import { feature } from 'bun:bundle'
import type { QuerySource } from '../../constants/querySource.js'
import type { AssistantMessage, Message } from '../../types/message.js'
import { logForDebugging } from '../../utils/debug.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import type { CacheSafeParams } from '../../utils/forkedAgent.js'
import type { CompactionResult } from './compact.js'

// This module is loaded with require() from the query loop, so it must not
// statically import the compaction/hook graph (it reaches ripgrep.ts, which
// cannot be loaded as CJS). Everything heavy is imported when first used.
async function deps() {
  const [compact, hooks, errors, errorsUtil, log, sessionMemory, warning, micro, cleanup] =
    await Promise.all([
      import('./compact.js'),
      import('../../utils/hooks.js'),
      import('../api/errors.js'),
      import('../../utils/errors.js'),
      import('../../utils/log.js'),
      import('../SessionMemory/sessionMemoryUtils.js'),
      import('./compactWarningState.js'),
      import('./microCompact.js'),
      import('./postCompactCleanup.js'),
    ])
  return { compact, hooks, errors, errorsUtil, log, sessionMemory, warning, micro, cleanup }
}

const PROMPT_TOO_LONG_PREFIX = 'Prompt is too long'

function isPromptTooLongMessage(msg: AssistantMessage): boolean {
  if (!msg.isApiErrorMessage) return false
  const content = msg.message.content
  return (
    Array.isArray(content) &&
    content.some(b => b.type === 'text' && b.text.startsWith(PROMPT_TOO_LONG_PREFIX))
  )
}

function isMediaSizeErrorMessage(msg: AssistantMessage): boolean {
  const raw = msg.errorDetails
  if (msg.isApiErrorMessage !== true || typeof raw !== 'string') return false
  return (
    (raw.includes('image exceeds') && raw.includes('maximum')) ||
    (raw.includes('image dimensions exceed') && raw.includes('many-image')) ||
    /maximum of \d+ PDF pages/.test(raw)
  )
}

/**
 * Reactive compaction: instead of (or in addition to) compacting ahead of a
 * threshold, recover when the API actually rejects a request as too long.
 * The query loop withholds the prompt-too-long / media-size error from the
 * stream, calls `tryReactiveCompact`, and retries the turn on the compacted
 * conversation. `/compact` can also be routed through this path
 * (`isReactiveOnlyMode`).
 */

export type ReactiveCompactOutcome =
  | { ok: true; result: CompactionResult }
  | {
      ok: false
      reason:
        | 'too_few_groups'
        | 'aborted'
        | 'exhausted'
        | 'error'
        | 'media_unstrippable'
    }

export function isReactiveCompactEnabled(): boolean {
  if (!feature('REACTIVE_COMPACT')) return false
  if (isEnvTruthy(process.env.DISABLE_COMPACT)) return false
  if (isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_REACTIVE_COMPACT)) return false
  return true
}

/**
 * When set, /compact summarizes through the reactive path (no microcompact
 * pre-pass, auto-compact threshold ignored). Off by default.
 */
export function isReactiveOnlyMode(): boolean {
  return (
    isReactiveCompactEnabled() &&
    isEnvTruthy(process.env.CLAUDE_CODE_REACTIVE_COMPACT_ONLY)
  )
}

/**
 * Should this streamed message be held back from the caller so the loop can
 * try compaction first? Only prompt-too-long API errors qualify.
 */
export function isWithheldPromptTooLong(
  msg: Message | { type: string } | undefined,
): msg is AssistantMessage {
  if (!isReactiveCompactEnabled()) return false
  if (!msg || msg.type !== 'assistant') return false
  const m = msg as AssistantMessage
  return m.isApiErrorMessage === true && isPromptTooLongMessage(m)
}

/** Image / PDF / many-image rejections that stripping media can fix. */
export function isWithheldMediaSizeError(
  msg: Message | { type: string } | undefined,
): msg is AssistantMessage {
  if (!isReactiveCompactEnabled()) return false
  if (!msg || msg.type !== 'assistant') return false
  return isMediaSizeErrorMessage(msg as AssistantMessage)
}

function hasMediaBlocks(messages: Message[]): boolean {
  return messages.some(
    m =>
      m.type === 'user' &&
      Array.isArray(m.message.content) &&
      m.message.content.some(
        b =>
          b.type === 'image' ||
          (b.type === 'document' &&
            typeof (b as { source?: { type?: string } }).source?.type === 'string'),
      ),
  )
}

function conversationGroups(messages: Message[]): number {
  // A "group" is one user→assistant exchange; compaction needs at least two
  // so that a summary carries any information the tail does not.
  return messages.filter(m => m.type === 'user' && !('isMeta' in m && m.isMeta)).length
}

/**
 * Summarize `messages` in response to a rejected request. For media errors
 * the images/PDFs are replaced with placeholders first so the summary request
 * itself is not rejected for the same reason. compactConversation already
 * handles a summary request that is itself too long (head truncation retry)
 * and runs the PostCompact hooks.
 */
export async function reactiveCompactOnPromptTooLong(
  messages: Message[],
  cacheSafeParams: CacheSafeParams,
  options: {
    customInstructions?: string
    trigger: 'manual' | 'auto'
    mediaError?: boolean
  },
): Promise<ReactiveCompactOutcome> {
  const { compact, errorsUtil, log } = await deps()
  const context = cacheSafeParams.toolUseContext
  const signal = context.abortController.signal
  if (conversationGroups(messages) < 2) {
    return { ok: false, reason: 'too_few_groups' }
  }
  let input = messages
  if (options.mediaError) {
    if (!hasMediaBlocks(messages)) {
      return { ok: false, reason: 'media_unstrippable' }
    }
    input = compact.stripImagesFromMessages(messages)
  }
  try {
    const result = await compact.compactConversation(
      input,
      context,
      { ...cacheSafeParams, forkContextMessages: input },
      true,
      options.customInstructions,
      options.trigger === 'auto',
    )
    return { ok: true, result }
  } catch (error) {
    if (signal.aborted) return { ok: false, reason: 'aborted' }
    if (errorsUtil.hasExactErrorMessage(error, compact.ERROR_MESSAGE_NOT_ENOUGH_MESSAGES)) {
      return { ok: false, reason: 'too_few_groups' }
    }
    const text = error instanceof Error ? error.message : String(error)
    if (/prompt is too long/i.test(text)) {
      return { ok: false, reason: 'exhausted' }
    }
    log.logError(error as Error)
    return { ok: false, reason: 'error' }
  }
}

/**
 * Entry point used by the query loop after a withheld 413 / media error.
 * Returns the compaction result to retry with, or null when recovery must
 * not run (already tried this turn, aborted, or we are inside a compaction
 * request ourselves) or failed.
 */
export async function tryReactiveCompact(params: {
  hasAttempted: boolean
  querySource: QuerySource
  aborted: boolean
  messages: Message[]
  cacheSafeParams: CacheSafeParams
}): Promise<CompactionResult | null> {
  const { hasAttempted, querySource, aborted, messages, cacheSafeParams } =
    params
  if (!isReactiveCompactEnabled()) return null
  if (hasAttempted || aborted) return null
  if (querySource === 'compact' || querySource === 'session_memory') return null

  const lastMessage = messages.at(-1)
  const mediaError =
    lastMessage?.type === 'assistant' &&
    isMediaSizeErrorMessage(lastMessage as AssistantMessage)
  // The rejected attempt's error message (if the caller left it in) carries
  // nothing worth summarizing.
  const toCompact =
    lastMessage?.type === 'assistant' &&
    (lastMessage as AssistantMessage).isApiErrorMessage
      ? messages.slice(0, -1)
      : messages

  const { compact, hooks, log, sessionMemory, warning, micro, cleanup } = await deps()
  const context = cacheSafeParams.toolUseContext
  const signal = context.abortController.signal
  context.onCompactProgress?.({ type: 'hooks_start', hookType: 'pre_compact' })
  let customInstructions: string | undefined
  try {
    const hookResult = await hooks.executePreCompactHooks(
      { trigger: 'auto', customInstructions: null },
      signal,
    )
    customInstructions = compact.mergeHookInstructions(
      undefined,
      hookResult.newCustomInstructions,
    )
  } catch (error) {
    log.logError(error as Error)
  }

  logForDebugging(
    `[reactiveCompact] ${mediaError ? 'media-size' : 'prompt-too-long'} recovery on ${toCompact.length} messages (${querySource})`,
  )
  const outcome = await reactiveCompactOnPromptTooLong(
    toCompact,
    cacheSafeParams,
    { customInstructions, trigger: 'auto', mediaError },
  )
  if (!outcome.ok) {
    logForDebugging(`[reactiveCompact] gave up: ${outcome.reason}`)
    context.onCompactProgress?.({ type: 'compact_end' })
    return null
  }

  sessionMemory.setLastSummarizedMessageId(undefined)
  cleanup.runPostCompactCleanup(querySource)
  warning.suppressCompactWarning()
  micro.resetMicrocompactState()
  return outcome.result
}
