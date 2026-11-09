import type { Command } from '../../commands.js'

const peers = {
  type: 'local',
  name: 'peers',
  description: 'List other Xela sessions on this machine that can receive messages',
  supportsNonInteractive: true,
  load: () => import('./peers.js'),
} satisfies Command

export default peers
