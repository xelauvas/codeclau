import { getAssistantSystemPromptAddendum, isAssistantForced, isAssistantMode, isAssistantTeamInitialized } from '../../assistant/index.js'
import type { LocalCommandCall } from '../../types/command.js'

export const call: LocalCommandCall = async args => {
  if ((args || '').trim() === 'prompt') {
    return { type: 'text', value: getAssistantSystemPromptAddendum() }
  }
  const on = isAssistantMode()
  const lines = [
    on
      ? `Assistant mode is on${isAssistantForced() ? ' (forced by --assistant)' : ''}${isAssistantTeamInitialized() ? ', team ready' : ''}.`
      : 'Assistant mode is off.',
    'Enable it with `xela-local --assistant`, `CLAUDE_CODE_ASSISTANT=1`, or a `.claude/agents/assistant.md` file in the project (its body becomes the assistant instructions).',
    '`/assistant prompt` shows the system-prompt addendum used in this mode.',
  ]
  return { type: 'text', value: lines.join('\n') }
}
