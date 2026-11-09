import { getWorkflowTasks } from '../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'
import {
  initBundledWorkflows,
  listBundledWorkflows,
} from '../../tools/WorkflowTool/bundled/index.js'
import type { LocalCommandCall } from '../../types/command.js'

export const call: LocalCommandCall = async (_args, context) => {
  initBundledWorkflows()
  const runs = getWorkflowTasks(context.getAppState())
  const lines: string[] = []
  if (runs.length === 0) {
    lines.push('No workflow runs in this session.')
  } else {
    lines.push('Workflow runs:')
    for (const run of runs) {
      const elapsed = Math.round(((run.endTime ?? Date.now()) - run.startTime) / 1000)
      const done = run.agents.filter(a => a.status === 'completed').length
      lines.push(
        `  ${run.id}  ${run.name}  ${run.status}  ${elapsed}s  agents ${done}/${run.agents.length}` +
          (run.currentPhase ? `  phase: ${run.currentPhase}` : '') +
          (run.error ? `  error: ${run.error}` : ''),
      )
      for (const a of run.agents) {
        lines.push(`      - ${a.label} [${a.status}]${a.phase ? ` (${a.phase})` : ''}${a.error ? `: ${a.error}` : ''}`)
      }
      lines.push(`      output: ${run.outputFile}`)
    }
  }
  const bundled = listBundledWorkflows()
  lines.push('')
  lines.push('Available workflows (run with the slash command below, or the Workflow tool):')
  for (const wf of bundled) lines.push(`  /${wf.name}  ${wf.description}`)
  lines.push('  Saved workflows: any .js file in .claude/workflows/ (project) or workflows/ (config dir) becomes a slash command')
  return { type: 'text', value: lines.join('\n') }
}
