import type {
  ContextCollapseCommitEntry,
  ContextCollapseSnapshotEntry,
} from '../../types/logs.js'
import { freshStore, getStore, notify } from './operations.js'

/**
 * Rebuilds the store from transcript entries on resume. Commits replay in
 * order with an empty archive (projectView fills it lazily); the snapshot
 * restores the staged queue and the spawn clock. Always resets first so a
 * resume into a session with no entries drops the previous session's state.
 */
export function restoreFromEntries(
  commits: ContextCollapseCommitEntry[],
  snapshot: ContextCollapseSnapshotEntry | undefined,
): void {
  const store = getStore()
  const enabled = store.enabled
  const listeners = store.listeners
  Object.assign(store, freshStore(), { enabled, listeners })
  for (const c of commits) {
    store.commits.push({
      collapseId: c.collapseId,
      summaryUuid: c.summaryUuid,
      summaryContent: c.summaryContent,
      summary: c.summary,
      firstArchivedUuid: c.firstArchivedUuid,
      lastArchivedUuid: c.lastArchivedUuid,
      archived: [],
    })
    const n = Number(c.collapseId)
    if (Number.isFinite(n) && n > store.idCounter) store.idCounter = n
  }
  if (snapshot) {
    store.staged = snapshot.staged.map(s => ({ ...s }))
    store.armed = snapshot.armed
    store.lastSpawnTokens = snapshot.lastSpawnTokens
  }
  notify()
}
