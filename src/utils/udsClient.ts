import { readdir, readFile } from 'fs/promises'
import { connect } from 'net'
import { join } from 'path'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { getUdsMessagingSocketPath } from './udsMessaging.js'

export type LiveSession = {
  pid: number
  sessionId?: string
  cwd?: string
  startedAt?: number
  kind?: string
  name?: string
  messagingSocketPath?: string
  /** true when the peer answered a ping on its socket */
  reachable: boolean
  isSelf: boolean
}

function request(path: string, payload: unknown, timeoutMs: number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = connect(path)
    let buffer = ''
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`timeout after ${timeoutMs}ms`))
    }, timeoutMs)
    socket.setEncoding('utf8')
    socket.once('connect', () => {
      socket.write(JSON.stringify(payload) + '\n')
    })
    socket.on('data', chunk => {
      buffer += chunk
    })
    socket.once('error', err => {
      clearTimeout(timer)
      reject(err)
    })
    socket.once('close', () => {
      clearTimeout(timer)
      try {
        resolve(JSON.parse(buffer.trim() || '{}'))
      } catch {
        resolve({ ok: false, error: `bad reply: ${buffer.slice(0, 100)}` })
      }
    })
  })
}

/** Deliver a text message to another session's socket. Throws on failure. */
export async function sendToUdsSocket(path: string, message: string): Promise<void> {
  const from = getUdsMessagingSocketPath()
  const reply = await request(path, { type: 'message', from: from ? `uds:${from}` : 'uds:unknown', message }, 5000)
  if (!reply.ok) throw new Error(String(reply.error ?? 'peer rejected the message'))
}

export async function pingUdsSocket(path: string): Promise<Record<string, unknown> | null> {
  try {
    const reply = await request(path, { type: 'ping' }, 1500)
    return reply.ok ? reply : null
  } catch {
    return null
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Sessions registered in <config>/sessions/<pid>.json whose process is
 * alive. Peers with a socket are pinged so the list only shows reachable
 * ones as such.
 */
export async function listAllLiveSessions(): Promise<LiveSession[]> {
  const dir = join(getClaudeConfigHomeDir(), 'sessions')
  let files: string[] = []
  try {
    files = await readdir(dir)
  } catch {
    return []
  }
  const out: LiveSession[] = []
  for (const file of files) {
    if (!/^\d+\.json$/.test(file)) continue
    const pid = parseInt(file.slice(0, -5), 10)
    if (!isProcessRunning(pid)) continue
    let data: Record<string, unknown> = {}
    try {
      data = JSON.parse(await readFile(join(dir, file), 'utf8'))
    } catch {
      continue
    }
    const socketPath = typeof data.messagingSocketPath === 'string' ? data.messagingSocketPath : undefined
    const isSelf = pid === process.pid
    const reachable = !isSelf && socketPath ? (await pingUdsSocket(socketPath)) !== null : isSelf
    out.push({
      pid,
      sessionId: data.sessionId as string | undefined,
      cwd: data.cwd as string | undefined,
      startedAt: data.startedAt as number | undefined,
      kind: data.kind as string | undefined,
      name: data.name as string | undefined,
      messagingSocketPath: socketPath,
      reachable,
      isSelf,
    })
  }
  return out.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
}
