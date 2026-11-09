export const WORKFLOW_TOOL_NAME = 'Workflow'

// Default cap on agent() calls per run. The tool input can raise it.
export const DEFAULT_MAX_AGENTS = 10
export const HARD_MAX_AGENTS = 50
// Concurrency for parallel()/pipeline() when the script gives none
export const DEFAULT_CONCURRENCY = 4
