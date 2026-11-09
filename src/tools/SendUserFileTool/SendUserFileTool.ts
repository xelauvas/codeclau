import { copyFileSync, existsSync, mkdirSync, statSync } from 'fs'
import { basename, isAbsolute, join, resolve } from 'path'
import { z } from 'zod/v4'
import { buildTool } from '../../Tool.js'
import { getCwd } from '../../utils/cwd.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { DESCRIPTION, SEND_USER_FILE_PROMPT, SEND_USER_FILE_TOOL_NAME } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    file_path: z.string().describe('Path of the file to deliver (absolute, or relative to the working directory)'),
    description: z.string().optional().describe('What the file is, in a few words (shown to the user)'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    deliveredPath: z.string(),
    sizeBytes: z.number(),
    message: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

export function getOutboxDir(): string {
  return process.env.CLAUDE_CODE_OUTBOX_DIR || join(getClaudeConfigHomeDir(), 'outbox')
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export const SendUserFileTool = buildTool({
  name: SEND_USER_FILE_TOOL_NAME,
  searchHint: 'deliver a produced file to the user',
  maxResultSizeChars: 2000,
  userFacingName: () => 'Send file',
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return false
  },
  async checkPermissions(input) {
    return { behavior: 'allow', updatedInput: input }
  },
  async description({ file_path }) {
    return `${DESCRIPTION}: ${basename(file_path)}`
  },
  async prompt() {
    return SEND_USER_FILE_PROMPT
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return { tool_use_id: toolUseID, type: 'tool_result', content: output.message }
  },
  renderToolUseMessage(input: { file_path?: string; description?: string }) {
    return `${input.file_path ?? ''}${input.description ? ` · ${input.description}` : ''}`
  },
  renderToolResultMessage(output: Output) {
    return `delivered to ${output.deliveredPath} (${formatSize(output.sizeBytes)})`
  },
  async call({ file_path, description }) {
    const source = isAbsolute(file_path) ? file_path : resolve(getCwd(), file_path)
    if (!existsSync(source) || !statSync(source).isFile()) {
      throw new Error(`File not found: ${source}`)
    }
    const dir = getOutboxDir()
    mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const target = join(dir, `${stamp}-${basename(source)}`)
    copyFileSync(source, target)
    const sizeBytes = statSync(target).size
    const message = `File delivered to the user: ${target} (${formatSize(sizeBytes)})${description ? ` — ${description}` : ''}. The original stays at ${source}.`
    return { data: { deliveredPath: target, sizeBytes, message } }
  },
})
