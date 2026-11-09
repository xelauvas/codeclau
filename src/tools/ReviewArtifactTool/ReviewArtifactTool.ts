import { mkdirSync, writeFileSync } from 'fs'
import { dirname, isAbsolute, join, relative, resolve } from 'path'
import { z } from 'zod/v4'
import { buildTool } from '../../Tool.js'
import { getCwd } from '../../utils/cwd.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { REVIEW_ARTIFACT_PROMPT, REVIEW_ARTIFACT_TOOL_NAME } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    title: z.string().min(1).max(200).describe('Report title'),
    content: z.string().min(1).describe('Full Markdown body of the report'),
    path: z.string().optional().describe('Where to write it; default .claude/reviews/<date>-<slug>.md'),
    findings: z.number().int().nonnegative().optional().describe('Number of confirmed findings (for the summary line)'),
    severity: z.enum(['none', 'low', 'medium', 'high', 'blocker']).optional().describe('Highest severity found'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({ path: z.string(), bytes: z.number(), message: z.string() }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'review'
}

export function defaultArtifactPath(title: string): string {
  const date = new Date().toISOString().slice(0, 10)
  return join('.claude', 'reviews', `${date}-${slugify(title)}.md`)
}

export function resolveArtifactPath(input: { title: string; path?: string }): string {
  const p = input.path?.trim() || defaultArtifactPath(input.title)
  return isAbsolute(p) ? p : resolve(getCwd(), p)
}

export const ReviewArtifactTool = buildTool({
  name: REVIEW_ARTIFACT_TOOL_NAME,
  searchHint: 'publish a code review report as a Markdown artifact',
  maxResultSizeChars: 2000,
  userFacingName: () => 'Review artifact',
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return false
  },
  async checkPermissions(input) {
    // Always confirmed by the user through ReviewArtifactPermissionRequest.
    return {
      behavior: 'ask',
      message: `Publish review artifact "${input.title}" to ${relative(getCwd(), resolveArtifactPath(input))}`,
    }
  },
  async description({ title }) {
    return `Publish review: ${title}`
  },
  async prompt() {
    return REVIEW_ARTIFACT_PROMPT
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return { tool_use_id: toolUseID, type: 'tool_result', content: output.message }
  },
  renderToolUseMessage(input: { title?: string; path?: string }) {
    return input.title ?? input.path ?? ''
  },
  renderToolResultMessage(output: Output) {
    return `written to ${output.path}`
  },
  async call(input) {
    const target = resolveArtifactPath(input)
    mkdirSync(dirname(target), { recursive: true })
    const header = `# ${input.title}\n\n_Generated ${new Date().toISOString()}${input.findings !== undefined ? ` · ${input.findings} finding${input.findings === 1 ? '' : 's'}` : ''}${input.severity && input.severity !== 'none' ? ` · highest severity: ${input.severity}` : ''}_\n\n`
    const body = input.content.startsWith('# ') ? input.content : header + input.content
    writeFileSync(target, body.endsWith('\n') ? body : body + '\n')
    const rel = relative(getCwd(), target)
    const message = `Review artifact written to ${rel}${input.findings !== undefined ? ` (${input.findings} finding${input.findings === 1 ? '' : 's'})` : ''}. Tell the user the path and summarize the findings.`
    return { data: { path: rel, bytes: body.length, message } }
  },
})
