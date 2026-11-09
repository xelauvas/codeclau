/**
 * Bundled (built-in) workflows, addressable by name through the Workflow
 * tool's `name` input. The registry lives on globalThis so the tool and the
 * slash-command loader see the same entries regardless of how each module
 * was loaded.
 */
export type BundledWorkflow = {
  name: string
  description: string
  script: string
}

type Registry = Map<string, BundledWorkflow>
const registry: Registry = ((
  globalThis as unknown as { __xelaBundledWorkflows?: Registry }
).__xelaBundledWorkflows ??= new Map())

export function registerBundledWorkflow(workflow: BundledWorkflow): void {
  registry.set(workflow.name, workflow)
}

export function getBundledWorkflow(name: string): BundledWorkflow | undefined {
  return registry.get(name)
}

export function listBundledWorkflows(): BundledWorkflow[] {
  return [...registry.values()]
}

const REVIEW_CHANGES = `export const meta = {
  name: 'review-changes',
  description: 'Review the current diff across dimensions in parallel, then verify each finding adversarially',
  phases: [{ title: 'Review' }, { title: 'Verify' }],
}
const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'number' },
          severity: { type: 'string', enum: ['low', 'medium', 'high'] },
          detail: { type: 'string' },
        },
        required: ['title', 'file', 'detail'],
      },
    },
  },
  required: ['findings'],
}
const VERDICT_SCHEMA = {
  type: 'object',
  properties: { isReal: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['isReal', 'reason'],
}
const target = args && args.target ? String(args.target) : 'the uncommitted changes (git diff) in the current repository'
const DIMENSIONS = [
  { key: 'bugs', prompt: 'Review ' + target + ' for correctness bugs: wrong logic, unhandled errors, race conditions, off-by-one, null handling. Read the diff and the surrounding code. Report only real defects.' },
  { key: 'security', prompt: 'Review ' + target + ' for security problems: injection, auth/permission gaps, secrets, unsafe deserialization, path traversal. Read the diff and the surrounding code. Report only real defects.' },
  { key: 'tests', prompt: 'Review ' + target + ' for missing or weak test coverage of the changed behavior. Report concrete gaps with the file they belong to.' },
]
const results = await pipeline(
  DIMENSIONS,
  d => agent(d.prompt, { label: 'review:' + d.key, phase: 'Review', schema: FINDINGS_SCHEMA }),
  review => parallel((review.findings || []).slice(0, 4).map(f => () =>
    agent('Adversarially verify this code review finding by reading the code. Finding: ' + JSON.stringify(f) + '. Decide whether it is a real problem a maintainer must fix.', { label: 'verify:' + f.file, phase: 'Verify', schema: VERDICT_SCHEMA })
      .then(v => ({ ...f, verdict: v }))
  ))
)
const confirmed = results.flat().filter(Boolean).filter(f => f.verdict && f.verdict.isReal)
return { confirmed, reviewed: DIMENSIONS.map(d => d.key) }
`

let initialized = false
export function initBundledWorkflows(): void {
  if (initialized) return
  initialized = true
  registerBundledWorkflow({
    name: 'review-changes',
    description:
      'Review the current diff across dimensions in parallel, then verify each finding adversarially',
    script: REVIEW_CHANGES,
  })
}
