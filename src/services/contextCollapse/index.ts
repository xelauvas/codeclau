import { randomUUID } from 'crypto'
import { feature } from 'bun:bundle'
import { queryHaiku } from '../../services/api/claude.js'
import type { ToolUseContext } from '../../Tool.js'
import type { Message } from '../../types/message.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { logForDebugging } from '../../utils/debug.js'
import {
  recordContextCollapseCommit,
  recordContextCollapseSnapshot,
} from '../../utils/sessionStorage.js'
import { asSystemPrompt } from '../../utils/systemPromptType.js'
import { getEffectiveContextWindowSize } from '../compact/autoCompact.js'
import {
  type CommittedCollapse,
  estimateTokens,
  freshStore,
  getStats as getStatsImpl,
  getStore,
  makeSummaryContent,
  nextCollapseId,
  notify,
  projectView,
  renderMessageForSummary,
  type StagedSpan,
} from './operations.js'

export { projectView } from './operations.js'
export { restoreFromEntries } from './persist.js'

// Fractions of the effective context window. Each has an env override
// (CLAUDE_CONTEXT_COLLAPSE_<NAME>) for tuning and tests.
function fraction(name: string, fallback: number): number {
  const v = Number(process.env[`CLAUDE_CONTEXT_COLLAPSE_${name}`])
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : fallback
}
function integer(name: string, fallback: number): number {
  const v = Number(process.env[`CLAUDE_CONTEXT_COLLAPSE_${name}`])
  return Number.isInteger(v) && v >= 0 ? v : fallback
}
const SPAWN_FRACTION = fraction('SPAWN_FRACTION', 0.5) // start summarizing the oldest span above this
const COMMIT_FRACTION = fraction('COMMIT_FRACTION', 0.75) // swap staged spans for placeholders above this
const PROTECTED_TAIL_FRACTION = fraction('PROTECTED_TAIL_FRACTION', 0.25) // never touch the most recent share of the context
const SPAN_TARGET_FRACTION = fraction('SPAN_TARGET_FRACTION', 0.3) // a span summarizes about this much of the view
const MIN_SPAWN_INTERVAL_TOKENS = integer('MIN_SPAWN_INTERVAL_TOKENS', 6_000) // growth needed between two spawns
const MIN_SPAN_MESSAGES = integer('MIN_SPAN_MESSAGES', 4)
const MAX_SUMMARY_INPUT_CHARS = 60_000
const EMPTY_SPAWN_WARNING_AFTER = 3

export function initContextCollapse(): void {
  const store = getStore()
  store.enabled =
    feature('CONTEXT_COLLAPSE') &&
    !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_CONTEXT_COLLAPSE) &&
    process.env.CLAUDE_CONTEXT_COLLAPSE !== '0'
  notify()
}

export function isContextCollapseEnabled(): boolean {
  return feature('CONTEXT_COLLAPSE') && getStore().enabled
}

export function resetContextCollapse(): void {
  const store = getStore()
  const { enabled, listeners } = store
  Object.assign(store, freshStore(), { enabled, listeners })
  notify()
}

export function getStats(): ReturnType<typeof getStatsImpl> {
  return getStatsImpl()
}

export function subscribe(listener: () => void): () => void {
  const store = getStore()
  store.listeners.add(listener)
  return () => {
    store.listeners.delete(listener)
  }
}

function isMainThread(querySource: string, toolUseContext: ToolUseContext): boolean {
  if ((toolUseContext as { agentId?: unknown }).agentId) return false
  return querySource === 'repl_main_thread' || querySource === 'sdk'
}

function isRealUserTurn(message: Message): boolean {
  if (message.type !== 'user') return false
  if ((message as { isMeta?: boolean }).isMeta) return false
  const content = (message as { message: { content: unknown } }).message.content
  if (!Array.isArray(content)) return true
  return !(content as Array<{ type: string }>).some(b => b.type === 'tool_result')
}

function isPlaceholder(message: Message): boolean {
  const content = (message as { message?: { content?: unknown } }).message?.content
  return typeof content === 'string' && content.startsWith('<collapsed id="')
}

