/**
 * Multi-Provider Adapter - Makes any OpenAI-compatible API look like Anthropic SDK.
 *
 * Supports: OpenAI, Groq, OpenRouter, Moonshot/Kimi, DeepSeek, Ollama, Mistral,
 * Together AI, Fireworks, and any OpenAI-compatible endpoint.
 *
 * Environment variables:
 *   OPENAI_API_KEY    - API key (required)
 *   OPENAI_BASE_URL   - Custom base URL (optional, auto-detected from key prefix)
 *   OPENAI_MODEL      - Model name (optional, auto-detected from provider)
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
 *   # Moonshot/Kimi (cheap)
 *   OPENAI_API_KEY=sk-... OPENAI_BASE_URL=https://api.moonshot.ai/v1 OPENAI_MODEL=moonshot-v1-32k
 *
 *   # DeepSeek (very cheap)
 *   OPENAI_API_KEY=sk-... OPENAI_BASE_URL=https://api.deepseek.com OPENAI_MODEL=deepseek-chat
 *
 *   # Ollama (local, free)
 *   OPENAI_API_KEY=ollama OPENAI_BASE_URL=http://localhost:11434/v1 OPENAI_MODEL=llama3.2
 *
 *   # Mistral
 *   OPENAI_API_KEY=... OPENAI_BASE_URL=https://api.mistral.ai/v1 OPENAI_MODEL=mistral-large-latest
 *
 *   # Together AI
 *   OPENAI_API_KEY=... OPENAI_BASE_URL=https://api.together.xyz/v1 OPENAI_MODEL=meta-llama/Llama-3.3-70B-Instruct-Turbo
 */
import OpenAI from 'openai'

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
    if (baseURL.includes('localhost') || baseURL.includes('127.0.0.1')) return { baseURL, model: model || 'llama3.2', maxTokens: 4096 }
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

const PROVIDER = detectProvider()
const MODEL = PROVIDER.model
const MAX_TOKENS = PROVIDER.maxTokens

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
            const content = typeof block.content === 'string'
              ? block.content
              : Array.isArray(block.content)
                ? block.content.map((c: any) => c.text || '').join('\n')
                : JSON.stringify(block.content || '')
            result.push({
              role: 'tool',
              tool_call_id: block.tool_use_id,
              content,
            })
            continue
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
        const toolCalls: any[] = []
        for (const block of msg.content) {
          if (block.type === 'text') {
            text += block.text
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
          // Skip 'thinking' blocks
        }
        const assistantMsg: any = { role: 'assistant' }
        if (text) assistantMsg.content = text
        if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls
        result.push(assistantMsg)
      }
    }
  }

  return result
}

