import { feature } from 'bun:bundle'
import { shouldAutoEnableClaudeInChrome } from 'src/utils/claudeInChrome/setup.js'
import { registerBatchSkill } from './batch.js'
import { registerClaudeInChromeSkill } from './claudeInChrome.js'
import { registerDebugSkill } from './debug.js'
import { registerKeybindingsSkill } from './keybindings.js'
import { registerLoremIpsumSkill } from './loremIpsum.js'
import { registerRememberSkill } from './remember.js'
import { registerSimplifySkill } from './simplify.js'
import { registerSkillifySkill } from './skillify.js'
import { registerStuckSkill } from './stuck.js'
import { registerUpdateConfigSkill } from './updateConfig.js'
import { registerVerifySkill } from './verify.js'
// Feature-gated skills: imported statically (not via require) so they register
// in the same bundled-skill registry instance as everything else.
import { registerClaudeApiSkill } from './claudeApi.js'
import { registerDreamSkill } from './dream.js'
import { registerHunterSkill } from './hunter.js'
import { registerLoopSkill } from './loop.js'
import { registerRunSkillGeneratorSkill } from './runSkillGenerator.js'
import { registerScheduleRemoteAgentsSkill } from './scheduleRemoteAgents.js'

/**
 * Initialize all bundled skills.
 * Called at startup to register skills that ship with the CLI.
 *
 * To add a new bundled skill:
 * 1. Create a new file in src/skills/bundled/ (e.g., myskill.ts)
 * 2. Export a register function that calls registerBundledSkill()
 * 3. Import and call that function here
 */
export function initBundledSkills(): void {
  registerUpdateConfigSkill()
  registerKeybindingsSkill()
  registerVerifySkill()
  registerDebugSkill()
  registerLoremIpsumSkill()
  registerSkillifySkill()
  registerRememberSkill()
  registerSimplifySkill()
  registerBatchSkill()
  registerStuckSkill()
  if (feature('KAIROS') || feature('KAIROS_DREAM')) {
    registerDreamSkill()
  }
  if (feature('REVIEW_ARTIFACT')) {
    registerHunterSkill()
  }
  if (feature('AGENT_TRIGGERS')) {
    // /loop's isEnabled delegates to isKairosCronEnabled(); registered
    // unconditionally, the skill's own isEnabled decides visibility.
    registerLoopSkill()
  }
  if (feature('AGENT_TRIGGERS_REMOTE')) {
    registerScheduleRemoteAgentsSkill()
  }
  if (feature('BUILDING_CLAUDE_APPS')) {
    registerClaudeApiSkill()
  }
  if (shouldAutoEnableClaudeInChrome()) {
    registerClaudeInChromeSkill()
  }
  if (feature('RUN_SKILL_GENERATOR')) {
    registerRunSkillGeneratorSkill()
  }
}
