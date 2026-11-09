/**
 * Multi-Provider Adapter - Makes any OpenAI-compatible API look like Anthropic SDK.
 *
 * Supports: OpenAI, Groq, OpenRouter, Moonshot/Kimi, DeepSeek, Ollama, Mistral,
 * Together AI, Fireworks, llama.cpp and any OpenAI-compatible endpoint.
 *
 * Environment variables:
 *   OPENAI_API_KEY        - API key (required)
 *   OPENAI_BASE_URL       - Custom base URL (optional, auto-detected from key prefix)
 *   OPENAI_MODEL          - Model name (optional, auto-detected from provider)
 *   OPENAI_MAX_TOKENS     - Cap on output tokens per request (optional, per-provider default)
 *   OPENAI_TEMPERATURE    - Force a sampling temperature (optional; local servers keep their own default)
 *   OPENAI_THINKING       - "on" | "off" to force reasoning for local servers (optional; follows the app otherwise)
 *   OPENAI_WEB_SEARCH     - "off" to disable the DuckDuckGo fallback for the WebSearch tool (optional)
 *   OPENAI_DEBUG_LOG      - Path of a JSONL file that receives every request/response summary (optional)
 *
 * Quick start examples:
 *   # OpenAI (default)
 *   OPENAI_API_KEY=sk-...
 *
 *   # Groq (free tier, fast)
 *   OPENAI_API_KEY=gsk_... OPENAI_MODEL=llama-3.3-70b-versatile
 *
 *   # OpenRouter (many models, some free)
 *   OPENAI_API_KEY=sk-or-... OPENAI_MODEL=google/gemini-2.0-flash-001
 *
 *   # DeepSeek (very cheap)
 *   OPENAI_API_KEY=sk-... OPENAI_BASE_URL=https://api.deepseek.com OPENAI_MODEL=deepseek-chat
 *
 *   # llama.cpp / Ollama / LM Studio (local, free)
 *   OPENAI_API_KEY=local OPENAI_BASE_URL=http://localhost:8080/v1 OPENAI_MODEL=qwen3.6-27b
 */
import OpenAI from 'openai'
import { appendFileSync } from 'fs'

// Auto-detect provider from API key prefix or base URL
function detectProvider(): { baseURL?: string; model: string; maxTokens: number } {
  const key = process.env.OPENAI_API_KEY || ''
  const baseURL = process.env.OPENAI_BASE_URL
  const model = process.env.OPENAI_MODEL

  // Explicit base URL — user knows what they want
  if (baseURL) {
    if (baseURL.includes('groq.com')) return { baseURL, model: model || 'llama-3.3-70b-versatile', maxTokens: 8192 }
    if (baseURL.includes('openrouter.ai')) return { baseURL, model: model || 'google/gemini-2.0-flash-001', maxTokens: 8192 }
    if (baseURL.includes('moonshot.cn') || baseURL.includes('moonshot.ai')) return { baseURL, model: model || 'moonshot-v1-32k', maxTokens: 4096 }
    if (baseURL.includes('deepseek.com')) return { baseURL, model: model || 'deepseek-chat', maxTokens: 8192 }
    // Local servers (llama.cpp, Ollama, LM Studio): reasoning models spend thousands of tokens thinking before answering
    if (isLocalUrl(baseURL)) return { baseURL, model: model || 'llama3.2', maxTokens: 32768 }
    if (baseURL.includes('mistral.ai')) return { baseURL, model: model || 'mistral-large-latest', maxTokens: 8192 }
    if (baseURL.includes('together.xyz')) return { baseURL, model: model || 'meta-llama/Llama-3.3-70B-Instruct-Turbo', maxTokens: 8192 }
    if (baseURL.includes('fireworks.ai')) return { baseURL, model: model || 'accounts/fireworks/models/llama-v3p3-70b-instruct', maxTokens: 8192 }
    return { baseURL, model: model || 'gpt-4o', maxTokens: 16384 }
  }

  // Auto-detect from key prefix
  if (key.startsWith('gsk_')) return { baseURL: 'https://api.groq.com/openai/v1', model: model || 'llama-3.3-70b-versatile', maxTokens: 8192 }
  if (key.startsWith('sk-or-')) return { baseURL: 'https://openrouter.ai/api/v1', model: model || 'google/gemini-2.0-flash-001', maxTokens: 8192 }

  // Default: OpenAI
  return { model: model || 'gpt-4o', maxTokens: 16384 }
}

