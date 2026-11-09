import type { Command } from '../../commands.js'

const workflows = {
  type: 'local',
  name: 'workflows',
  aliases: ['workflow', 'wf'],
  description: 'List workflow runs in this session and bundled/saved workflows',
  supportsNonInteractive: true,
  load: () => import('./workflows.js'),
} satisfies Command

export default workflows
