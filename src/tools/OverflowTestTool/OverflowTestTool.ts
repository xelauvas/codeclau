import { z } from 'zod/v4'
import { buildTool } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'

export const OVERFLOW_TEST_TOOL_NAME = 'OverflowTest'

const MAX_KB = 4096

const inputSchema = lazySchema(() =>
  z.strictObject({
    size_kb: z.number().int().positive().max(MAX_KB).default(256).describe('How many kilobytes of text to return'),
    marker: z.string().max(40).default('OVERFLOW').describe('Token repeated in the output, to check what survives truncation or compaction'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() => z.object({ text: z.string(), bytes: z.number() }))
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

/**
 * Developer tool: returns a large, numbered payload so context-overflow
 * handling (truncation, microcompact, reactive compact) can be exercised
 * without a real workload. Gated behind OVERFLOW_TEST_TOOL.
 */
export const OverflowTestTool = buildTool({
  name: OVERFLOW_TEST_TOOL_NAME,
  searchHint: 'generate a large tool result for overflow testing',
  maxResultSizeChars: MAX_KB * 1024 + 100,
  userFacingName: () => 'Overflow test',
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
    return true
  },
  async checkPermissions(input) {
    return { behavior: 'allow', updatedInput: input }
  },
  async description({ size_kb }) {
    return `Generate ${size_kb} KB of test output`
  },
  async prompt() {
    return 'Testing tool: returns the requested number of kilobytes of numbered filler lines. Only use it when explicitly asked to test context overflow behaviour.'
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return { tool_use_id: toolUseID, type: 'tool_result', content: output.text }
  },
  renderToolUseMessage(input: { size_kb?: number }) {
    return `${input.size_kb ?? 256} KB`
  },
  renderToolResultMessage(output: Output) {
    return `${Math.round(output.bytes / 1024)} KB generated`
  },
  async call({ size_kb, marker }) {
    const target = size_kb * 1024
    const lines: string[] = []
    let bytes = 0
    for (let i = 1; bytes < target; i++) {
      const line = `${marker} line ${i.toString().padStart(7, '0')} ${'x'.repeat(48)}\n`
      lines.push(line)
      bytes += line.length
    }
    const text = lines.join('')
    return { data: { text, bytes: text.length } }
  },
})
