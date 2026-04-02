# Xela CLI

AI coding assistant that works with **any model** — free or paid. Use OpenRouter, Groq, Ollama, DeepSeek, OpenAI, and more. One tool, any brain.

```
 ▐▛███▜▌   Xela CLI
▝▜█████▛▘  AI coding assistant
  ▘▘ ▝▝    powered by any model
```

## Install

**npm (recommended):**
```bash
npm install -g @xelauvas/xela-cli
```

**One-liner:**
```bash
curl -fsSL https://raw.githubusercontent.com/xelauvas/codeclau/main/install.sh | bash
```

**From source:**
```bash
git clone https://github.com/xelauvas/codeclau.git /opt/xela
cd /opt/xela && npm install && npm link
```

## Quick Start

```bash
# First run creates ~/.xela/config — edit it with your API key
xela

# Interactive mode
xela

# With a prompt
xela "fix the login bug in auth.ts"

# Non-interactive (pipe-friendly)
xela -p "explain this function"

# Override model on the fly
xela -m nvidia/nemotron-3-super-120b-a12b:free "review this code"
```

## Free Providers

You don't need to pay anything to use Xela. Here are free options:

### OpenRouter (Free Models)
Sign up at [openrouter.ai](https://openrouter.ai) — no credit card needed.

```bash
# ~/.xela/config
XELA_PROVIDER=openrouter
OPENAI_API_KEY=sk-or-your-key
OPENAI_MODEL=qwen/qwen3.6-plus-preview:free
```

Free models available:
| Model | ID | Context |
|---|---|---|
| Qwen 3.6 Plus | `qwen/qwen3.6-plus-preview:free` | 1M |
| Nemotron 3 Super 120B | `nvidia/nemotron-3-super-120b-a12b:free` | 262K |
| Step 3.5 Flash | `stepfun/step-3.5-flash:free` | 256K |
| Nemotron 3 Nano | `nvidia/nemotron-3-nano-30b-a3b:free` | 256K |

### Groq (Free Tier)
Sign up at [console.groq.com](https://console.groq.com) — blazing fast inference.

```bash
# ~/.xela/config
XELA_PROVIDER=groq
OPENAI_API_KEY=gsk_your-key
OPENAI_MODEL=qwen-qwq-32b
```

### Ollama (Local, Free Forever)
Install from [ollama.com](https://ollama.com) — runs on your machine.

```bash
ollama pull qwen2.5-coder:7b

# ~/.xela/config
XELA_PROVIDER=ollama
OPENAI_API_KEY=ollama
OPENAI_MODEL=qwen2.5-coder:7b
```

## Paid Providers

For better quality and speed:

### OpenRouter (Paid Models)
```bash
XELA_PROVIDER=openrouter
OPENAI_API_KEY=sk-or-your-key
OPENAI_MODEL=openai/gpt-5.3-codex          # $0.00175/M input
# OPENAI_MODEL=anthropic/claude-opus-4.6    # $0.005/M input
# OPENAI_MODEL=google/gemini-3.1-pro-preview # $0.002/M input
```

### DeepSeek
```bash
XELA_PROVIDER=deepseek
OPENAI_API_KEY=sk-your-key
OPENAI_MODEL=deepseek-chat
```

### OpenAI Direct
```bash
XELA_PROVIDER=openai
OPENAI_API_KEY=sk-your-key
OPENAI_MODEL=gpt-4o
```

## Configuration

Config file: `~/.xela/config` (created on first run)

```bash
# ~/.xela/config
XELA_PROVIDER=openrouter
OPENAI_API_KEY=sk-or-your-key-here
OPENAI_MODEL=qwen/qwen3.6-plus-preview:free
# OPENAI_BASE_URL=  # auto-detected from provider
```

### Supported Providers

| Provider | `XELA_PROVIDER` | Key Prefix | Free? |
|---|---|---|---|
| OpenRouter | `openrouter` | `sk-or-` | Free models available |
| Groq | `groq` | `gsk_` | Free tier |
| Ollama | `ollama` | `ollama` | Free (local) |
| DeepSeek | `deepseek` | `sk-` | Cheap |
| OpenAI | `openai` | `sk-` | Paid |
| Cerebras | `cerebras` | — | Free tier |
| SambaNova | `sambanova` | — | Free tier |

### Model Override

```bash
# Override for a single session
xela -m openai/gpt-5.4-pro "architect a microservice"

# Or set in config permanently
nano ~/.xela/config
```

## Features

- **Multi-provider** — Switch between any OpenAI-compatible API
- **Auto-detection** — Detects provider from API key prefix
- **Free by default** — Works with free models out of the box
- **Full CLI** — Interactive REPL, non-interactive mode, piping support
- **Tool use** — File editing, bash commands, web search, and more
- **Agentic coding** — Plans, executes, and iterates on code changes
- **MCP support** — Extensible via Model Context Protocol servers

## Self-Hosting Models

For privacy or unlimited usage, run models locally:

### Small Server (16GB RAM, no GPU)
```bash
ollama pull qwen2.5-coder:3b
# ~10-30 tokens/sec on CPU
```

### GPU Server (24GB+ VRAM)
```bash
ollama pull qwen2.5-coder:32b
# 100+ tokens/sec
```

### Multi-GPU Server
```bash
ollama pull deepseek-v3.2
# Full power
```

## Uninstall

```bash
# npm install
npm uninstall -g @xelauvas/xela-cli

# curl install
curl -fsSL https://raw.githubusercontent.com/xelauvas/codeclau/main/uninstall.sh | bash

# Config (optional)
rm -rf ~/.xela
```

## License

MIT
