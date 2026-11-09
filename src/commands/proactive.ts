import type { Command } from '../commands.js'

const proactive = {
  type: 'local',
  name: 'proactive',
  description: 'Toggle proactive mode: the model keeps working between prompts (on | off | pause | resume | status)',
  argumentHint: '[on|off|pause|resume|status]',
  supportsNonInteractive: true,
  load: () => import('./proactive/proactive.js'),
} satisfies Command

export default proactive
