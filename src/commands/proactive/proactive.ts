import {
  activateProactive,
  deactivateProactive,
  getProactiveState,
  getTickPrompt,
  isProactiveActive,
  isProactivePaused,
  pauseProactive,
  PROACTIVE_TICK_INTERVAL_MS,
  recordTick,
  resumeProactive,
  scheduleNextTick,
} from '../../proactive/index.js'
import type { LocalCommandCall } from '../../types/command.js'
import { enqueue } from '../../utils/messageQueueManager.js'

function status(): string {
  const s = getProactiveState()
  if (!s.active) return 'Proactive mode is off. `/proactive on` starts it.'
  return [
    `Proactive mode is ${isProactivePaused() ? 'paused' : 'on'} (since ${s.activatedAt ? new Date(s.activatedAt).toLocaleTimeString() : '?'}, ${s.tickCount} ticks, every ${Math.round(PROACTIVE_TICK_INTERVAL_MS / 60_000)} min).`,
    s.contextBlocked ? 'Ticks are blocked because the context is full; run /compact or /clear.' : null,
  ]
    .filter(Boolean)
    .join('\n')
}

function kickTick(): void {
  recordTick()
  enqueue({ value: getTickPrompt(), mode: 'prompt', priority: 'later' })
}

export const call: LocalCommandCall = async args => {
  const action = (args || 'status').trim().toLowerCase()
  switch (action) {
    case 'on':
    case 'start':
      if (!isProactiveActive()) {
        // activateProactive schedules the first tick; useProactive (REPL) or
        // print.ts (headless) delivers it.
        activateProactive('command')
        return { type: 'text', value: `Proactive mode on. The model gets a tick prompt shortly, then every ${Math.round(PROACTIVE_TICK_INTERVAL_MS / 60_000)} min or whenever its Sleep ends. \`/proactive off\` stops it.` }
      }
      if (isProactivePaused()) resumeProactive()
      return { type: 'text', value: status() }
    case 'off':
    case 'stop':
      deactivateProactive()
      return { type: 'text', value: 'Proactive mode off.' }
    case 'pause':
      pauseProactive()
      return { type: 'text', value: status() }
    case 'resume':
      resumeProactive()
      if (isProactiveActive()) scheduleNextTick(0)
      return { type: 'text', value: status() }
    case 'tick':
      if (!isProactiveActive()) activateProactive('command')
      kickTick()
      return { type: 'text', value: 'Tick sent.' }
    default:
      return { type: 'text', value: status() }
  }
}
