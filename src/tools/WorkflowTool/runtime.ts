import vm from 'node:vm'
import { DEFAULT_CONCURRENCY } from './constants.js'

export type WorkflowMeta = {
  name: string
  description: string
  phases?: Array<{ title: string; detail?: string }>
}

export type WorkflowAgentOptions = {
  label?: string
  phase?: string
  schema?: unknown
  model?: string
  subagent_type?: string
  allowedTools?: string[]
  maxTurns?: number
}

export type WorkflowHost = {
  /** Run one subagent to completion and return its final text. */
  runAgent: (
    prompt: string,
    options: WorkflowAgentOptions,
    agentIndex: number,
  ) => Promise<string>
  onPhase?: (title: string) => void
  onLog?: (line: string) => void
  signal: AbortSignal
  maxAgents: number
}

export class WorkflowScriptError extends Error {}

const FORBIDDEN = [
  { re: /^\s*import\s/m, what: 'import statements' },
  { re: /\brequire\s*\(/, what: 'require()' },
  { re: /\bprocess\s*\./, what: 'process' },
  { re: /\beval\s*\(/, what: 'eval()' },
  { re: /\bFunction\s*\(/, what: 'Function()' },
]

/**
 * Splits the script into its `export const meta = {...}` literal and the body.
 * The literal is evaluated in an empty context; anything that is not a plain
 * object literal fails there, which is the "pure literal" rule.
 */
export function parseWorkflowScript(script: string): {
  meta: WorkflowMeta
  body: string
} {
  for (const { re, what } of FORBIDDEN) {
    if (re.test(script)) {
      throw new WorkflowScriptError(`Workflow scripts cannot use ${what}`)
    }
  }
  const match = /export\s+const\s+meta\s*=\s*/.exec(script)
  if (!match) {
    throw new WorkflowScriptError(
      'Workflow script must begin with `export const meta = {...}`',
    )
  }
  const start = match.index + match[0].length
  const end = findBalancedEnd(script, start)
  if (end < 0) {
    throw new WorkflowScriptError('Unterminated meta object literal')
  }
  const literal = script.slice(start, end + 1)
  let meta: unknown
  try {
    meta = vm.runInNewContext(`(${literal})`, Object.create(null), {
      timeout: 1000,
    })
  } catch (e) {
    throw new WorkflowScriptError(
      `meta must be a pure object literal: ${(e as Error).message}`,
    )
  }
  if (
    !meta ||
    typeof meta !== 'object' ||
    typeof (meta as WorkflowMeta).name !== 'string' ||
    typeof (meta as WorkflowMeta).description !== 'string'
  ) {
    throw new WorkflowScriptError(
      'meta needs string `name` and `description` fields',
    )
  }
  const body = script.slice(0, match.index) + script.slice(end + 1)
  return {
    meta: JSON.parse(JSON.stringify(meta)) as WorkflowMeta,
    body: body.replace(/^\s*;/, ''),
  }
}

function findBalancedEnd(text: string, openIndex: number): number {
  if (text[openIndex] !== '{') return -1
  let depth = 0
  let quote: string | null = null
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i]!
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** Pulls the first JSON object/array out of a model answer (tolerates prose and code fences). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  const candidates = [fenced?.[1], text].filter(
    (s): s is string => typeof s === 'string',
  )
  for (const candidate of candidates) {
    const trimmed = candidate.trim()
    try {
      return JSON.parse(trimmed)
    } catch {
      // fall through to a bracket scan
    }
    for (const open of ['{', '[']) {
      const close = open === '{' ? '}' : ']'
      const first = trimmed.indexOf(open)
      const last = trimmed.lastIndexOf(close)
      if (first >= 0 && last > first) {
        try {
          return JSON.parse(trimmed.slice(first, last + 1))
        } catch {
          // try the other bracket
        }
      }
    }
  }
  throw new WorkflowScriptError(
    `Agent did not return JSON: ${text.slice(0, 200)}`,
  )
}

async function runWithConcurrency<T>(
  thunks: Array<() => Promise<T>>,
  concurrency: number,
  signal: AbortSignal,
  onError: (index: number, err: unknown) => void,
): Promise<Array<T | null>> {
  const results: Array<T | null> = new Array(thunks.length).fill(null)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < thunks.length) {
      if (signal.aborted) return
      const index = next++
      try {
        results[index] = await thunks[index]!()
      } catch (err) {
        onError(index, err)
        results[index] = null
      }
    }
  }
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, thunks.length)) },
    () => worker(),
  )
  await Promise.all(workers)
  return results
}

