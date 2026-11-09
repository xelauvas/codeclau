import type { Message } from '../../types/message.js'
import { createUserMessage } from '../../utils/messages.js'

/**
 * Context collapse: spans of older messages are summarized in the
 * background ("staged") and later swapped for a placeholder ("committed").
 * The store is process-wide on globalThis because several entry points load
 * this module through the CJS require shim and would otherwise get copies.
 */
export type CommittedCollapse = {
  collapseId: string
  summaryUuid: string
  summaryContent: string
  summary: string
  firstArchivedUuid: string
  lastArchivedUuid: string
  /** Original messages, filled lazily by projectView on first match. */
  archived: Message[]
}

export type StagedSpan = {
  startUuid: string
  endUuid: string
  summary: string
  risk: number
  stagedAt: number
}

export type CollapseHealth = {
  totalSpawns: number
  totalErrors: number
  totalEmptySpawns: number
  lastError?: string
  emptySpawnWarningEmitted: boolean
}

export type CollapseStore = {
  enabled: boolean
  commits: CommittedCollapse[]
  staged: StagedSpan[]
  armed: boolean
  lastSpawnTokens: number
  spawning: boolean
  idCounter: number
  health: CollapseHealth
  listeners: Set<() => void>
}

export function getStore(): CollapseStore {
  const g = globalThis as unknown as { __xelaContextCollapse?: CollapseStore }
  if (!g.__xelaContextCollapse) {
    g.__xelaContextCollapse = freshStore()
  }
  return g.__xelaContextCollapse
}

export function freshStore(): CollapseStore {
  return {
    enabled: false,
    commits: [],
    staged: [],
    armed: true,
    lastSpawnTokens: 0,
    spawning: false,
    idCounter: 0,
    health: {
      totalSpawns: 0,
      totalErrors: 0,
      totalEmptySpawns: 0,
      emptySpawnWarningEmitted: false,
    },
    listeners: new Set(),
  }
}

export function notify(): void {
  for (const l of getStore().listeners) {
    try {
      l()
    } catch {
      // listener errors must not break the query loop
    }
  }
}

export function nextCollapseId(): string {
  const store = getStore()
  store.idCounter += 1
  return String(store.idCounter).padStart(16, '0')
}

export function makeSummaryContent(collapseId: string, summary: string): string {
  return `<collapsed id="${collapseId}">\n${summary}\n</collapsed>`
}

export function makePlaceholder(commit: CommittedCollapse): Message {
  return createUserMessage({
    content: commit.summaryContent,
    isMeta: true,
    uuid: commit.summaryUuid as never,
  })
}

/**
 * Replays the commit log on a message list: each committed span, when both
 * boundaries are present, is replaced by its placeholder. Pure; safe to run
 * on every query.
 */
export function projectView<T extends Message>(messages: T[]): T[] {
  const store = getStore()
  if (store.commits.length === 0) return messages
  let view: Message[] = messages
  for (const commit of store.commits) {
    const first = view.findIndex(m => m.uuid === commit.firstArchivedUuid)
    if (first < 0) continue
    const last = view.findIndex(m => m.uuid === commit.lastArchivedUuid)
    if (last < first) continue
    if (commit.archived.length === 0) {
      commit.archived = view.slice(first, last + 1)
    }
    view = [...view.slice(0, first), makePlaceholder(commit), ...view.slice(last + 1)]
  }
  return view as T[]
}

export function estimateTokens(messages: readonly Message[]): number {
  let total = 0
  for (const m of messages) total += estimateMessageTokens(m)
  return total
}

export function estimateMessageTokens(message: Message): number {
  const m = message as { message?: { content?: unknown }; content?: unknown }
  const content = m.message?.content ?? m.content ?? ''
  const text = typeof content === 'string' ? content : JSON.stringify(content)
  return Math.ceil(text.length / 4) + 8
}

export function getStats(): {
  collapsedSpans: number
  stagedSpans: number
  collapsedMessages: number
  health: CollapseHealth
} {
  const store = getStore()
  return {
    collapsedSpans: store.commits.length,
    stagedSpans: store.staged.length,
    collapsedMessages: store.commits.reduce((n, c) => n + c.archived.length, 0),
    health: store.health,
  }
}

/** Plain-text rendering of a message for the summarizer prompt. */
export function renderMessageForSummary(message: Message): string {
  const m = message as {
    type: string
    message?: { role?: string; content?: unknown }
    content?: unknown
  }
  const role = m.type === 'assistant' ? 'Assistant' : m.type === 'user' ? 'User' : m.type
  const content = m.message?.content ?? m.content ?? ''
  if (typeof content === 'string') return `${role}: ${content}`
  if (!Array.isArray(content)) return `${role}: ${JSON.stringify(content)}`
  const parts: string[] = []
  for (const block of content as Array<Record<string, unknown>>) {
    switch (block.type) {
      case 'text':
        parts.push(String(block.text ?? ''))
        break
      case 'tool_use':
        parts.push(`[tool ${String(block.name)} ${JSON.stringify(block.input).slice(0, 400)}]`)
        break
      case 'tool_result': {
        const c = block.content
        const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => (x as { text?: string }).text ?? '').join('\n') : ''
        parts.push(`[result ${text.slice(0, 1500)}${text.length > 1500 ? '…' : ''}]`)
        break
      }
      case 'thinking':
        break
      default:
        parts.push(`[${String(block.type)}]`)
    }
  }
  return `${role}: ${parts.join('\n')}`
}
