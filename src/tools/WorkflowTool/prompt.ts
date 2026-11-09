import { DEFAULT_MAX_AGENTS } from './constants.js'

export const DESCRIPTION = `Execute a workflow script that orchestrates multiple subagents deterministically. Workflows run in the background — this tool returns immediately with a task ID, and a task notification arrives when the workflow completes. Use /workflows to see runs.

Only call this tool when the user explicitly opted into multi-agent orchestration (they asked for a workflow, "fan out agents", "orchestrate with subagents", or invoked a saved/bundled workflow by name). A task that would merely benefit from parallelism does not count: use the Agent tool for individual subagents instead.

Every script must begin with \`export const meta = {...}\`: a PURE LITERAL (no variables, calls or interpolation) giving the workflow's \`name\`, a one-line \`description\` and optionally \`phases\` — one \`{ title, detail? }\` per phase() call. Pass the script inline via \`script\`; it is plain JavaScript (no imports, no require, no TypeScript). A top-level \`return\` gives the workflow result.

Script API (all available as globals):
- \`agent(prompt, { label?, phase?, schema?, model?, subagent_type?, allowedTools?, maxTurns? })\` → runs one subagent to completion and resolves to its final text. With \`schema\` (a JSON Schema object) the agent is told to answer with JSON only and the parsed object is returned.
- \`parallel(thunks, { concurrency? })\` → runs an array of \`() => Promise\` with bounded concurrency (default 4); resolves to an array of results, \`null\` for items that failed (the error is logged).
- \`pipeline(items, stage1, stage2, ...)\` → for each item runs stage1(item), then stage2(result1), ... as soon as the previous stage finishes, across items in parallel; resolves to the array of final results (\`null\` for failures).
- \`phase(title, fn?)\` → marks the current phase (shown in the task panel); if \`fn\` is given, awaits it.
- \`log(...)\` and \`console.log(...)\` → write to the run's output file.
- \`sleep(ms)\`, \`args\` (the tool's \`args\` input, verbatim), plus JSON, Math, Date, Promise and the standard globals.

The canonical multi-stage pattern — pipeline by default, each dimension verifies as soon as its review completes:

  export const meta = {
    name: 'review-changes',
    description: 'Review changed files across dimensions, verify each finding',
    phases: [{ title: 'Review' }, { title: 'Verify' }],
  }
  const DIMENSIONS = [{ key: 'bugs', prompt: '...' }, { key: 'perf', prompt: '...' }]
  const results = await pipeline(
    DIMENSIONS,
    d => agent(d.prompt, { label: \`review:\${d.key}\`, phase: 'Review', schema: FINDINGS_SCHEMA }),
    review => parallel(review.findings.map(f => () =>
      agent(\`Adversarially verify: \${f.title}\`, { label: \`verify:\${f.file}\`, phase: 'Verify', schema: VERDICT_SCHEMA })
        .then(v => ({ ...f, verdict: v }))
    ))
  )
  const confirmed = results.flat().filter(Boolean).filter(f => f.verdict?.isReal)
  return { confirmed }

Limits: at most ${DEFAULT_MAX_AGENTS} agent() calls per run unless \`max_agents\` raises it. Keep workflows small on a local model: every agent is a full subagent conversation.

Inputs: \`script\` (inline), or \`scriptPath\` (a .js file on disk), or \`name\` (a bundled or saved workflow); optional \`args\` (any JSON, exposed as \`args\`), \`max_agents\`, and \`run_in_background\` (default true; false waits and returns the result inline).`
