import { readdirSync, readFileSync } from 'fs'
import { basename, join } from 'path'
import type { Command } from '../../commands.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { initBundledWorkflows, listBundledWorkflows } from './bundled/index.js'
import { WORKFLOW_TOOL_NAME } from './constants.js'
import { parseWorkflowScript } from './runtime.js'

/**
 * Saved workflows become slash commands. Sources, in precedence order:
 *   <cwd>/.claude/workflows/*.js   (project)
 *   <config dir>/workflows/*.js    (user)
 *   bundled workflows
 * The command itself is a prompt that asks the model to run the Workflow
 * tool with the script, so the user's permission flow still applies.
 */
export async function getWorkflowCommands(cwd: string): Promise<Command[]> {
  initBundledWorkflows()
  const seen = new Set<string>()
  const commands: Command[] = []

  const dirs = [
    join(cwd, '.claude', 'workflows'),
    join(getClaudeConfigHomeDir(), 'workflows'),
  ]
  for (const dir of dirs) {
    let entries: string[] = []
    try {
      entries = readdirSync(dir).filter(f => /\.(m?js)$/.test(f))
    } catch {
      continue
    }
    for (const file of entries) {
      const path = join(dir, file)
      let description = `Run workflow ${file}`
      let name = basename(file).replace(/\.(m?js)$/, '')
      try {
        const { meta } = parseWorkflowScript(readFileSync(path, 'utf8'))
        description = meta.description
        name = meta.name || name
      } catch {
        // keep the filename-derived defaults; the tool reports the parse error on run
      }
      if (seen.has(name)) continue
      seen.add(name)
      commands.push(makeWorkflowCommand(name, description, `scriptPath ${JSON.stringify(path)}`))
    }
  }

  for (const wf of listBundledWorkflows()) {
    if (seen.has(wf.name)) continue
    seen.add(wf.name)
    commands.push(makeWorkflowCommand(wf.name, wf.description, `name ${JSON.stringify(wf.name)}`))
  }
  return commands
}

function makeWorkflowCommand(
  name: string,
  description: string,
  selector: string,
): Command {
  return {
    type: 'prompt',
    name,
    description: `${description} (workflow)`,
    source: 'builtin',
    progressMessage: `running workflow ${name}`,
    contentLength: 0,
    async getPromptForCommand(args: string) {
      const argsNote = args?.trim()
        ? ` Pass these arguments as the tool's \`args\` input (as a JSON string value if they are not valid JSON): ${args.trim()}`
        : ''
      return [
        {
          type: 'text' as const,
          text:
            `The user invoked the saved workflow "${name}". Run it now with the ${WORKFLOW_TOOL_NAME} tool using ${selector}.${argsNote} ` +
            `When the completion notification arrives, summarize the workflow result for the user.`,
        },
      ]
    },
  } as Command
}
