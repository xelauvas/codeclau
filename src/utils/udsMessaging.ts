import { mkdirSync, unlinkSync, existsSync, chmodSync } from 'fs'
import { createServer, type Server, type Socket } from 'net'
import { tmpdir } from 'os'
import { join } from 'path'
import { getSessionId } from '../bootstrap/state.js'
import { registerCleanup } from './cleanupRegistry.js'
import { getCwd } from './cwd.js'
import { logForDebugging } from './debug.js'

/**
 * Cross-session messaging over a Unix domain socket. Every session listens
 * on its own socket; `SendMessage` with `to: "uds:<path>"` connects and
 * writes one JSON line. Incoming text is enqueued as a user prompt wrapped in
 * <cross-session-message from="uds:<sender socket>">, so the receiving
 * model can reply by copying `from` into `to`.
 *
 * Wire format (newline-delimited JSON, one request per connection):
 *   {"type":"message","from":"uds:/path","message":"text"}  → {"ok":true}
 *   {"type":"ping"}                                          → {"ok":true,"sessionId","cwd","pid"}
 */
type State = {
  server: Server | null
  path: string | null
  onEnqueue: (() => void) | null
}
const state: State = ((globalThis as unknown as { __xelaUds?: State }).__xelaUds ??= {
  server: null,
  path: null,
  onEnqueue: null,
})

export const CROSS_SESSION_TAG = 'cross-session-message'

export function getUdsSocketDir(): string {
  return process.env.CLAUDE_CODE_MESSAGING_SOCKET_DIR || join(tmpdir(), 'cc-socks')
}

export function getDefaultUdsSocketPath(): string {
  return join(getUdsSocketDir(), `${process.pid}.sock`)
}

export function getUdsMessagingSocketPath(): string | undefined {
  return state.path ?? process.env.CLAUDE_CODE_MESSAGING_SOCKET ?? undefined
}

export function setOnEnqueue(fn: (() => void) | null): void {
  state.onEnqueue = fn
}

export function formatCrossSessionMessage(from: string, message: string): string {
  return `<${CROSS_SESSION_TAG} from="${from.replace(/"/g, '&quot;')}">\n${message}\n</${CROSS_SESSION_TAG}>`
}

function handleRequest(socket: Socket, raw: string): void {
  let req: { type?: string; from?: string; message?: unknown }
  try {
    req = JSON.parse(raw)
  } catch {
    socket.end(JSON.stringify({ ok: false, error: 'invalid JSON' }) + '\n')
    return
  }
  if (req.type === 'ping') {
    socket.end(
      JSON.stringify({ ok: true, sessionId: getSessionId(), cwd: getCwd(), pid: process.pid }) + '\n',
    )
    return
  }
  if (req.type === 'message' && typeof req.message === 'string') {
    const from = typeof req.from === 'string' && req.from ? req.from : 'uds:unknown'
    const text = formatCrossSessionMessage(from, req.message)
    // Imported lazily: messageQueueManager pulls in the REPL graph, and a
    // static import from here deadlocked setup()'s dynamic import of this
    // module while that graph was still evaluating.
    void import('./messageQueueManager.js')
      .then(({ enqueue }) => {
        enqueue({ value: text, mode: 'prompt', priority: 'later' })
        state.onEnqueue?.()
        logForDebugging(`[uds] message from ${from} (${req.message.length} chars)`)
        socket.end(JSON.stringify({ ok: true }) + '\n')
      })
      .catch(e => {
        logForDebugging(`[uds] enqueue failed: ${String(e)}`)
        socket.end(JSON.stringify({ ok: false, error: 'enqueue failed' }) + '\n')
      })
    return
  }
  socket.end(JSON.stringify({ ok: false, error: 'unknown request' }) + '\n')
}

export async function startUdsMessaging(
  path: string,
  _options: { isExplicit?: boolean } = {},
): Promise<string | null> {
  if (state.server) return state.path
  try {
    mkdirSync(getUdsSocketDir(), { recursive: true, mode: 0o700 })
    if (existsSync(path)) unlinkSync(path)
  } catch (e) {
    logForDebugging(`[uds] cannot prepare socket dir: ${String(e)}`)
  }
  const server = createServer(socket => {
    let buffer = ''
    socket.setEncoding('utf8')
    socket.on('data', chunk => {
      buffer += chunk
      const nl = buffer.indexOf('\n')
      if (nl >= 0) {
        const line = buffer.slice(0, nl)
        buffer = ''
        handleRequest(socket, line)
      } else if (buffer.length > 1_000_000) {
        socket.destroy()
      }
    })
    socket.on('end', () => {
      if (buffer.trim()) handleRequest(socket, buffer.trim())
    })
    socket.on('error', () => {})
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(path, () => resolve())
  }).catch(e => {
    logForDebugging(`[uds] listen failed on ${path}: ${String(e)}`)
    return null
  })
  if (!server.listening) return null
  try {
    chmodSync(path, 0o600)
  } catch {
    // best effort
  }
  state.server = server
  state.path = path
  process.env.CLAUDE_CODE_MESSAGING_SOCKET = path
  registerCleanup(async () => {
    await stopUdsMessaging()
  })
  logForDebugging(`[uds] listening on ${path}`)
  return path
}

export async function stopUdsMessaging(): Promise<void> {
  const { server, path } = state
  state.server = null
  state.path = null
  if (server) {
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
  if (path) {
    try {
      unlinkSync(path)
    } catch {
      // already gone
    }
  }
}