// Convert Anthropic tool schemas to OpenAI function format
function convertTools(tools: any[]): any[] {
  if (!tools || tools.length === 0) return []

  return tools.map((tool: any) => {
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

// Create a streaming response that mimics Anthropic's stream format
async function* createAnthropicStyleStream(params: any, signal?: AbortSignal): AsyncGenerator<any> {
  const openai = getOpenAI()
  // Always use the configured MODEL — internal Claude model names don't exist on OpenAI-compatible providers
  const model = MODEL

  const openaiMessages: any[] = []

  // Add system prompt
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

  // Convert messages
  openaiMessages.push(...convertMessages(params.messages || []))

  // Convert tools
  const tools = convertTools(params.tools || [])

  const requestParams: any = {
    model,
    messages: openaiMessages,
    stream: true,
    max_completion_tokens: Math.min(params.max_tokens || 8192, MAX_TOKENS),
  }

  if (tools.length > 0) {
    requestParams.tools = tools
  }

  if (params.temperature !== undefined) {
    requestParams.temperature = params.temperature
  }

  let stream: any
  try {
    stream = await openai.chat.completions.create(requestParams, { signal })
  } catch (err: any) {
    // Re-throw as Anthropic APIError so retry logic works
    const { APIError } = await import('@anthropic-ai/sdk')
    const status = err?.status || 500
    throw new APIError(status, err?.error || {}, err?.message || 'OpenAI API error', new Headers())
  }

  // Emit message_start
  const messageId = `msg_${Date.now()}`
  yield {
    type: 'message_start',
    message: {
      id: messageId,
      type: 'message',
      role: 'assistant',
      content: [],
      model,
      stop_reason: null,
      stop_sequence: null,
      usage: {
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
      },
    },
  }

  let contentBlockIndex = 0
  let currentToolCallId: string | null = null
  let currentToolName: string | null = null
  let toolInputAccum = ''
  let hasTextBlock = false

  for await (const chunk of stream) {
    const choice = chunk.choices?.[0]
    if (!choice) continue

    const delta = choice.delta

    // Handle text content
    if (delta?.content) {
      if (!hasTextBlock) {
        hasTextBlock = true
        yield {
          type: 'content_block_start',
          index: contentBlockIndex,
          content_block: { type: 'text', text: '' },
        }
      }
      yield {
        type: 'content_block_delta',
        index: contentBlockIndex,
        delta: { type: 'text_delta', text: delta.content },
      }
    }

    // Handle tool calls
    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        if (tc.id && tc.id !== currentToolCallId) {
          // Close previous text block if open
          if (hasTextBlock && !currentToolCallId) {
            yield { type: 'content_block_stop', index: contentBlockIndex }
            contentBlockIndex++
            hasTextBlock = false
          }
          // Close previous tool call if open
          if (currentToolCallId) {
            yield {
              type: 'content_block_delta',
              index: contentBlockIndex,
              delta: { type: 'input_json_delta', partial_json: '' },
            }
            yield { type: 'content_block_stop', index: contentBlockIndex }
            contentBlockIndex++
          }

          currentToolCallId = tc.id
          currentToolName = tc.function?.name || ''
          toolInputAccum = tc.function?.arguments || ''

          yield {
            type: 'content_block_start',
            index: contentBlockIndex,
            content_block: {
              type: 'tool_use',
              id: tc.id,
              name: currentToolName,
              input: "",
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

    // Handle finish
    if (choice.finish_reason) {
      // Close any open blocks
      if (hasTextBlock && !currentToolCallId) {
        yield { type: 'content_block_stop', index: contentBlockIndex }
        contentBlockIndex++
      }
      if (currentToolCallId) {
        yield { type: 'content_block_stop', index: contentBlockIndex }
        contentBlockIndex++
      }

      yield {
        type: 'message_delta',
        delta: {
          stop_reason: mapStopReason(choice.finish_reason),
          stop_sequence: null,
        },
        usage: { output_tokens: chunk.usage?.completion_tokens || 0 },
      }

      yield { type: 'message_stop' }
    }
  }
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
        const streamObj: any = {
          [Symbol.asyncIterator]: () => generator,
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

      // Non-streaming: wrap in async IIFE
      const nonStreamingResult = (async () => {
      const openai = getOpenAI()
      // Always use the configured MODEL
      const model = MODEL

      const openaiMessages: any[] = []
      if (params.system) {
        const systemText = typeof params.system === 'string'
          ? params.system
          : Array.isArray(params.system)
            ? params.system.map((s: any) => typeof s === 'string' ? s : s.text || '').join('\n')
            : ''
        if (systemText) openaiMessages.push({ role: 'system', content: systemText })
      }
      openaiMessages.push(...convertMessages(params.messages || []))

      const tools = convertTools(params.tools || [])
      const requestParams: any = {
        model,
        messages: openaiMessages,
        max_completion_tokens: Math.min(params.max_tokens || 8192, MAX_TOKENS),
      }
      if (tools.length > 0) requestParams.tools = tools
      if (params.temperature !== undefined) requestParams.temperature = params.temperature

      let response: any
      try {
        response = await openai.chat.completions.create(requestParams, { signal: options?.signal })
      } catch (err: any) {
        const { APIError } = await import('@anthropic-ai/sdk')
        const status = err?.status || 500
        throw new APIError(status, err?.error || {}, err?.message || 'OpenAI API error', new Headers())
      }
      const choice = response.choices[0]

      // Convert to Anthropic format
      const content: any[] = []
      if (choice?.message?.content) {
        content.push({ type: 'text', text: choice.message.content })
      }
      if (choice?.message?.tool_calls) {
        for (const tc of choice.message.tool_calls) {
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

      return {
        id: messageId(),
        type: 'message',
        role: 'assistant',
        content,
        model,
        stop_reason: mapStopReason(choice?.finish_reason || null),
        stop_sequence: null,
        usage: {
          input_tokens: response.usage?.prompt_tokens || 0,
          output_tokens: response.usage?.completion_tokens || 0,
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
        },
      }
      })(); // end async IIFE
      return nonStreamingResult;
    },
  }

  return {
    beta: {
      messages: betaMessages,
    },
    messages: betaMessages,
  }
}
