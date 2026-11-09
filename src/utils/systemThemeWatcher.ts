import { oscColor, type TerminalQuerier } from '../ink/terminal-querier.js'
import { logForDebugging } from './debug.js'
import {
  setCachedSystemTheme,
  type SystemTheme,
  themeFromOscColor,
} from './systemTheme.js'

const POLL_INTERVAL_MS = 5_000
const QUERY_TIMEOUT_MS = 1_500

/**
 * Keeps the 'auto' theme in sync with the terminal: asks for the background
 * color (OSC 11) right away and then every few seconds, and reports changes.
 * Terminals that never answer are left alone after the first silent query.
 */
export function watchSystemTheme(
  querier: TerminalQuerier | null,
  onChange: (theme: SystemTheme) => void,
): () => void {
  if (!querier) return () => {}
  let cancelled = false
  let silentPolls = 0
  let last: SystemTheme | undefined

  const poll = async (): Promise<void> => {
    if (cancelled) return
    const response = await Promise.race([
      querier.send(oscColor(11)),
      new Promise<undefined>(resolve => {
        const t = setTimeout(() => resolve(undefined), QUERY_TIMEOUT_MS)
        t.unref()
      }),
    ])
    if (cancelled) return
    const data = (response as { data?: string } | undefined)?.data
    const theme = data ? themeFromOscColor(data) : undefined
    if (!theme) {
      silentPolls++
      if (silentPolls >= 2) {
        logForDebugging('[theme] terminal does not answer OSC 11; auto theme stays at the seeded value')
        return
      }
    } else {
      silentPolls = 0
      if (theme !== last) {
        last = theme
        setCachedSystemTheme(theme)
        onChange(theme)
      }
    }
    timer = setTimeout(() => void poll(), POLL_INTERVAL_MS)
    timer.unref()
  }

  let timer: NodeJS.Timeout | undefined
  void poll()
  return () => {
    cancelled = true
    if (timer) clearTimeout(timer)
  }
}