function isLocalUrl(url: string): boolean {
  return /localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0/.test(url)
}

const PROVIDER = detectProvider()
const MODEL = PROVIDER.model
const IS_LOCAL = !!PROVIDER.baseURL && isLocalUrl(PROVIDER.baseURL)

function envNumber(name: string): number | undefined {
  const n = Number(process.env[name])
  return process.env[name] && Number.isFinite(n) && n > 0 ? n : undefined
}

// OPENAI_MAX_TOKENS overrides the per-provider output cap
const MAX_TOKENS = envNumber('OPENAI_MAX_TOKENS') ?? PROVIDER.maxTokens

// OPENAI_TEMPERATURE forces a temperature. Local servers otherwise keep their own
// sampling defaults (tuned per model), instead of the Claude-oriented value the app sends.
function resolveTemperature(requested: number | undefined): number | undefined {
  const forced = process.env.OPENAI_TEMPERATURE
  if (forced !== undefined && forced !== '' && Number.isFinite(Number(forced))) return Number(forced)
  return IS_LOCAL ? undefined : requested
}

// Reasoning on/off for local servers. Follows the app's thinking config (and the
// effort level) unless OPENAI_THINKING forces it. Sent as chat_template_kwargs,
// which llama.cpp understands; hosted providers would reject the unknown field.
function resolveThinking(params: any): boolean | undefined {
  if (!IS_LOCAL) return undefined
  const forced = (process.env.OPENAI_THINKING || '').toLowerCase()
  if (forced === 'on' || forced === 'true' || forced === '1') return true
  if (forced === 'off' || forced === 'false' || forced === '0') return false
  if (!params.thinking || params.thinking.type === 'disabled') return false
  if (params.output_config?.effort === 'low') return false
  // Conversation compaction is a summarization job: reasoning adds minutes on a
  // local model and nothing to the summary
  if (isCompactionRequest(params)) return false
  return true
}

function isCompactionRequest(params: any): boolean {
  const last = [...(params.messages || [])].reverse().find((m: any) => m.role === 'user')
  return !!last && /Your task is to create a detailed summary/.test(blockText(last.content))
}

function debugLog(entry: Record<string, unknown>): void {
  const path = process.env.OPENAI_DEBUG_LOG
  if (!path) return
  try {
    appendFileSync(path, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n')
  } catch {}
}

let _openaiClient: OpenAI | null = null

function getOpenAI(): OpenAI {
  if (!_openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required')
    }
    _openaiClient = new OpenAI({
      apiKey,
      ...(PROVIDER.baseURL ? { baseURL: PROVIDER.baseURL } : {}),
    })
  }
  return _openaiClient
}

function blockText(content: any): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((c: any) => (c?.type === 'text' ? c.text : c?.text || '')).join('\n')
  return content == null ? '' : JSON.stringify(content)
}

// Convert Anthropic-style messages to OpenAI format
function convertMessages(messages: any[]): any[] {
  const result: any[] = []

  for (const msg of messages) {
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        result.push({ role: 'user', content: msg.content })
      } else if (Array.isArray(msg.content)) {
        const parts: any[] = []
        for (const block of msg.content) {
          if (block.type === 'text') {
            parts.push({ type: 'text', text: block.text })
          } else if (block.type === 'tool_result') {
            // Tool results in Anthropic are content blocks, in OpenAI they're separate messages
            // (they must directly follow the assistant tool_calls message, before any user text)
            result.push({
              role: 'tool',
              tool_call_id: block.tool_use_id,
              content: blockText(block.content),
            })
          } else if (block.type === 'image') {
            parts.push({
              type: 'image_url',
              image_url: { url: `data:${block.source?.media_type || 'image/png'};base64,${block.source?.data}` },
            })
          }
        }
        if (parts.length > 0) {
          result.push({ role: 'user', content: parts })
        }
      }
    } else if (msg.role === 'assistant') {
      if (typeof msg.content === 'string') {
        result.push({ role: 'assistant', content: msg.content })
      } else if (Array.isArray(msg.content)) {
        let text = ''
        let reasoning = ''
        const toolCalls: any[] = []
        for (const block of msg.content) {
          if (block.type === 'text') {
            text += block.text
          } else if (block.type === 'thinking') {
            reasoning += block.thinking || ''
          } else if (block.type === 'tool_use') {
            toolCalls.push({
              id: block.id,
              type: 'function',
              function: {
                name: block.name,
                arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input),
              },
            })
          }
          // redacted_thinking is dropped
        }
        const assistantMsg: any = { role: 'assistant' }
        // A turn with only thinking still needs content, or strict servers reject the message
        if (text || toolCalls.length === 0) assistantMsg.content = text
        if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls
        // Reasoning models (Qwen3, DeepSeek) do better in multi-step tool loops when they
        // see their own earlier reasoning; llama.cpp passes reasoning_content to the template
        if (IS_LOCAL && reasoning) assistantMsg.reasoning_content = reasoning
        result.push(assistantMsg)
      }
    }
  }

  return result
}

