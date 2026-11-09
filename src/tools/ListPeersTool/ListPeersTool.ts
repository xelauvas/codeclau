import { z } from 'zod/v4'
import { buildTool } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { listAllLiveSessions, type LiveSession } from '../../utils/udsClient.js'

export const LIST_PEERS_TOOL_NAME = 'ListPeers'

const DESCRIPTION = `List the other Xela sessions running on this machine that can receive messages. Each peer has a socket address; send to it with SendMessage({ to: "uds:<socket path>", message: "..." }). The message arrives in that session as a user prompt wrapped in <cross-session-message from="uds:...">; the peer replies by sending to the from address. Use it to coordinate work across projects or hand a question to a session that has the right context.`

const inputSchema = lazySchema(() => z.strictObject({}))
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    peers: z.array(
      z.object({
        address: z.string(),
        pid: z.number(),
        cwd: z.string().optional(),
        name: z.string().optional(),
        kind: z.string().optional(),
        startedAt: z.number().optional(),
      }),
    ),
    self: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

export const ListPeersTool = buildTool({
  name: LIST_PEERS_TOOL_NAME,
  searchHint: 'discover other local sessions to message',
  maxResultSizeChars: 20_000,
  userFacingName: () => 'List peers',
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
  async description() {
    return 'List other local sessions'
  },
  async prompt() {
    return DESCRIPTION
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const lines =
      output.peers.length === 0
        ? ['No other reachable sessions on this machine.']
        : output.peers.map(
            p =>
              `- ${p.address}  pid ${p.pid}${p.name ? `  name ${p.name}` : ''}${p.cwd ? `  cwd ${p.cwd}` : ''}${p.kind && p.kind !== 'interactive' ? `  (${p.kind})` : ''}`,
          )
    if (output.self) lines.push(`(this session: uds:${output.self})`)
    return { tool_use_id: toolUseID, type: 'tool_result', content: lines.join('\n') }
  },
  renderToolUseMessage() {
    return ''
  },
  renderToolResultMessage(output: Output) {
    return `${output.peers.length} peer${output.peers.length === 1 ? '' : 's'}`
  },
  async call() {
    const sessions = await listAllLiveSessions()
    const self = sessions.find(s => s.isSelf)
    const peers = sessions
      .filter((s): s is LiveSession & { messagingSocketPath: string } => !s.isSelf && s.reachable && !!s.messagingSocketPath)
      .map(s => ({
        address: `uds:${s.messagingSocketPath}`,
        pid: s.pid,
        cwd: s.cwd,
        name: s.name,
        kind: s.kind,
        startedAt: s.startedAt,
      }))
    return { data: { peers, self: self?.messagingSocketPath } }
  },
})
