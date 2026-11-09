import type { Command } from '../../commands.js'

const assistant = {
  type: 'local',
  name: 'assistant',
  description: 'Show assistant-mode status and how to enable it',
  supportsNonInteractive: true,
  load: () => import('./assistant.js'),
} satisfies Command

export default assistant