// Anthropic server-side tools (web_search_20250305, computer_20241022, ...) run inside
// Anthropic's API. They have no input schema and nothing on the other end here.
function isServerTool(tool: any): boolean {
  return typeof tool?.type === 'string' && tool.type !== 'custom' && !tool.input_schema
}

// Convert Anthropic tool schemas to OpenAI function format
function convertTools(tools: any[]): any[] {
  if (!tools || tools.length === 0) return []

  return tools.filter((t: any) => !isServerTool(t)).map((tool: any) => {
    // Handle different Anthropic tool formats
    const name = tool.name || tool.function?.name
    const description = tool.description || tool.function?.description || ''
    const schema = tool.input_schema || tool.function?.parameters || { type: 'object', properties: {} }

    return {
      type: 'function',
      function: {
        name,
        description,
        parameters: schema,
      },
    }
  }).filter((t: any) => t.function.name)
}

function convertToolChoice(choice: any): any {
  if (!choice) return undefined
  switch (choice.type) {
    case 'auto': return 'auto'
    case 'any': return 'required'
    case 'none': return 'none'
    case 'tool': return { type: 'function', function: { name: choice.name } }
    default: return undefined
  }
}

// Map OpenAI finish reason to Anthropic stop reason
function mapStopReason(finishReason: string | null): string {
  switch (finishReason) {
    case 'stop': return 'end_turn'
    case 'tool_calls': return 'tool_use'
    case 'length': return 'max_tokens'
    case 'content_filter': return 'end_turn'
    default: return 'end_turn'
  }
}

function emptyUsage(): any {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
    service_tier: 'standard',
    cache_creation: {
      ephemeral_1h_input_tokens: 0,
      ephemeral_5m_input_tokens: 0,
    },
    inference_geo: '',
    iterations: [],
    speed: 'standard',
  }
}

// Build the OpenAI request body from Anthropic-style params
function buildRequest(params: any, stream: boolean): any {
  const openaiMessages: any[] = []

  if (params.system) {
    const systemText = typeof params.system === 'string'
      ? params.system
      : Array.isArray(params.system)
        ? params.system.map((s: any) => typeof s === 'string' ? s : s.text || '').join('\n')
        : ''
    if (systemText) {
      openaiMessages.push({ role: 'system', content: systemText })
    }
  }

  openaiMessages.push(...convertMessages(params.messages || []))

  const request: any = {
    // Always use the configured MODEL — internal Claude model names don't exist on OpenAI-compatible providers
    model: MODEL,
    messages: openaiMessages,
    max_completion_tokens: Math.min(params.max_tokens || 8192, MAX_TOKENS),
  }
  if (stream) {
    request.stream = true
    // Ask for a final usage chunk so context tracking and auto-compact see real token counts
    request.stream_options = { include_usage: true }
  }

  const tools = convertTools(params.tools || [])
  if (tools.length > 0) {
    request.tools = tools
    const toolChoice = convertToolChoice(params.tool_choice)
    if (toolChoice !== undefined) request.tool_choice = toolChoice
  }

  const temperature = resolveTemperature(params.temperature)
  if (temperature !== undefined) request.temperature = temperature

  const thinking = resolveThinking(params)
  if (thinking !== undefined) request.chat_template_kwargs = { enable_thinking: thinking }

  return request
}