/**
 * Picks the oldest span worth summarizing: starts at the first real user
 * turn after the last placeholder, ends right before a later real user turn,
 * covers about SPAN_TARGET_FRACTION of the view and stays out of the
 * protected tail.
 */
function chooseSpan(view: Message[], totalTokens: number): { start: number; end: number } | null {
  let tailTokens = 0
  let protectedFrom = view.length
  for (let i = view.length - 1; i >= 0; i--) {
    tailTokens += estimateTokens([view[i]!])
    if (tailTokens >= totalTokens * PROTECTED_TAIL_FRACTION) {
      protectedFrom = i
      break
    }
  }
  // Back protectedFrom up to a real user turn so spans end on turn boundaries
  while (protectedFrom < view.length && protectedFrom > 0 && !isRealUserTurn(view[protectedFrom]!)) protectedFrom--

  let start = 0
  for (let i = 0; i < protectedFrom; i++) {
    if (isPlaceholder(view[i]!)) start = i + 1
  }
  while (start < protectedFrom && !isRealUserTurn(view[start]!)) start++
  if (start >= protectedFrom) return null

  const target = totalTokens * SPAN_TARGET_FRACTION
  let acc = 0
  let end = -1
  for (let i = start; i < protectedFrom; i++) {
    acc += estimateTokens([view[i]!])
    if (i + 1 < protectedFrom && isRealUserTurn(view[i + 1]!)) {
      end = i
      if (acc >= target) break
    }
  }
  if (end < 0) end = protectedFrom - 1
  if (end - start + 1 < MIN_SPAN_MESSAGES) return null
  return { start, end }
}

function spanAlreadyStaged(store: ReturnType<typeof getStore>, startUuid: string): boolean {
  return store.staged.some(s => s.startUuid === startUuid)
}

async function spawnSummarizer(
  view: Message[],
  span: { start: number; end: number },
  toolUseContext: ToolUseContext,
): Promise<void> {
  const store = getStore()
  store.spawning = true
  store.health.totalSpawns++
  notify()
  const messages = view.slice(span.start, span.end + 1)
  let transcript = messages.map(renderMessageForSummary).join('\n\n')
  if (transcript.length > MAX_SUMMARY_INPUT_CHARS) {
    transcript = transcript.slice(0, MAX_SUMMARY_INPUT_CHARS) + '\n…(truncated)'
  }
  const controller = new AbortController()
  try {
    const result = await queryHaiku({
      systemPrompt: asSystemPrompt([
        'You condense a slice of a coding-assistant conversation so it can be replaced in the context window. Keep every fact that later work could depend on: file paths, function and variable names, commands run and their outcomes, decisions and their reasons, errors seen, open questions, user preferences. Drop chit-chat, repeated tool output and dead ends (one line each). Write in compact prose or bullets, third person, no preamble.',
      ]),
      userPrompt: `Summarize this conversation slice:\n\n${transcript}`,
      signal: controller.signal,
      options: {
        querySource: 'compact',
        agents: [],
        isNonInteractiveSession: toolUseContext.options.isNonInteractiveSession,
        hasAppendSystemPrompt: false,
        mcpTools: [],
      },
    })
    const summary = result.message.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim()
    if (!summary) {
      store.health.totalEmptySpawns++
      if (store.health.totalEmptySpawns >= EMPTY_SPAWN_WARNING_AFTER) {
        store.health.emptySpawnWarningEmitted = true
      }
      return
    }
    store.health.totalEmptySpawns = 0
    store.health.emptySpawnWarningEmitted = false
    const staged: StagedSpan = {
      startUuid: messages[0]!.uuid,
      endUuid: messages[messages.length - 1]!.uuid,
      summary,
      risk: 0,
      stagedAt: Date.now(),
    }
    store.staged.push(staged)
    void recordContextCollapseSnapshot({
      staged: store.staged,
      armed: store.armed,
      lastSpawnTokens: store.lastSpawnTokens,
    }).catch(() => {})
    logForDebugging(`[context-collapse] staged span of ${messages.length} messages (${summary.length} chars)`)
  } catch (err) {
    store.health.totalErrors++
    store.health.lastError = err instanceof Error ? err.message : String(err)
    logForDebugging(`[context-collapse] summarizer failed: ${store.health.lastError}`)
  } finally {
    store.spawning = false
    notify()
  }
}

