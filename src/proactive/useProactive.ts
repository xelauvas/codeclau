import { useEffect, useRef, useSyncExternalStore } from 'react'
import {
  getNextTickAt,
  getTickPrompt,
  isProactiveActive,
  isProactivePaused,
  PROACTIVE_TICK_INTERVAL_MS,
  recordTick,
  scheduleNextTick,
  subscribeToProactiveChanges,
} from './index.js'

type Props = {
  isLoading: boolean
  queuedCommandsLength: number
  hasActiveLocalJsxUI: boolean
  isInPlanMode: boolean
  /** Submit a tick prompt right away (idle REPL). */
  onSubmitTick: (prompt: string) => void
  /** Queue a tick prompt behind the current turn (busy REPL). */
  onQueueTick: (prompt: string) => void
}

/**
 * Interactive tick driver. While proactive mode is active and not paused,
 * fires a <tick> prompt when the scheduled time arrives (set by Sleep or,
 * failing that, the default interval). Ticks wait while a turn is running,
 * while commands are queued, while a local dialog is open, or in plan mode.
 */
export function useProactive({
  isLoading,
  queuedCommandsLength,
  hasActiveLocalJsxUI,
  isInPlanMode,
  onSubmitTick,
  onQueueTick,
}: Props): void {
  const active = useSyncExternalStore(subscribeToProactiveChanges, isProactiveActive)
  const paused = useSyncExternalStore(subscribeToProactiveChanges, isProactivePaused)
  const nextTickAt = useSyncExternalStore(subscribeToProactiveChanges, getNextTickAt)

  const latest = useRef({ isLoading, queuedCommandsLength, hasActiveLocalJsxUI, isInPlanMode, onSubmitTick, onQueueTick })
  latest.current = { isLoading, queuedCommandsLength, hasActiveLocalJsxUI, isInPlanMode, onSubmitTick, onQueueTick }

  // Nothing scheduled while active and idle: fall back to the default interval
  // so a turn that ended without Sleep still gets a follow-up.
  useEffect(() => {
    if (!active || paused || nextTickAt !== null || isLoading) return
    scheduleNextTick(PROACTIVE_TICK_INTERVAL_MS)
  }, [active, paused, nextTickAt, isLoading])

  useEffect(() => {
    if (!active || paused || nextTickAt === null) return
    const fire = (): void => {
      const l = latest.current
      if (!isProactiveActive() || isProactivePaused()) return
      if (l.hasActiveLocalJsxUI || l.isInPlanMode) {
        // Try again shortly; the user is in a dialog or planning.
        scheduleNextTick(15_000)
        return
      }
      recordTick()
      const prompt = getTickPrompt()
      if (l.isLoading || l.queuedCommandsLength > 0) l.onQueueTick(prompt)
      else l.onSubmitTick(prompt)
    }
    const delay = Math.max(0, nextTickAt - Date.now())
    const timer = setTimeout(fire, delay)
    return () => clearTimeout(timer)
  }, [active, paused, nextTickAt])
}
