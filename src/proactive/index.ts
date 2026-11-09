import { TICK_TAG } from '../constants/xml.js'

/**
 * Proactive mode: the model keeps working between user prompts. The session
 * receives periodic <tick> prompts (interactive: useProactive in the REPL;
 * headless: print.ts scheduleProactiveTick) and either does something useful
 * or calls Sleep, which schedules the next tick. State lives on globalThis
 * because this module is reached both through ESM imports and the CJS
 * require shim, and React reads it through subscribeToProactiveChanges.
 */
export type ProactiveSource = 'command' | 'flag' | 'sdk' | 'env'

type ProactiveState = {
  active: boolean
  paused: boolean
  contextBlocked: boolean
  source: ProactiveSource | null
  activatedAt: number | null
  tickCount: number
  lastTickAt: number | null
  /** When the next tick is due (set by Sleep or the ticker), null when none is scheduled. */
  nextTickAt: number | null
  listeners: Set<() => void>
}

const state: ProactiveState = ((globalThis as unknown as { __xelaProactive?: ProactiveState })
  .__xelaProactive ??= {
  active: false,
  paused: false,
  contextBlocked: false,
  source: null,
  activatedAt: null,
  tickCount: 0,
  lastTickAt: null,
  nextTickAt: null,
  listeners: new Set(),
})

/** Default spacing between ticks when the model does not Sleep itself. */
export const PROACTIVE_TICK_INTERVAL_MS = Number(
  process.env.CLAUDE_CODE_PROACTIVE_TICK_MS || 5 * 60_000,
)
/** First tick shortly after activation so the model greets and starts. */
export const PROACTIVE_FIRST_TICK_MS = 1_500

function notify(): void {
  for (const l of state.listeners) {
    try {
      l()
    } catch {
      // listener errors must not break state updates
    }
  }
}

export function subscribeToProactiveChanges(listener: () => void): () => void {
  state.listeners.add(listener)
  return () => {
    state.listeners.delete(listener)
  }
}

export function isProactiveActive(): boolean {
  return state.active
}

export function isProactivePaused(): boolean {
  return state.paused || state.contextBlocked
}

export function isContextBlocked(): boolean {
  return state.contextBlocked
}

export function getNextTickAt(): number | null {
  return state.active && !isProactivePaused() ? state.nextTickAt : null
}

export function getProactiveState(): Readonly<Omit<ProactiveState, 'listeners'>> {
  const { listeners: _l, ...rest } = state
  return rest
}

export function activateProactive(source: ProactiveSource = 'command'): void {
  state.active = true
  state.paused = false
  state.contextBlocked = false
  state.source = source
  state.activatedAt = Date.now()
  state.nextTickAt = Date.now() + PROACTIVE_FIRST_TICK_MS
  notify()
}

export function deactivateProactive(): void {
  state.active = false
  state.paused = false
  state.source = null
  state.nextTickAt = null
  notify()
}

export function pauseProactive(): void {
  if (!state.paused) {
    state.paused = true
    notify()
  }
}

export function resumeProactive(): void {
  if (state.paused || state.contextBlocked) {
    state.paused = false
    state.contextBlocked = false
    notify()
  }
}

/**
 * Set when the context is too full to keep ticking (prompt-too-long with
 * nothing left to compact). Cleared by /clear and by resumeProactive.
 */
export function setContextBlocked(blocked: boolean): void {
  if (state.contextBlocked !== blocked) {
    state.contextBlocked = blocked
    notify()
  }
}

/** Schedule the next tick `ms` from now (Sleep tool, ticker). */
export function scheduleNextTick(ms: number): number {
  const at = Date.now() + Math.max(0, ms)
  state.nextTickAt = at
  notify()
  return at
}

export function clearNextTick(): void {
  if (state.nextTickAt !== null) {
    state.nextTickAt = null
    notify()
  }
}

export function recordTick(): number {
  state.tickCount++
  state.lastTickAt = Date.now()
  state.nextTickAt = null
  notify()
  return state.tickCount
}

/** The prompt injected on every tick: the user's local time, as in headless mode. */
export function getTickPrompt(): string {
  return `<${TICK_TAG}>${new Date().toLocaleTimeString()}</${TICK_TAG}>`
}

export function isTickPrompt(text: string): boolean {
  return new RegExp(`^<${TICK_TAG}\\b`).test(text.trimStart())
}
