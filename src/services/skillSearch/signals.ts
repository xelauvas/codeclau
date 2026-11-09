/** What triggered a skill discovery pass. */
export type DiscoverySignal =
  | 'user_input'
  | 'assistant_turn'
  | 'subagent_spawn'
  | 'tool_call'
  | 'explicit'
