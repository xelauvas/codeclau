export const MONITOR_TOOL_NAME = 'Monitor'

export const DESCRIPTION = `Start a background monitor that streams events from a long-running script. Each stdout line is an event — you keep working and notifications arrive in the chat. Events arrive on their own schedule and are not replies from the user.

Pick by how many notifications you need:
- **One** ("tell me when the server is ready / the build finishes") → use **Bash with \`run_in_background\`** and a command that exits when the condition is true, e.g. \`until grep -q "Ready in" dev.log; do sleep 0.5; done\`. You get a single completion notification when it exits.
- **One per occurrence, until the monitor expires** ("tell me every time an ERROR line appears") → Monitor with an unbounded command (\`tail -f\`, \`inotifywait -m\`, \`while true\`).
- **One per occurrence, until a known end** ("emit each CI step result, stop when the run completes") → Monitor with a command that emits lines and then exits.

Your script's stdout is the event stream. Each line becomes a notification. Exit ends the watch.

  # Each matching log line is an event
  tail -f /var/log/app.log | grep --line-buffered "ERROR"

  # Each file change is an event
  inotifywait -m --format '%e %f' /watched/dir

  # Poll and emit one line per new item
  last=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  while true; do
    now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    gh api "repos/owner/repo/issues/123/comments?since=$last" --jq '.[] | "\\(.user.login): \\(.body)"'
    last=$now; sleep 30
  done

**Don't use an unbounded command for a single notification.** \`tail -f\`, \`inotifywait -m\` and \`while true\` never exit on their own, so the monitor stays armed until timeout even after the event has fired.

**Script quality:**
- Every pipe stage must flush per line: \`grep\` needs \`--line-buffered\`, \`awk\` needs \`fflush()\`. \`head\` cannot flush at all.
- In poll loops, handle transient failures (\`curl ... || true\`) — one failed request shouldn't kill the monitor.
- Poll intervals: 30s+ for remote APIs, 0.5-1s for local checks.
- Write a specific \`description\` — it appears in every notification ("errors in deploy.log", not "watching logs").
- Only stdout is the event stream. Merge stderr with \`2>&1\` when its failures matter.

**Coverage — silence is not success.** Your filter must match every terminal state, not just the happy path: a monitor that greps only for the success marker stays silent through a crash. Widen the alternation: \`grep -E --line-buffered "elapsed_steps=|Traceback|Error|FAILED|Killed|OOM"\`.

**Output volume**: every stdout line is a conversation message, so filter to the lines you would act on. Monitors that produce too many events are stopped automatically; restart with a tighter filter.

Lines within 200ms are batched into a single notification. Every monitor expires after \`timeout_ms\` (default 5 minutes, at most 30 minutes); you get one notice at expiry and can re-arm. Use TaskStop to cancel early.

**ws source** — open a WebSocket and stream each incoming text frame as an event, no shell and no polling:

  Monitor({ ws: { url: 'wss://events.example.com/stream' }, description: 'deploy events' })

Each text frame becomes one notification. Socket close ends the watch with the close code surfaced.`
