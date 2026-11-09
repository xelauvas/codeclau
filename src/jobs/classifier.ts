import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AssistantMessage } from '../types/message.js'
import { logForDebugging } from '../utils/debug.js'

/**
 * Background-job bookkeeping (TEMPLATES). A job runs in its own directory
 * (`CLAUDE_JOB_DIR`); after every main-thread turn we classify how the turn
 * ended and write `state.json` there so the job list and notifications can
 * show status without parsing transcripts.
 */

export type JobStatus = 'running' | 'completed' | 'needs_input' | 'failed' | 'idle'

export type JobState = {
  status: JobStatus
  summary: string
  turnCount: number
  toolCalls: Record<string, number>
  lastTools: string[]
  errors: number
  updatedAt: string
}

export const JOB_STATE_FILE = 'state.json'
export const JOB_ENV_KEY = 'CLAUDE_JOB_DIR'

function textOf(msg: AssistantMessage): string {
  const content = msg.message.content
  if (typeof content === 'string') return content
  return content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim()
}

function looksLikeQuestion(text: string): boolean {
  const tail = text.split('\n').filter(l => l.trim()).slice(-3).join(' ')
  return /\?\s*$/.test(tail) || /\b(should I|do you want|would you like|let me know|which (one|option)|confirm)\b/i.test(tail)
}

export function classifyTurn(assistantMessages: AssistantMessage[]): Omit<JobState, 'turnCount' | 'updatedAt'> {
  const toolCalls: Record<string, number> = {}
  const lastTools: string[] = []
  let errors = 0
  let lastText = ''
  for (const m of assistantMessages) {
    if (m.isApiErrorMessage) errors++
    const content = m.message.content
    if (Array.isArray(content)) {
      for (const b of content) {
        if (b.type === 'tool_use') {
          toolCalls[b.name] = (toolCalls[b.name] ?? 0) + 1
          lastTools.push(b.name)
        }
      }
    }
    const t = textOf(m)
    if (t) lastText = t
  }
  const last = assistantMessages.at(-1)
  let status: JobStatus = 'completed'
  if (!last) status = 'idle'
  else if (last.isApiErrorMessage) status = 'failed'
  else if (lastText && looksLikeQuestion(lastText)) status = 'needs_input'
  else if (lastText && /\b(cannot|can't|unable to|blocked|failed)\b/i.test(lastText.slice(-400)) && errors > 0) status = 'failed'
  return {
    status,
    summary: lastText.slice(0, 600),
    toolCalls,
    lastTools: lastTools.slice(-8),
    errors,
  }
}

export function readJobState(jobDir: string): JobState | null {
  try {
    return JSON.parse(readFileSync(join(jobDir, JOB_STATE_FILE), 'utf8')) as JobState
  } catch {
    return null
  }
}

export async function classifyAndWriteState(
  jobDir: string,
  assistantMessages: AssistantMessage[],
): Promise<JobState> {
  const previous = readJobState(jobDir)
  const classified = classifyTurn(assistantMessages)
  const state: JobState = {
    ...classified,
    turnCount: (previous?.turnCount ?? 0) + 1,
    updatedAt: new Date().toISOString(),
  }
  try {
    mkdirSync(jobDir, { recursive: true })
    writeFileSync(join(jobDir, JOB_STATE_FILE), JSON.stringify(state, null, 2))
  } catch (e) {
    logForDebugging(`[job] cannot write ${jobDir}/${JOB_STATE_FILE}: ${String(e)}`)
  }
  return state
}