function summarizeRequest(request: any): Record<string, unknown> {
  const messages: any[] = request.messages || []
  // OPENAI_DEBUG_FULL=1 logs the complete message list (large)
  if (process.env.OPENAI_DEBUG_FULL) {
    return request
  }
  return {
    ...request,
    messages: `${messages.length} messages`,
    reasoning_msgs: messages.filter(m => m.reasoning_content).length,
    tools: (request.tools || []).map((t: any) => t.function.name),
  }
}

// Re-throw provider errors as Anthropic APIError so the app's retry and
// compaction logic recognizes them
async function toAnthropicError(err: any): Promise<Error> {
  const { APIError } = await import('@anthropic-ai/sdk')
  const status = err?.status || 500
  let message: string = err?.message || 'OpenAI API error'
  // llama.cpp: "request (70123 tokens) exceeds the available context size (65536 tokens)"
  // The app triggers auto-compact on Anthropic's wording, so translate it.
  const ctx = /\((\d+) tokens\) exceeds the available context size \((\d+)/i.exec(message)
    || /(\d+) tokens? .*?exceed.*?(\d+)/i.exec(message)
  if (ctx) {
    message = `prompt is too long: ${ctx[1]} tokens > ${ctx[2]} maximum`
  }
  debugLog({ error: message, status })
  // APIError builds its .message from the body's `message` when present, so
  // the translated text must go into the body too, or the raw provider text
  // wins and prompt-too-long detection misses it.
  const body = { ...(typeof err?.error === 'object' && err.error ? err.error : {}), message }
  return new APIError(status, body, message, new Headers())
}

// ---------------------------------------------------------------------------
// WebSearch fallback. The app's WebSearch tool asks the model to run Anthropic's
// server-side web_search tool and parses the resulting content blocks. No other
// provider has that tool, so the search runs here (DuckDuckGo Lite, no API key)
// and the answer is shaped exactly like the Anthropic response.
// ---------------------------------------------------------------------------

type SearchHit = { title: string; url: string; snippet: string }

function decodeEntities(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim()
}

async function duckDuckGoSearch(query: string, signal?: AbortSignal): Promise<SearchHit[]> {
  const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`
  const res = await fetch(url, {
    signal,
    headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36' },
  })
  if (!res.ok) throw new Error(`DuckDuckGo returned HTTP ${res.status}`)
  const html = await res.text()

  const hits: SearchHit[] = []
  const linkRe = /<a[^>]*href="([^"]+)"[^>]*class='result-link'[^>]*>([\s\S]*?)<\/a>/g
  const snippetRe = /<td class='result-snippet'>([\s\S]*?)<\/td>/g
  const snippets: string[] = []
  let m: RegExpExecArray | null
  while ((m = snippetRe.exec(html)) !== null) snippets.push(decodeEntities(m[1]!))
  while ((m = linkRe.exec(html)) !== null) {
    let href = m[1]!.replace(/&amp;/g, '&')
    const uddg = /[?&]uddg=([^&]+)/.exec(href)
    if (uddg) href = decodeURIComponent(uddg[1]!)
    else if (href.startsWith('//')) href = 'https:' + href
    if (/duckduckgo\.com\/y\.js|ad_domain=/.test(href)) continue // sponsored
    hits.push({ title: decodeEntities(m[2]!), url: href, snippet: snippets[hits.length] || '' })
    if (hits.length >= 10) break
  }
  return hits
}

function extractSearchQuery(params: any): string {
  const last = [...(params.messages || [])].reverse().find((m: any) => m.role === 'user')
  const text = last ? blockText(last.content) : ''
  const m = /web search for the query:\s*([\s\S]+)$/i.exec(text)
  return (m ? m[1] : text).trim()
}

async function* webSearchStream(params: any, signal?: AbortSignal): AsyncGenerator<any> {
  const query = extractSearchQuery(params)
  const toolUseId = `srvtoolu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  yield { type: 'message_start', message: { id: `msg_${Date.now()}`, type: 'message', role: 'assistant', content: [], model: MODEL, stop_reason: null, stop_sequence: null, usage: emptyUsage() } }

  let index = 0
  yield { type: 'content_block_start', index, content_block: { type: 'server_tool_use', id: toolUseId, name: 'web_search', input: {} } }
  yield { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ query }) } }
  yield { type: 'content_block_stop', index }
  index++

  let hits: SearchHit[] = []
  let error: string | null = null
  try {
    hits = await duckDuckGoSearch(query, signal)
  } catch (e: any) {
    error = e?.message || String(e)
  }
  debugLog({ web_search: query, hits: hits.length, error })

  const resultBlock: any = {
    type: 'web_search_tool_result',
    tool_use_id: toolUseId,
    content: error
      ? { type: 'web_search_tool_result_error', error_code: 'unavailable' }
      : hits.map(h => ({ type: 'web_search_result', title: h.title, url: h.url, encrypted_content: '', page_age: null })),
  }
  yield { type: 'content_block_start', index, content_block: resultBlock }
  yield { type: 'content_block_stop', index }
  index++

  const text = error
    ? `Web search failed: ${error}`
    : hits.length === 0
      ? `No results found for "${query}".`
      : `Search results for "${query}":\n\n` + hits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}${h.snippet ? `\n   ${h.snippet}` : ''}`).join('\n\n')
  yield { type: 'content_block_start', index, content_block: { type: 'text', text: '' } }
  yield { type: 'content_block_delta', index, delta: { type: 'text_delta', text } }
  yield { type: 'content_block_stop', index }

  yield { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { input_tokens: 0, output_tokens: 0, server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 } } }
  yield { type: 'message_stop' }
}

function wantsWebSearch(params: any): boolean {
  if ((process.env.OPENAI_WEB_SEARCH || '').toLowerCase() === 'off') return false
  return (params.tools || []).some((t: any) => typeof t?.type === 'string' && t.type.startsWith('web_search'))
}

// Create a streaming response that mimics Anthropic's stream format
async function* createAnthropicStyleStream(params: any, signal?: AbortSignal): AsyncGenerator<any> {
  if (wantsWebSearch(params)) {
    yield* webSearchStream(params, signal)
    return
  }

  const openai = getOpenAI()
  const requestParams = buildRequest(params, true)
  debugLog({ request: summarizeRequest(requestParams) })

  let stream: any
  try {
    stream = await openai.chat.completions.create(requestParams, { signal })
  } catch (err: any) {
    throw await toAnthropicError(err)
  }

  // Emit message_start
  yield {
    type: 'message_start',
    message: {
      id: `msg_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      content: [],
      model: MODEL,
      stop_reason: null,
      stop_sequence: null,
      usage: emptyUsage(),
    },
  }

  // One content block is open at a time: thinking, text, or a tool call
  let contentBlockIndex = 0
  let openBlock: 'thinking' | 'text' | 'tool_use' | null = null
  let toolInputAccum = ''
  // OpenAI streams parallel tool calls keyed by index; the id only arrives on the first chunk
  let currentToolIndex: number | null = null
  let finishReason: string | null = null
  let usage: any = null

  function* closeBlock(): Generator<any> {
    if (!openBlock) return
    if (openBlock === 'tool_use' && toolInputAccum.trim() === '') {
      // Tools called without arguments must still carry a valid JSON object
      yield {
        type: 'content_block_delta',
        index: contentBlockIndex,
        delta: { type: 'input_json_delta', partial_json: '{}' },
      }
    }
    yield { type: 'content_block_stop', index: contentBlockIndex }
    contentBlockIndex++
    openBlock = null
    currentToolIndex = null
    toolInputAccum = ''
  }

  function* openBlockOf(type: 'thinking' | 'text'): Generator<any> {
    if (openBlock === type) return
    yield* closeBlock()
    openBlock = type
    yield {
      type: 'content_block_start',
      index: contentBlockIndex,
      content_block: type === 'thinking'
        ? { type: 'thinking', thinking: '', signature: '' }
        : { type: 'text', text: '' },
    }
  }

  try {
    for await (const chunk of stream) {
      // The usage chunk arrives last, with an empty choices array
      if (chunk.usage) usage = chunk.usage

      const choice = chunk.choices?.[0]
      if (!choice) continue

      const delta: any = choice.delta

      // Reasoning models: llama.cpp/DeepSeek send reasoning_content, OpenRouter sends reasoning
      const reasoning = delta?.reasoning_content ?? delta?.reasoning
      if (typeof reasoning === 'string' && reasoning) {
        yield* openBlockOf('thinking')
        yield {
          type: 'content_block_delta',
          index: contentBlockIndex,
          delta: { type: 'thinking_delta', thinking: reasoning },
        }
      }

      // Handle text content
      if (delta?.content) {
        yield* openBlockOf('text')
        yield {
          type: 'content_block_delta',
          index: contentBlockIndex,
          delta: { type: 'text_delta', text: delta.content },
        }
      }

      // Handle tool calls
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const index = tc.index ?? 0
          if (openBlock !== 'tool_use' || index !== currentToolIndex) {
            yield* closeBlock()
            openBlock = 'tool_use'
            currentToolIndex = index
            yield {
              type: 'content_block_start',
              index: contentBlockIndex,
              content_block: {
                type: 'tool_use',
                id: tc.id || `call_${Date.now()}_${index}`,
                name: tc.function?.name || '',
                input: '',
              },
            }
          }

          if (tc.function?.arguments) {
            toolInputAccum += tc.function.arguments
            yield {
              type: 'content_block_delta',
              index: contentBlockIndex,
              delta: { type: 'input_json_delta', partial_json: tc.function.arguments },
            }
          }
        }
      }

      if (choice.finish_reason) {
        finishReason = choice.finish_reason
      }
    }
  } catch (err: any) {
    throw await toAnthropicError(err)
  }

  // Close blocks and report stop reason + usage only after the stream ends,
  // so the trailing usage chunk is included
  yield* closeBlock()

  debugLog({ response: { stop: finishReason, usage } })

  yield {
    type: 'message_delta',
    delta: {
      stop_reason: mapStopReason(finishReason),
      stop_sequence: null,
    },
    usage: {
      input_tokens: usage?.prompt_tokens || 0,
      output_tokens: usage?.completion_tokens || 0,
    },
  }

  yield { type: 'message_stop' }
}

