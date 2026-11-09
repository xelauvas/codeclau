import type { Command } from '../../commands.js'

const buddy = {
  type: 'local',
  name: 'buddy',
  description: 'Your terminal companion: hatch it, see it, rename, mute or release it',
  argumentHint: '[rename <name> | mute | unmute | release]',
  supportsNonInteractive: true,
  load: () => import('./buddy.js'),
} satisfies Command

export default buddy
