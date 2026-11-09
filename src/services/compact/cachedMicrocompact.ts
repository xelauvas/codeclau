/**
 * Cached microcompact: instead of rewriting old tool results locally, ask the
 * API to drop them from the cached prompt with `cache_edits` blocks. That
 * needs Anthropic's cache-editing beta, which no OpenAI-compatible backend
 * offers, so this implementation keeps the bookkeeping but never enables the
 * path. Enabling it requires CLAUDE_CODE_CACHED_MICROCOMPACT=1 and a model
 * listed in the config.
 */
import { isEnvTruthy } from '../../utils/envUtils.js'

export type CacheEdit = {
  type: 'clear_tool_uses_20250919'
  tool_use_ids: string[]
}

export type CacheEditsBlock = {
  type: 'cache_edits'
  edits: CacheEdit[]
}

export type PinnedCacheEdits = {
  userMessageIndex: number
  block: CacheEditsBlock
}

export type CachedMCState = {
  /** tool_use_id -> whether the result has been sent to the API at least once */
  toolResults: Map<string, { sent: boolean; order: number }>
  /** tool_use_ids grouped by the user message that carried them, oldest first */
  toolMessages: string[][]
  /** ids already deleted via cache edits */
  deleted: Set<string>
  pinnedEdits: PinnedCacheEdits[]
  nextOrder: number
}

export type CachedMCConfig = {
  supportedModels: string[]
  /** start deleting once this many sent tool results exist */
  triggerThreshold: number
  /** keep this many most recent tool results */
  keepRecent: number
}

const DEFAULT_CONFIG: CachedMCConfig = {
  supportedModels: [],
  triggerThreshold: 40,
  keepRecent: 20,
}

export function getCachedMCConfig(): CachedMCConfig {
  const models = (process.env.CLAUDE_CODE_CACHED_MC_MODELS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  return { ...DEFAULT_CONFIG, supportedModels: models }
}

export function isCachedMicrocompactEnabled(): boolean {
  return isEnvTruthy(process.env.CLAUDE_CODE_CACHED_MICROCOMPACT)
}

export function isModelSupportedForCacheEditing(model: string): boolean {
  if (!isCachedMicrocompactEnabled()) return false
  return getCachedMCConfig().supportedModels.some(m => model.includes(m))
}

export function createCachedMCState(): CachedMCState {
  return {
    toolResults: new Map(),
    toolMessages: [],
    deleted: new Set(),
    pinnedEdits: [],
    nextOrder: 0,
  }
}

export function resetCachedMCState(state: CachedMCState): void {
  state.toolResults.clear()
  state.toolMessages = []
  state.deleted.clear()
  state.pinnedEdits = []
  state.nextOrder = 0
}

export function registerToolResult(state: CachedMCState, toolUseId: string): void {
  if (!state.toolResults.has(toolUseId)) {
    state.toolResults.set(toolUseId, { sent: false, order: state.nextOrder++ })
  }
}

export function registerToolMessage(state: CachedMCState, toolUseIds: string[]): void {
  if (toolUseIds.length > 0) state.toolMessages.push([...toolUseIds])
}

export function markToolsSentToAPI(state: CachedMCState): void {
  for (const entry of state.toolResults.values()) entry.sent = true
}

/** Oldest sent tool results beyond the keep window, not yet deleted. */
export function getToolResultsToDelete(state: CachedMCState): string[] {
  const { triggerThreshold, keepRecent } = getCachedMCConfig()
  const sent = [...state.toolResults.entries()]
    .filter(([id, e]) => e.sent && !state.deleted.has(id))
    .sort((a, b) => a[1].order - b[1].order)
  if (sent.length < triggerThreshold) return []
  return sent.slice(0, Math.max(0, sent.length - keepRecent)).map(([id]) => id)
}

export function createCacheEditsBlock(state: CachedMCState, toolUseIds: string[]): CacheEditsBlock {
  for (const id of toolUseIds) state.deleted.add(id)
  return { type: 'cache_edits', edits: [{ type: 'clear_tool_uses_20250919', tool_use_ids: toolUseIds }] }
}
