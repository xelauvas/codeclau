/**
 * Remote Control ("bridge") peers relay through Anthropic's servers and are
 * not reachable from a local build. Kept so SendMessage's `bridge:` branch
 * fails cleanly.
 */
export async function postInterClaudeMessage(
  _sessionId: string,
  _message: string,
): Promise<{ ok: boolean; error?: string }> {
  return {
    ok: false,
    error: 'Remote Control is not available in this build; use uds:<socket> for sessions on this machine (see ListPeers)',
  }
}

export async function listBridgePeers(): Promise<Array<{ sessionId: string; title?: string }>> {
  return []
}
