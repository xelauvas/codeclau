import { getAutoMemPath, isAutoMemoryEnabled } from '../../memdir/paths.js'
import { buildConsolidationPrompt } from '../../services/autoDream/consolidationPrompt.js'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { getProjectDir } from '../../utils/sessionStorage.js'
import { registerBundledSkill } from '../bundledSkills.js'

/**
 * /dream: a manual memory-consolidation pass. Auto-dream runs the same
 * prompt in a forked, read-only agent between sessions; this runs it in the
 * main loop with normal permissions so the user can watch and steer.
 */
export function registerDreamSkill(): void {
  registerBundledSkill({
    name: 'dream',
    description:
      'Consolidate recent memory: distill daily logs and session learnings into well-organized memory files and refresh the index',
    whenToUse:
      'When the user asks to consolidate, clean up, reorganize or "dream" over memory, or when memory files have grown stale or duplicated.',
    argumentHint: '[focus or extra instructions]',
    userInvocable: true,
    isEnabled: () => isAutoMemoryEnabled(),
    async getPromptForCommand(args) {
      const memoryRoot = getAutoMemPath()
      const transcriptDir = getProjectDir(getOriginalCwd())
      const extra = args?.trim()
        ? `\n\nFocus for this pass: ${args.trim()}`
        : '\n\nThis is a manual pass started by the user; summarize what you changed when you are done.'
      return [{ type: 'text', text: buildConsolidationPrompt(memoryRoot, transcriptDir, extra) }]
    },
  })
}
