import { z } from 'zod/v4'
import { buildTool } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { MONITOR_TOOL_NAME } from '../MonitorTool/prompt.js'

export const SUBSCRIBE_PR_TOOL_NAME = 'SubscribePR'

const PROMPT = `Watch a GitHub pull request and get notified when it changes: new reviews or comments, CI check results, merge-state changes, merge or close.

Upstream this uses GitHub webhooks; here it polls with the \`gh\` CLI (which must be installed and authenticated) through the Monitor tool, so each change arrives as a Monitor event while you keep working. One subscription per PR; the watch ends when the PR is merged or closed, on the timeout, or when you stop it.`

const inputSchema = lazySchema(() =>
  z.strictObject({
    pr: z.union([z.number().int().positive(), z.string()]).describe('PR number, or a full PR URL'),
    repo: z.string().optional().describe('owner/repo when the PR is not in the current repository'),
    interval_seconds: z.number().int().min(15).max(3600).default(60).describe('Polling interval'),
    timeout_minutes: z.number().int().min(1).max(24 * 60).default(240).describe('Stop watching after this long'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() => z.object({ message: z.string(), monitorResult: z.unknown().optional() }))
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

function buildPollScript(pr: string, repo: string | undefined, intervalSeconds: number): string {
  const repoFlag = repo ? ` -R ${JSON.stringify(repo)}` : ''
  return `
prev=""
while true; do
  cur=$(gh pr view ${JSON.stringify(pr)}${repoFlag} --json state,isDraft,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,reviews,comments,commits 2>&1 | python3 -c '
import json,sys
raw=sys.stdin.read()
try:
    d=json.loads(raw)
except Exception:
    print("ERROR " + raw.strip()[:300]); sys.exit(0)
checks=d.get("statusCheckRollup") or []
by={}
for c in checks:
    by[c.get("name") or c.get("context") or "?"]=c.get("conclusion") or c.get("state") or c.get("status") or "?"
summary={
  "state": d.get("state"), "draft": d.get("isDraft"), "mergeable": d.get("mergeable"),
  "mergeState": d.get("mergeStateStatus"), "reviewDecision": d.get("reviewDecision"),
  "reviews": len(d.get("reviews") or []), "comments": len(d.get("comments") or []),
  "commits": len(d.get("commits") or []), "checks": by,
}
print(json.dumps(summary, sort_keys=True))
')
  if [ "$cur" != "$prev" ]; then
    echo "$cur"
    prev="$cur"
  fi
  case "$cur" in *'"state": "MERGED"'*|*'"state": "CLOSED"'*) exit 0;; esac
  sleep ${intervalSeconds}
done`
}

export const SubscribePRTool = buildTool({
  name: SUBSCRIBE_PR_TOOL_NAME,
  searchHint: 'watch a GitHub pull request for reviews, checks and merges',
  maxResultSizeChars: 4000,
  userFacingName: () => 'Subscribe to PR',
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
  async description({ pr }) {
    return `Watch PR ${pr}`
  },
  async prompt() {
    return PROMPT
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return { tool_use_id: toolUseID, type: 'tool_result', content: output.message }
  },
  renderToolUseMessage(input: { pr?: number | string; repo?: string }) {
    return `${input.repo ? `${input.repo}#` : '#'}${input.pr ?? '?'}`
  },
  renderToolResultMessage(output: Output) {
    return output.message.split('\n')[0] ?? ''
  },
  async call(input, context, ...rest) {
    const { pr, repo, interval_seconds, timeout_minutes } = input
    // Delegate to the Monitor tool instance from the live tool set, so the
    // watch is registered with the same task registry as everything else.
    const monitor = context.options.tools.find(t => t.name === MONITOR_TOOL_NAME)
    if (!monitor) {
      throw new Error('The Monitor tool is not available in this session, so PR subscriptions cannot be started.')
    }
    const prText = String(pr)
    const monitorInput = {
      command: buildPollScript(prText, repo, interval_seconds),
      description: `PR ${repo ? `${repo}#` : '#'}${prText}: reviews, checks and merge state`,
      timeout_ms: timeout_minutes * 60_000,
    }
    const result = await (monitor as unknown as {
      call: (i: unknown, c: unknown, ...r: unknown[]) => Promise<{ data?: unknown }>
    }).call(monitorInput, context, ...rest)
    const data = (result?.data ?? {}) as { message?: string }
    const message = `Watching PR ${repo ? `${repo}#` : '#'}${prText} every ${interval_seconds}s via Monitor. Each change in state, reviews, comments or checks arrives as a Monitor event; the watch ends when the PR is merged or closed or after ${timeout_minutes} min.${data.message ? `\n${data.message}` : ''}`
    return { data: { message, monitorResult: result?.data } }
  },
})