// Create a fake Anthropic client that uses OpenAI
export function createOpenAIBackedAnthropicClient(): any {
  const messageId = () => `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`

  const betaMessages = {
    create: (params: any, options?: any) => {
      if (params.stream) {
        // Return an APIPromise-like object: a Promise with .withResponse()
        const abortController = new AbortController()
        const generator = createAnthropicStyleStream(params, options?.signal || abortController.signal)
        let iterators = 0
        const streamObj: any = {
          [Symbol.asyncIterator]: () => {
            iterators++
            debugLog({ stream_iterator: iterators })
            return generator
          },
          controller: abortController,
        }

        // Create a promise that resolves to the stream
        const promise: any = Promise.resolve(streamObj)
        // Attach .withResponse() on the promise itself (like Anthropic's APIPromise)
        promise.withResponse = () => Promise.resolve({
          data: streamObj,
          response: new Response(),
          request_id: messageId(),
        })
        return promise
      }

      // Non-streaming
      return (async () => {
        const openai = getOpenAI()
        const requestParams = buildRequest(params, false)
        debugLog({ request: summarizeRequest(requestParams) })

        let response: any
        try {
          response = await openai.chat.completions.create(requestParams, { signal: options?.signal })
        } catch (err: any) {
          throw await toAnthropicError(err)
        }
        const choice = response.choices[0]
        const message: any = choice?.message || {}

        // Convert to Anthropic format
        const content: any[] = []
        const reasoning = message.reasoning_content ?? message.reasoning
        if (typeof reasoning === 'string' && reasoning) {
          content.push({ type: 'thinking', thinking: reasoning, signature: '' })
        }
        if (message.content) {
          content.push({ type: 'text', text: message.content })
        }
        if (message.tool_calls) {
          for (const tc of message.tool_calls) {
            let input = {}
            try { input = JSON.parse(tc.function.arguments) } catch {}
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.function.name,
              input,
            })
          }
        }

        debugLog({ response: { stop: choice?.finish_reason, usage: response.usage } })

        return {
          id: messageId(),
          type: 'message',
          role: 'assistant',
          content,
          model: MODEL,
          stop_reason: mapStopReason(choice?.finish_reason || null),
          stop_sequence: null,
          usage: {
            ...emptyUsage(),
            input_tokens: response.usage?.prompt_tokens || 0,
            output_tokens: response.usage?.completion_tokens || 0,
          },
        }
      })()
    },
  }

  return {
    beta: {
      messages: betaMessages,
    },
    messages: betaMessages,
  }
}
