import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { registerBundledSkill } from '../bundledSkills.js'

const PROMPT = `# Skill generator {{request}}

You are creating a new reusable skill: a SKILL.md file that teaches a future session how to do one kind of task well.

## Step 1: Pin down the skill
From the request above (ask one short question if it is genuinely ambiguous):
- a kebab-case name (3 words max), e.g. \`release-notes\`
- a one-sentence description starting with "Use when ..." that says when the skill applies and what it produces
- the inputs it needs (arguments, files, environment) and the tools it should be allowed to use

## Step 2: Research before writing
Look at how the task is actually done in this repository or environment: existing scripts, conventions, commands that work, pitfalls visible in git history or docs. A skill that repeats generic advice is useless; capture the specific commands, paths and checks.

## Step 3: Write the skill
Create \`{{skillsDir}}/<name>/SKILL.md\` with this shape:

\`\`\`markdown
---
name: <name>
description: Use when <situation> — <what it does / produces>
argument-hint: <what to pass, if anything>
allowed-tools: <comma-separated tool names, only if it should be restricted>
---

# <Title>

<One paragraph: purpose and when to use it.>

## Inputs
## Steps
<Numbered, concrete, with the exact commands and files. Include verification at the end of each major step.>
## Pitfalls
## Done when
<Observable completion criteria.>
\`\`\`

Keep it under about 150 lines; move long reference material into sibling files in the same directory and link them by relative path.

## Step 4: Verify
Re-read the file as if you were a new session with no context. Fix anything that assumes knowledge the skill does not provide. Then tell the user the path, the name to invoke it with (\`/<name>\`), and a one-line summary.`

export function registerRunSkillGeneratorSkill(): void {
  registerBundledSkill({
    name: 'run-skill-generator',
    aliases: ['skill-generator', 'generate-skill'],
    description:
      'Generates a new reusable skill (SKILL.md) for a task you describe, grounded in how the task is done in this environment',
    whenToUse:
      'When the user asks to create, generate or scaffold a new skill or slash command for a recurring task.',
    argumentHint: '<what the skill should do>',
    userInvocable: true,
    async getPromptForCommand(args) {
      const request = args?.trim() ? `\n\nRequest: ${args.trim()}` : ''
      const skillsDir = `${getClaudeConfigHomeDir()}/skills`
      return [{ type: 'text', text: PROMPT.replace('{{request}}', request).replace('{{skillsDir}}', skillsDir) }]
    },
  })
}
