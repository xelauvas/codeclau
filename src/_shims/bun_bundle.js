// Shim for bun:bundle - replaces build-time feature flags with runtime config
// Only client-side features are enabled. Flags that need Anthropic servers
// (KAIROS, CCR, BRIDGE, DAEMON, telemetry, server-side context management)
// stay off. Override with XELA_FEATURES="FLAG_A,FLAG_B" (replaces the list)
// or XELA_FEATURES_DISABLE="FLAG_A" (removes from the list).
// Flags whose code the fork lacks are stubbed by the loader; the ones that
// still need Anthropic servers (KAIROS, CCR, DAEMON, telemetry, CACHED_MICROCOMPACT)
// stay off. TREE_SITTER_BASH needs web-tree-sitter, CACHED_MICROCOMPACT the
// Anthropic API.
const DEFAULT_FEATURES = [
  // Permissions: auto mode (⏵⏵ Auto via Shift+Tab) runs the classifier on the configured model
  'TRANSCRIPT_CLASSIFIER',
  'BASH_CLASSIFIER',
  // Agents: teams/agents panel, Explore/Plan built-in subagents, fork subagent, verification agent
  'TEAMMEM',
  'BUILTIN_EXPLORE_PLAN_AGENTS',
  'FORK_SUBAGENT',
  'VERIFICATION_AGENT',
  'AGENT_MEMORY_SNAPSHOT',
  // Background sessions and the Monitor tool (reimplemented in tools/MonitorTool)
  'BG_SESSIONS',
  'MONITOR_TOOL',
  // Workflow scripts (reimplemented in tools/WorkflowTool)
  'WORKFLOW_SCRIPTS',
  // Context management: snip (model-driven), collapse (background summaries), compact on prompt-too-long
  'HISTORY_SNIP',
  'CONTEXT_COLLAPSE',
  'REACTIVE_COMPACT',
  'TOKEN_BUDGET',
  'COMPACTION_REMINDERS',
  // UI
  'MESSAGE_ACTIONS',
  'HISTORY_PICKER',
  'QUICK_SEARCH',
  'AUTO_THEME',
  'HOOK_PROMPTS',
  // Tools reimplemented here: terminal panel capture (tmux), headless browser (gstack browse), local skill discovery
  'TERMINAL_PANEL',
  'WEB_BROWSER_TOOL',
  'EXPERIMENTAL_SKILL_SEARCH',
  // Misc
  'MCP_SKILLS',
  'NEW_INIT',
  'ULTRATHINK',
  // Cross-session messaging (SendMessage to uds:<socket>, /peers, ListPeers)
  'UDS_INBOX',
  // Proactive mode (/proactive, Sleep tool, <tick> check-ins)
  'PROACTIVE',
  // Skills & tools reimplemented locally
  'KAIROS_DREAM',            // /dream memory consolidation
  'KAIROS_PUSH_NOTIFICATION', // PushNotification tool (terminal/OS notification)
  'KAIROS_GITHUB_WEBHOOKS',  // SubscribePR tool (gh polling through Monitor)
  'REVIEW_ARTIFACT',         // /hunter + ReviewArtifact tool
  'RUN_SKILL_GENERATOR',     // /run-skill-generator
  'BUILDING_CLAUDE_APPS',    // /claude-api skill
  'AGENT_TRIGGERS',          // CronCreate/CronList/CronDelete + /loop
  'BUDDY',                   // /buddy companion
  'TEMPLATES',               // background job state (CLAUDE_JOB_DIR)
  'AWAY_SUMMARY',
  'UNATTENDED_RETRY',
  'DUMP_SYSTEM_PROMPT',
  'NATIVE_CLIPBOARD_IMAGE',
  'MCP_RICH_OUTPUT',
];

const ENABLED_FEATURES = new Set(
  process.env.XELA_FEATURES
    ? process.env.XELA_FEATURES.split(',').map(s => s.trim()).filter(Boolean)
    : DEFAULT_FEATURES,
);
for (const f of (process.env.XELA_FEATURES_DISABLE || '').split(',')) {
  if (f.trim()) ENABLED_FEATURES.delete(f.trim());
}

export function feature(name) {
  return ENABLED_FEATURES.has(name);
}
