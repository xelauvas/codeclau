import { readFileSync } from 'fs'
import { isAbsolute, resolve } from 'path'
import { z } from 'zod/v4'
import {
  addWorkflowAgent,
  finishWorkflow,
  isLocalWorkflowTask,
  type LocalWorkflowTaskState,
  registerWorkflowTask,
  setWorkflowPhase,
  updateWorkflowAgent,
  type WorkflowAgentController,
} from '../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'
import { buildTool } from '../../Tool.js'
import type { AgentId } from '../../types/ids.js'
import { getCwd } from '../../utils/cwd.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { extractTextContent } from '../../utils/messages.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { appendTaskOutput, getTaskOutputPath } from '../../utils/task/diskOutput.js'
import { AgentTool } from '../AgentTool/AgentTool.js'
import { getBundledWorkflow, initBundledWorkflows } from './bundled/index.js'
import {
  DEFAULT_MAX_AGENTS,
  HARD_MAX_AGENTS,
  WORKFLOW_TOOL_NAME,
} from './constants.js'
import { DESCRIPTION } from './prompt.js'
import {
  errorText,
  parseWorkflowScript,
  runWorkflowScript,
  safeStringify,
  type WorkflowAgentOptions,
  WorkflowScriptError,
} from './runtime.js'
import { renderToolResultMessage, renderToolUseMessage } from './UI.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    script: z
      .string()
      .optional()
      .describe('Self-contained workflow script (plain JavaScript) starting with `export const meta = {...}`.'),
    scriptPath: z
      .string()
      .optional()
      .describe('Path to a workflow script file on disk. Takes precedence over script and name.'),
    name: z
      .string()
      .optional()
      .describe('Name of a bundled or saved workflow (see /workflows).'),
    args: z
      .unknown()
      .optional()
      .describe('Input exposed to the script as the global `args`, verbatim.'),
    max_agents: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(`Cap on agent() calls for this run (default ${DEFAULT_MAX_AGENTS}, at most ${HARD_MAX_AGENTS}).`),
    run_in_background: z
      .boolean()
      .optional()
      .describe('Default true: return a task ID now and get a notification when done. false waits and returns the result inline.'),
    resumeFromRunId: z
      .string()
      .optional()
      .describe('Not supported in this build; present for compatibility.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
export type WorkflowInput = z.infer<InputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    runId: z.string(),
    taskId: z.string(),
    name: z.string(),
    description: z.string(),
    status: z.enum(['running', 'completed', 'failed']),
    outputFile: z.string(),
    agentsLaunched: z.number(),
    result: z.unknown().optional(),
    error: z.string().optional(),
    message: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

function loadScript(input: WorkflowInput): { script: string; origin: string } {
  initBundledWorkflows()
  if (input.scriptPath) {
    const path = isAbsolute(input.scriptPath)
      ? input.scriptPath
      : resolve(getCwd(), input.scriptPath)
    return { script: readFileSync(path, 'utf8'), origin: path }
  }
  if (input.script) return { script: input.script, origin: 'inline' }
  if (input.name) {
    const bundled = getBundledWorkflow(input.name)
    if (bundled) return { script: bundled.script, origin: `bundled:${input.name}` }
    throw new Error(`Unknown workflow "${input.name}". See /workflows for the available names.`)
  }
  throw new Error('Provide script, scriptPath or name')
}

export const WorkflowTool = buildTool({
  name: WORKFLOW_TOOL_NAME,
  searchHint: 'orchestrate several subagents with a deterministic script',
  maxResultSizeChars: 200_000,
  userFacingName: () => 'Workflow',
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return false
  },
  toAutoClassifierInput(input) {
    const src = input.script ?? input.scriptPath ?? input.name ?? ''
    return src.length > 4000 ? src.slice(0, 4000) + '…' : src
  },
  async validateInput(input) {
    if (input.resumeFromRunId) {
      return {
        result: false,
        message: 'resumeFromRunId is not supported in this build; run the workflow again',
        errorCode: 1,
      }
    }
    try {
      const { script } = loadScript(input)
      parseWorkflowScript(script)
    } catch (e) {
      return { result: false, message: errorText(e), errorCode: 1 }
    }
    if (input.max_agents && input.max_agents > HARD_MAX_AGENTS) {
      return {
        result: false,
        message: `max_agents cannot exceed ${HARD_MAX_AGENTS}`,
        errorCode: 1,
      }
    }
    return { result: true }
  },
  async checkPermissions(input) {
    let summary = 'a workflow'
    try {
      const { meta } = parseWorkflowScript(loadScript(input).script)
      summary = `"${meta.name}": ${meta.description}`
    } catch {
      // validateInput reports parse errors
    }
    return {
      behavior: 'ask',
      message: `Run workflow ${summary} (up to ${input.max_agents ?? DEFAULT_MAX_AGENTS} subagents; each subagent asks for its own tool permissions)`,
    }
  },
  async description(input) {
    try {
      return parseWorkflowScript(loadScript(input).script).meta.description
    } catch {
      return 'Run a workflow script'
    }
  },
  async prompt() {
    return DESCRIPTION
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: jsonStringify(output),
    }
  },
  renderToolUseMessage,
  renderToolResultMessage,
  async call(input, context, canUseTool, parentMessage) {
    const { getAppState, setAppState } = context
    const rootSetAppState =
      (context as { setAppStateForTasks?: typeof setAppState }).setAppStateForTasks ??
      setAppState
    const toolUseId = (context as { toolUseId?: string }).toolUseId
    const parentAgentId = (context as { agentId?: AgentId }).agentId
    const { script } = loadScript(input)
    const { meta, body } = parseWorkflowScript(script)
    const maxAgents = Math.min(input.max_agents ?? DEFAULT_MAX_AGENTS, HARD_MAX_AGENTS)
    const background = input.run_in_background !== false

    const task = await registerWorkflowTask(
      {
        name: meta.name,
        description: meta.description,
        args: input.args,
        phases: meta.phases ?? [],
        toolUseId,
        agentId: parentAgentId,
        isBackgrounded: background,
      },
      rootSetAppState,
    )
    const taskId = task.id
    const log = (line: string): void => appendTaskOutput(taskId, line + '\n')

    const runAgent = async (
      prompt: string,
      options: WorkflowAgentOptions,
      index: number,
    ): Promise<string> => {
      const agentRecordId = `${taskId}-a${index}`
      const label = options.label ?? `agent ${index + 1}`
      const controller: WorkflowAgentController = {
        abortController: new AbortController(),
        retry: false,
      }
      addWorkflowAgent(
        taskId,
        {
          id: agentRecordId,
          index,
          label,
          phase: options.phase,
          status: 'running',
          startTime: Date.now(),
        },
        controller,
        rootSetAppState,
      )
      log(`[agent ${label}] start`)

      // One attempt; the task panel's "retry" aborts the attempt with
      // controller.retry set, which loops here for a fresh one.
      for (;;) {
        controller.abortController = new AbortController()
        controller.retry = false
        const attemptController = controller.abortController
        const onParentAbort = (): void => attemptController.abort()
        task.abortController.signal.addEventListener('abort', onParentAbort, { once: true })
        try {
          const text = await runSubagent(prompt, options, attemptController)
          updateWorkflowAgent(
            taskId,
            agentRecordId,
            { status: 'completed', endTime: Date.now(), resultPreview: text.slice(0, 200) },
            rootSetAppState,
          )
          log(`[agent ${label}] done (${text.length} chars)`)
          return text
        } catch (err) {
          if (attemptController.signal.aborted && controller.retry) {
            log(`[agent ${label}] retrying`)
            continue
          }
          const skipped = attemptController.signal.aborted && !task.abortController.signal.aborted
          updateWorkflowAgent(
            taskId,
            agentRecordId,
            {
              status: skipped ? 'skipped' : 'failed',
              endTime: Date.now(),
              error: skipped ? 'skipped' : errorText(err),
            },
            rootSetAppState,
          )
          log(`[agent ${label}] ${skipped ? 'skipped' : `failed: ${errorText(err)}`}`)
          throw skipped ? new WorkflowScriptError(`agent "${label}" skipped`) : err
        } finally {
          task.abortController.signal.removeEventListener('abort', onParentAbort)
        }
      }
    }

    const runSubagent = async (
      prompt: string,
      options: WorkflowAgentOptions,
      abortController: AbortController,
    ): Promise<string> => {
      const subContext = { ...context, abortController }
      const result = await AgentTool.call(
        {
          prompt,
          description: (options.label ?? 'workflow agent').slice(0, 60),
          subagent_type: options.subagent_type ?? 'general-purpose',
          run_in_background: false,
          model: options.model,
        } as Parameters<typeof AgentTool.call>[0],
        subContext as Parameters<typeof AgentTool.call>[1],
        canUseTool,
        parentMessage,
      )
      const data = result.data as {
        status?: string
        agentId?: string
        content?: Array<{ type: string; text?: string }>
      }
      if (data.status === 'async_launched' && data.agentId) {
        return waitForAgentTask(data.agentId, abortController.signal)
      }
      return extractTextContent(
        (data.content ?? []) as Parameters<typeof extractTextContent>[0],
        '\n',
      )
    }

    // When the host forces subagents into the background, wait for the task
    // to finish and read its final result from the task state
    const waitForAgentTask = async (
      agentId: string,
      signal: AbortSignal,
    ): Promise<string> => {
      for (;;) {
        if (signal.aborted) throw new WorkflowScriptError('agent aborted')
        const t = getAppState().tasks?.[agentId] as
          | { status?: string; result?: { content?: Array<{ type: string; text?: string }> }; error?: string }
          | undefined
        if (!t) throw new WorkflowScriptError(`agent task ${agentId} disappeared`)
        if (t.status === 'completed') {
          return extractTextContent(
            (t.result?.content ?? []) as Parameters<typeof extractTextContent>[0],
            '\n',
          )
        }
        if (t.status === 'failed' || t.status === 'killed') {
          throw new WorkflowScriptError(`agent ${t.status}${t.error ? `: ${t.error}` : ''}`)
        }
        await new Promise(r => setTimeout(r, 500))
      }
    }

    const execution = (async (): Promise<{ result?: unknown; error?: string }> => {
      try {
        const result = await runWorkflowScript(body, input.args, {
          runAgent,
          onPhase: title => {
            setWorkflowPhase(taskId, title, rootSetAppState)
            log(`[phase] ${title}`)
          },
          onLog: line => log(`[log] ${line}`),
          signal: task.abortController.signal,
          maxAgents,
        })
        log(`[workflow] result:\n${safeStringify(result)}`)
        finishWorkflow(taskId, 'completed', result, undefined, rootSetAppState)
        return { result }
      } catch (err) {
        const message = errorText(err)
        log(`[workflow] failed: ${message}`)
        const current = getAppState().tasks?.[taskId]
        if (isLocalWorkflowTask(current) && current.status === 'killed') {
          return { error: 'stopped' }
        }
        finishWorkflow(taskId, 'failed', undefined, message, rootSetAppState)
        return { error: message }
      }
    })()

    const agentsLaunched = (): number => {
      const t = getAppState().tasks?.[taskId]
      return isLocalWorkflowTask(t) ? (t as LocalWorkflowTaskState).agents.length : 0
    }

    if (background) {
      void execution
      return {
        data: {
          runId: task.runId,
          taskId,
          name: meta.name,
          description: meta.description,
          status: 'running' as const,
          outputFile: getTaskOutputPath(taskId),
          agentsLaunched: 0,
          message: `Workflow "${meta.name}" started as task ${taskId}. A task notification with the result arrives when it completes; /workflows shows progress.`,
        },
      }
    }

    const outcome = await execution
    return {
      data: {
        runId: task.runId,
        taskId,
        name: meta.name,
        description: meta.description,
        status: outcome.error ? ('failed' as const) : ('completed' as const),
        outputFile: getTaskOutputPath(taskId),
        agentsLaunched: agentsLaunched(),
        result: outcome.result,
        error: outcome.error,
        message: outcome.error
          ? `Workflow "${meta.name}" failed: ${outcome.error}`
          : `Workflow "${meta.name}" completed with ${agentsLaunched()} agents.`,
      },
    }
  },
})
