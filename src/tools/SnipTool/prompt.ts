export const SNIP_TOOL_NAME = 'Snip'

export const DESCRIPTION = `Remove a range of earlier messages from your context window when they are no longer needed (stale tool output, exploration that led nowhere, resolved sub-tasks). User messages carry an \`[id:xxxxxx]\` tag; pass the first and last tag of the range you want gone. Everything from start_id through end_id (inclusive) stops being sent to the model from the next turn on, and a short boundary note takes its place. The user still sees the original messages in their scrollback.

Use it when the conversation has grown and a chunk of it is clearly done: large file reads you already acted on, failed attempts you have moved past, verbose command output whose conclusion you have noted. Keep anything you may still need to quote or re-check. The most recent turns cannot be snipped. Tool calls and their results are removed together so the transcript stays consistent.`