/**
 * Runs the workflow body inside a vm context with the script API as globals.
 * Resolves to whatever the script returns.
 */
export async function runWorkflowScript(
  body: string,
  args: unknown,
  host: WorkflowHost,
): Promise<unknown> {
  let agentCount = 0
  const log = (...parts: unknown[]): void => {
    host.onLog?.(
      parts
        .map(p => (typeof p === 'string' ? p : safeStringify(p)))
        .join(' '),
    )
  }

  const agent = async (
    prompt: unknown,
    options: WorkflowAgentOptions = {},
  ): Promise<unknown> => {
    if (typeof prompt !== 'string' || prompt.trim() === '') {
      throw new WorkflowScriptError('agent(prompt) needs a non-empty string')
    }
    if (host.signal.aborted) throw new WorkflowScriptError('Workflow aborted')
    if (agentCount >= host.maxAgents) {
      throw new WorkflowScriptError(
        `Workflow exceeded max_agents (${host.maxAgents}); raise max_agents or launch fewer agents`,
      )
    }
    const index = agentCount++
    if (options.phase) host.onPhase?.(options.phase)
    let fullPrompt = prompt
    if (options.schema) {
      fullPrompt +=
        `\n\nRespond with ONLY a JSON value matching this JSON Schema, no prose, no markdown fences:\n` +
        safeStringify(options.schema)
    }
    const text = await host.runAgent(fullPrompt, options, index)
    return options.schema ? extractJson(text) : text
  }

  const parallel = async (
    items: unknown,
    options: { concurrency?: number } = {},
  ): Promise<unknown[]> => {
    if (!Array.isArray(items)) {
      throw new WorkflowScriptError('parallel() expects an array of () => Promise')
    }
    const thunks = items.map((item, i) => {
      if (typeof item === 'function') return item as () => Promise<unknown>
      if (item && typeof (item as Promise<unknown>).then === 'function') {
        return () => item as Promise<unknown>
      }
      throw new WorkflowScriptError(
        `parallel(): item ${i} is neither a function nor a promise`,
      )
    })
    return runWithConcurrency(
      thunks,
      options.concurrency ?? DEFAULT_CONCURRENCY,
      host.signal,
      (i, err) => log(`parallel[${i}] failed: ${errorText(err)}`),
    )
  }

  const pipeline = async (
    items: unknown,
    ...stages: unknown[]
  ): Promise<unknown[]> => {
    if (!Array.isArray(items)) {
      throw new WorkflowScriptError('pipeline() expects an array as first argument')
    }
    if (stages.length === 0 || stages.some(s => typeof s !== 'function')) {
      throw new WorkflowScriptError('pipeline() needs one or more stage functions')
    }
    const fns = stages as Array<(input: unknown) => Promise<unknown>>
    const thunks = items.map(item => async () => {
      let value: unknown = item
      for (const stage of fns) {
        value = await stage(value)
      }
      return value
    })
    return runWithConcurrency(thunks, DEFAULT_CONCURRENCY, host.signal, (i, err) =>
      log(`pipeline[${i}] failed: ${errorText(err)}`),
    )
  }

  const phase = async (title: unknown, fn?: unknown): Promise<unknown> => {
    if (typeof title === 'string') host.onPhase?.(title)
    if (typeof fn === 'function') return (fn as () => Promise<unknown>)()
    return undefined
  }

  const sleep = (ms: unknown): Promise<void> =>
    new Promise(resolve => {
      const t = setTimeout(resolve, Math.max(0, Number(ms) || 0))
      t.unref()
    })

  const sandbox: Record<string, unknown> = {
    agent,
    parallel,
    pipeline,
    phase,
    sleep,
    log,
    console: { log, info: log, warn: log, error: log },
    args: args === undefined ? undefined : JSON.parse(JSON.stringify(args)),
    JSON,
    Math,
    Date,
    Promise,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    Set,
    Map,
    setTimeout,
    clearTimeout,
    structuredClone,
  }
  const context = vm.createContext(sandbox, { name: 'workflow' })
  const wrapped = `(async () => {\n${body}\n})()`
  const script = new vm.Script(wrapped, { filename: 'workflow.js' })
  const resultPromise = script.runInContext(context) as Promise<unknown>
  return await Promise.race([
    resultPromise,
    new Promise<never>((_, reject) => {
      if (host.signal.aborted) reject(new WorkflowScriptError('Workflow aborted'))
      host.signal.addEventListener(
        'abort',
        () => reject(new WorkflowScriptError('Workflow aborted')),
        { once: true },
      )
    }),
  ])
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}
