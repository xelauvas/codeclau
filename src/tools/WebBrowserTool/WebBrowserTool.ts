import { execFile } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { z } from 'zod/v4'
import { buildTool } from '../../Tool.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { DESCRIPTION, WEB_BROWSER_TOOL_NAME } from './prompt.js'

const ACTIONS = [
  'goto', 'text', 'links', 'title', 'url', 'snapshot', 'click', 'fill', 'select',
  'press', 'hover', 'js', 'screenshot', 'console', 'network', 'back', 'forward',
  'reload', 'wait', 'raw',
] as const
type Action = (typeof ACTIONS)[number]

const READ_ONLY: ReadonlySet<Action> = new Set<Action>([
  'text', 'links', 'title', 'url', 'snapshot', 'screenshot', 'console', 'network',
])

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z.enum(ACTIONS).describe('What to do; see the tool description'),
    url: z.string().optional().describe('For goto'),
    selector: z.string().optional().describe('CSS selector or @e ref (click, fill, select, hover, wait)'),
    value: z.string().optional().describe('Text for fill/select, key name for press'),
    script: z.string().optional().describe('JavaScript expression for js'),
    path: z.string().optional().describe('Output file for screenshot'),
    args: z.array(z.string()).optional().describe('For raw: the browse subcommand and its arguments'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
export type WebBrowserInput = z.infer<InputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    action: z.string(),
    ok: z.boolean(),
    output: z.string(),
    screenshotPath: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

const MAX_OUTPUT_CHARS = 60_000

export function findBrowseBinary(): string | null {
  const candidates = [
    process.env.XELA_BROWSE_BIN,
    join(homedir(), '.claude', 'skills', 'gstack', 'browse', 'dist', 'browse'),
    join(getClaudeConfigHomeDir(), 'skills', 'gstack', 'browse', 'dist', 'browse'),
    join(process.cwd(), '.claude', 'skills', 'gstack', 'browse', 'dist', 'browse'),
  ].filter((p): p is string => !!p)
  return candidates.find(p => existsSync(p)) ?? null
}

function runBrowse(bin: string, args: string[], signal: AbortSignal): Promise<{ ok: boolean; output: string }> {
  return new Promise(resolve => {
    execFile(
      bin,
      args,
      { encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024, timeout: 120_000, signal },
      (error, stdout, stderr) => {
        let output = `${stdout ?? ''}${stderr ? `\n${stderr}` : ''}`.trim()
        if (output.length > MAX_OUTPUT_CHARS) {
          output = output.slice(0, MAX_OUTPUT_CHARS) + `\n… (truncated, ${output.length} chars total)`
        }
        resolve({ ok: !error, output: output || (error ? String(error.message) : '') })
      },
    )
  })
}

function buildArgs(input: WebBrowserInput, screenshotPath: string): string[] {
  switch (input.action) {
    case 'goto': return ['goto', input.url ?? '']
    case 'text': return ['text']
    case 'links': return ['links']
    case 'title': return ['js', 'document.title']
    case 'url': return ['url']
    case 'snapshot': return ['snapshot', '-i', '-c']
    case 'click': return ['click', input.selector ?? '']
    case 'fill': return ['fill', input.selector ?? '', input.value ?? '']
    case 'select': return ['select', input.selector ?? '', input.value ?? '']
    case 'press': return ['press', input.value ?? 'Enter']
    case 'hover': return ['hover', input.selector ?? '']
    case 'js': return ['js', input.script ?? '']
    case 'screenshot': return ['screenshot', screenshotPath]
    case 'console': return ['console']
    case 'network': return ['network']
    case 'back': return ['back']
    case 'forward': return ['forward']
    case 'reload': return ['reload']
    case 'wait': return ['wait', input.selector ?? '--load']
    case 'raw': return input.args ?? []
  }
}

export const WebBrowserTool = buildTool({
  name: WEB_BROWSER_TOOL_NAME,
  searchHint: 'headless browser: open pages, click, fill forms, screenshots, console',
  maxResultSizeChars: 100_000,
  userFacingName: () => 'WebBrowser',
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    // one shared browser daemon; interactions must not interleave
    return false
  },
  isReadOnly(input) {
    return !!input && READ_ONLY.has(input.action)
  },
  toAutoClassifierInput(input) {
    return `${input.action} ${input.url ?? input.selector ?? input.script ?? (input.args ?? []).join(' ')}`.trim()
  },
  async validateInput(input) {
    if (!findBrowseBinary()) {
      return {
        result: false,
        message:
          'No headless browser available: install gstack (~/.claude/skills/gstack) and run its browse setup, or set XELA_BROWSE_BIN.',
        errorCode: 2,
      }
    }
    const need = (field: keyof WebBrowserInput, forActions: Action[]): string | null =>
      forActions.includes(input.action) && !input[field] ? `${input.action} needs ${String(field)}` : null
    const problem =
      need('url', ['goto']) ??
      need('selector', ['click', 'fill', 'select', 'hover']) ??
      need('value', ['fill', 'select']) ??
      need('script', ['js']) ??
      (input.action === 'raw' && !(input.args && input.args.length) ? 'raw needs args' : null)
    if (problem) return { result: false, message: problem, errorCode: 1 }
    if (input.action === 'goto' && !/^(https?|file):\/\//.test(input.url!)) {
      return { result: false, message: 'url must start with http://, https:// or file://', errorCode: 1 }
    }
    return { result: true }
  },
  async checkPermissions(input) {
    if (READ_ONLY.has(input.action)) return { behavior: 'allow', updatedInput: input }
    return {
      behavior: 'ask',
      message: `Browser ${input.action}: ${input.url ?? input.selector ?? input.script ?? (input.args ?? []).join(' ')}`,
    }
  },
  async description(input) {
    return `Browser ${input.action}${input.url ? ` ${input.url}` : ''}`
  },
  async prompt() {
    return DESCRIPTION
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const text = output.screenshotPath
      ? `Screenshot saved to ${output.screenshotPath}. Use Read on it to view it.`
      : output.output || (output.ok ? '(no output)' : 'browser command failed')
    return { tool_use_id: toolUseID, type: 'tool_result', content: text, is_error: !output.ok }
  },
  renderToolUseMessage(input: Partial<WebBrowserInput>) {
    return `${input.action ?? ''} ${input.url ?? input.selector ?? input.script ?? ''}`.trim()
  },
  renderToolResultMessage(output: Output) {
    if (output.screenshotPath) return `screenshot → ${output.screenshotPath}`
    const first = output.output.split('\n')[0] ?? ''
    return output.ok ? first.slice(0, 120) : `error: ${first.slice(0, 120)}`
  },
  async call(input, { abortController }) {
    const bin = findBrowseBinary()!
    const dir = join(getClaudeConfigHomeDir(), 'browser-screenshots')
    let screenshotPath = ''
    if (input.action === 'screenshot') {
      mkdirSync(dir, { recursive: true })
      screenshotPath = input.path ?? join(dir, `shot-${Date.now()}.png`)
    }
    const { ok, output } = await runBrowse(bin, buildArgs(input, screenshotPath), abortController.signal)
    return {
      data: {
        action: input.action,
        ok,
        output,
        ...(ok && screenshotPath ? { screenshotPath } : {}),
      },
    }
  },
})
