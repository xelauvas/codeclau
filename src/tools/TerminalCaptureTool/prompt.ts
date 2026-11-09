export const TERMINAL_CAPTURE_TOOL_NAME = 'TerminalCapture'

export const DESCRIPTION = `Read (and optionally type into) the user's terminal panel — the persistent shell the user opens with Alt+J. Use it to see what the user ran and what their terminal shows (build errors, server logs, REPL state) without asking them to paste it.

- action "capture" (default): returns the visible scrollback of the panel, newest at the bottom. \`lines\` controls how many lines of history to include (default 200).
- action "send": types \`keys\` into the panel followed by Enter, then captures the result after a short wait. Use for quick commands the user would run themselves in that shell; for anything heavier use Bash.

The panel is a tmux session scoped to this Xela session. If the user never opened it, the tool says so.`