function commitStaged(view: Message[]): { view: Message[]; committed: number } {
  const store = getStore()
  let committed = 0
  const remaining: StagedSpan[] = []
  for (const s of store.staged) {
    const first = view.findIndex(m => m.uuid === s.startUuid)
    const last = view.findIndex(m => m.uuid === s.endUuid)
    if (first < 0 || last < first) {
      // span no longer exists in the view (compacted or snipped meanwhile)
      continue
    }
    const collapseId = nextCollapseId()
    const commit: CommittedCollapse = {
      collapseId,
      summaryUuid: randomUUID(),
      summaryContent: makeSummaryContent(collapseId, s.summary),
      summary: s.summary,
      firstArchivedUuid: s.startUuid,
      lastArchivedUuid: s.endUuid,
      archived: view.slice(first, last + 1),
    }
    store.commits.push(commit)
    committed++
    void recordContextCollapseCommit({
      collapseId: commit.collapseId,
      summaryUuid: commit.summaryUuid,
      summaryContent: commit.summaryContent,
      summary: commit.summary,
      firstArchivedUuid: commit.firstArchivedUuid,
      lastArchivedUuid: commit.lastArchivedUuid,
    }).catch(() => {})
  }
  store.staged = remaining
  if (committed > 0) {
    void recordContextCollapseSnapshot({
      staged: store.staged,
      armed: store.armed,
      lastSpawnTokens: store.lastSpawnTokens,
    }).catch(() => {})
    notify()
  }
  return { view: projectView(view), committed }
}

/**
 * Called on every main-thread query. Projects committed collapses, commits
 * staged ones when the context is high, and kicks off a background
 * summarizer when it is time to prepare the next span.
 */
export async function applyCollapsesIfNeeded(
  messages: Message[],
  toolUseContext: ToolUseContext,
  querySource: string,
): Promise<{ messages: Message[] }> {
  if (!isContextCollapseEnabled() || !isMainThread(querySource, toolUseContext)) {
    return { messages: projectView(messages) }
  }
  const store = getStore()
  let view = projectView(messages)
  const window = getEffectiveContextWindowSize(toolUseContext.options.mainLoopModel)
  let tokens = estimateTokens(view)

  if (store.staged.length > 0 && tokens >= window * COMMIT_FRACTION) {
    const result = commitStaged(view)
    view = result.view
    tokens = estimateTokens(view)
  }

  if (
    store.armed &&
    !store.spawning &&
    tokens >= window * SPAWN_FRACTION &&
    tokens - store.lastSpawnTokens >= MIN_SPAWN_INTERVAL_TOKENS
  ) {
    const span = chooseSpan(view, tokens)
    if (span && !spanAlreadyStaged(store, view[span.start]!.uuid)) {
      store.lastSpawnTokens = tokens
      void spawnSummarizer(view, span, toolUseContext)
    }
  }
  return { messages: view }
}

/**
 * Overflow recovery: the request was too long, so swap every staged span for
 * its placeholder now and let the caller retry.
 */
export function recoverFromOverflow(
  messages: Message[],
  _querySource: string,
): { messages: Message[]; committed: number } {
  if (!isContextCollapseEnabled()) return { messages, committed: 0 }
  const result = commitStaged(projectView(messages))
  return { messages: result.view, committed: result.committed }
}

/**
 * A prompt-too-long error is withheld from the conversation (and handled by
 * recoverFromOverflow) only when there is staged material to commit.
 */
export function isWithheldPromptTooLong(
  message: Message,
  isPromptTooLongMessage: (m: Message) => boolean,
  querySource: string,
): boolean {
  if (!isContextCollapseEnabled()) return false
  if (querySource !== 'repl_main_thread' && querySource !== 'sdk') return false
  if (getStore().staged.length === 0) return false
  return isPromptTooLongMessage(message)
}
