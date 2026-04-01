# Provider Guide

Claude Code TUI powered by any OpenAI-compatible API.

## Quick Start

```bash
export OPENAI_API_KEY=your-key-here
./run.sh
```

## Providers

### Groq — FREE tier, very fast
```bash
export OPENAI_API_KEY=gsk_your_groq_key
./run.sh
```
- Models: `llama-3.3-70b-versatile` (default), `llama-3.1-8b-instant`, `mixtral-8x7b-32768`
- Price: **Free** (rate limited), paid plans available
- Get key: https://console.groq.com/keys
- Auto-detected from `gsk_` prefix

---

### DeepSeek — $0.14/1M input tokens (20x cheaper than OpenAI)
```bash
export OPENAI_API_KEY=sk-your-deepseek-key
export OPENAI_BASE_URL=https://api.deepseek.com
./run.sh
```
- Models: `deepseek-chat` (default), `deepseek-coder`, `deepseek-reasoner`
- Price: **$0.14/1M input, $0.28/1M output**
- Get key: https://platform.deepseek.com/api_keys

---

### Ollama — FREE, runs locally on your machine
```bash
# Install and start Ollama first
curl -fsSL https://ollama.ai/install.sh | sh
ollama serve &
ollama pull llama3.2

# Then run
export OPENAI_API_KEY=ollama
export OPENAI_BASE_URL=http://localhost:11434/v1
export OPENAI_MODEL=llama3.2
./run.sh
```
- Models: `llama3.2` (default), `codellama`, `mistral`, `phi3`, any Ollama model
- Price: **Free** (runs on your hardware)
- Requires: ~4GB RAM for 7B models, ~8GB for 13B

---

### OpenRouter — Many models, some free
```bash
export OPENAI_API_KEY=sk-or-your-key
./run.sh
```
- Models: `google/gemini-2.0-flash-001` (default), `anthropic/claude-3.5-sonnet`, `openai/gpt-4o`, hundreds more
- Price: Varies per model, some are **free**
- Get key: https://openrouter.ai/keys
- Auto-detected from `sk-or-` prefix
- Override model: `export OPENAI_MODEL=google/gemini-2.0-flash-001`

---

### OpenAI — The default
```bash
export OPENAI_API_KEY=sk-proj-your-key
./run.sh
```
- Models: `gpt-4o` (default), `gpt-4o-mini`, `gpt-4-turbo`, `o1-preview`
- Price: $2.50/1M input, $10/1M output (gpt-4o)
- Get key: https://platform.openai.com/api-keys

---

### Moonshot / Kimi — Cheap, good for Chinese + English
```bash
export OPENAI_API_KEY=sk-your-moonshot-key
export OPENAI_BASE_URL=https://api.moonshot.cn/v1
./run.sh
```
- Models: `moonshot-v1-8k` (default), `moonshot-v1-32k`, `moonshot-v1-128k`
- Price: ~$0.17/1M tokens
- Get key: https://platform.moonshot.cn/console/api-keys

---

### Mistral — European provider, competitive pricing
```bash
export OPENAI_API_KEY=your-mistral-key
export OPENAI_BASE_URL=https://api.mistral.ai/v1
./run.sh
```
- Models: `mistral-large-latest` (default), `mistral-small-latest`, `codestral-latest`
- Price: $2/1M input (large), $0.1/1M (small)
- Get key: https://console.mistral.ai/api-keys

---

### Together AI — Open source models, fast
```bash
export OPENAI_API_KEY=your-together-key
export OPENAI_BASE_URL=https://api.together.xyz/v1
./run.sh
```
- Models: `meta-llama/Llama-3.3-70B-Instruct-Turbo` (default), many more
- Price: ~$0.88/1M tokens (Llama 70B)
- Get key: https://api.together.xyz/settings/api-keys

---

### Fireworks AI — Fast inference
```bash
export OPENAI_API_KEY=your-fireworks-key
export OPENAI_BASE_URL=https://api.fireworks.ai/inference/v1
./run.sh
```
- Models: `accounts/fireworks/models/llama-v3p3-70b-instruct` (default)
- Price: ~$0.90/1M tokens
- Get key: https://fireworks.ai/api-keys

---

## Custom Provider

Any OpenAI-compatible API works:
```bash
export OPENAI_API_KEY=your-key
export OPENAI_BASE_URL=https://your-provider.com/v1
export OPENAI_MODEL=model-name
./run.sh
```

## Switching Providers

Just change the env vars and run again:
```bash
# Switch from OpenAI to Groq
unset OPENAI_BASE_URL
export OPENAI_API_KEY=gsk_new_groq_key
./run.sh
```

To make it permanent, add to your `~/.bashrc`:
```bash
echo 'export OPENAI_API_KEY=gsk_your_key' >> ~/.bashrc
source ~/.bashrc
```

## Price Comparison (per 1M input tokens)

| Provider | Model | Input Price | Output Price | Notes |
|----------|-------|------------|-------------|-------|
| **Groq** | llama-3.3-70b | **Free** | **Free** | Rate limited |
| **Ollama** | llama3.2 | **Free** | **Free** | Local, needs GPU/RAM |
| **DeepSeek** | deepseek-chat | $0.14 | $0.28 | Best value |
| **Together** | Llama-3.3-70B | $0.88 | $0.88 | Fast |
| **Mistral** | mistral-small | $0.10 | $0.30 | Good for simple tasks |
| **Moonshot** | moonshot-v1-8k | $0.17 | $0.17 | Good for Chinese |
| **OpenAI** | gpt-4o-mini | $0.15 | $0.60 | Cheap OpenAI option |
| **OpenAI** | gpt-4o | $2.50 | $10.00 | Best quality |
| **OpenRouter** | varies | varies | varies | Access to all models |
