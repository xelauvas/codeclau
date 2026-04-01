/**
 * OpenAI Adapter - Makes OpenAI API look like the Anthropic SDK.
 *
 * Wraps OpenAI's chat completions API behind the same interface that
 * the rest of the app expects from @anthropic-ai/sdk.
 *
 * Set OPENAI_API_KEY env var and optionally OPENAI_MODEL (default: gpt-4o).
 */
import OpenAI from 'openai'

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o'

let _openaiClient: OpenAI | null = null

function getOpenAI(): OpenAI {
  if (!_openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required')
    }
    _openaiClient = new OpenAI({ apiKey })
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
  const model = params.model?.includes('claude') ? MODEL : (params.model || MODEL)

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
    max_completion_tokens: Math.min(params.max_tokens || 8192, 16384),
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
      const model = params.model?.includes('claude') ? MODEL : (params.model || MODEL)

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
        max_completion_tokens: Math.min(params.max_tokens || 8192, 16384),
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
