import type { LocalCommandCall } from '../../types/command.js'
import { listAllLiveSessions } from '../../utils/udsClient.js'
import { getUdsMessagingSocketPath } from '../../utils/udsMessaging.js'

export const call: LocalCommandCall = async () => {
  const sessions = await listAllLiveSessions()
  const lines: string[] = []
  const self = getUdsMessagingSocketPath()
  lines.push(self ? `This session: uds:${self}` : 'This session has no messaging socket (UDS inbox off).')
  const peers = sessions.filter(s => !s.isSelf)
  if (peers.length === 0) {
    lines.push('No other sessions found.')
  } else {
    lines.push('Other sessions:')
    for (const s of peers) {
      const age = s.startedAt ? `${Math.round((Date.now() - s.startedAt) / 60000)} min` : '?'
      lines.push(
        `  pid ${s.pid}  ${s.reachable ? 'reachable' : 'no socket'}  ${s.cwd ?? ''}${s.name ? `  [${s.name}]` : ''}  up ${age}` +
          (s.messagingSocketPath ? `\n    → SendMessage to: uds:${s.messagingSocketPath}` : ''),
      )
    }
  }
  return { type: 'text', value: lines.join('\n') }
}
