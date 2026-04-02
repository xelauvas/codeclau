# Xela CLI

[![npm](https://img.shields.io/npm/v/@xelauvas/xela-cli)](https://www.npmjs.com/package/@xelauvas/xela-cli)
[![GitHub stars](https://img.shields.io/github/stars/xelauvas/codeclau?style=social)](https://github.com/xelauvas/codeclau)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**Free AI coding assistant for your terminal.** Works with any model — OpenRouter, Groq, Ollama, DeepSeek, OpenAI, and more. Like Cursor/Claude Code, but free and open source.

```
╲  ╳  ╱   Xela
╱  ╳  ╲   AI coding assistant
  XELA    powered by any model
```

## Install

```bash
npm install -g @xelauvas/xela-cli
```

On first run, Xela walks you through setup — pick a provider, paste a key, choose a model. No config files to edit.

**Other install methods:**

```bash
# One-liner
curl -fsSL https://raw.githubusercontent.com/xelauvas/codeclau/main/install.sh | bash

# From source
git clone https://github.com/xelauvas/codeclau.git /opt/xela
cd /opt/xela && npm install && npm link
```

## Quick Start

```bash
# Interactive setup + launch
xela

# With a prompt
xela "fix the login bug in auth.ts"

# Non-interactive (pipe-friendly)
xela -p "explain this function"

# Override model for one session
xela -m google/gemini-2.5-pro-exp-03-25:free "review this code"
```

## What It Can Do

- **Edit files** — reads your code, makes changes with your permission
- **Run commands** — executes shell commands, runs tests, builds projects
- **Agentic coding** — plans, executes, and iterates on code changes
- **Multi-file refactoring** — rename, restructure, migrate across your codebase
- **Web search** — looks up docs, APIs, error messages
- **MCP support** — extensible via Model Context Protocol servers
- **Project memory** — run `/init` to create `XELA.md` with project instructions
- **Auto mode** — let Xela handle permissions automatically for long tasks

## Slash Commands

| Command | Description |
|---|---|
| `/init` | Create a `XELA.md` file with project instructions |
| `/model` | Switch model |
| `/config` | Open settings |
| `/help` | Show help |
| `/clear` | Clear conversation |
| `/compact` | Compress conversation to save context |
| `/cost` | Show token usage |
| `/mcp` | Manage MCP servers |

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Enter` | Submit prompt |
| `Escape` | Cancel current request |
| `Ctrl+C` | Exit |
| `Tab` | Accept autocomplete |
| `Shift+Tab` | Toggle auto mode |
| `Up/Down` | Navigate history |

## Free Providers

You don't need to pay anything. Here are free options:

### OpenRouter (recommended)
Sign up at [openrouter.ai/keys](https://openrouter.ai/keys) — no credit card needed.

Available free models:
| Model | ID |
|---|---|
| Qwen 3.6 Plus (1M context) | `qwen/qwen3.6-plus-preview:free` |
| DeepSeek Chat V3 | `deepseek/deepseek-chat-v3-0324:free` |
| Gemini 2.5 Pro | `google/gemini-2.5-pro-exp-03-25:free` |
| Llama 4 Maverick | `meta-llama/llama-4-maverick:free` |
| Nemotron Ultra 253B | `nvidia/llama-3.1-nemotron-ultra-253b:free` |

### Groq (free tier)
Sign up at [console.groq.com/keys](https://console.groq.com/keys) — blazing fast inference.

### Ollama (local, free forever)
Install from [ollama.com](https://ollama.com) — runs on your machine, fully private.

```bash
ollama pull qwen2.5-coder:7b
# Then pick "ollama" as provider during xela setup
```

### Other free tiers
- **Cerebras** — fast inference, free tier
- **SambaNova** — free tier available

## Paid Providers

For better quality and higher rate limits:

| Provider | Setup |
|---|---|
| **DeepSeek** | [platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys) — very cheap |
| **OpenAI** | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| **OpenRouter** (paid models) | Same key, just pick a paid model |

## Configuration

Config is stored at `~/.xela/config.json` (created during first-run setup).

```json
{
  "provider": "openrouter",
  "apiKey": "sk-or-v1-...",
  "model": "qwen/qwen3.6-plus-preview:free",
  "baseUrl": ""
}
```

### Re-run setup

```bash
rm ~/.xela/config.json && xela
```

### Change model

```bash
# Edit config directly
nano ~/.xela/config.json

# Or override per-session
xela -m model-id
```

### Supported Providers

| Provider | Default Model | Free? |
|---|---|---|
| OpenRouter | `qwen/qwen3.6-plus-preview:free` | Free models available |
| Groq | `qwen-qwq-32b` | Free tier |
| Ollama | `qwen2.5-coder:7b` | Free (local) |
| DeepSeek | `deepseek-chat` | Cheap |
| OpenAI | `gpt-4o` | Paid |
| Cerebras | `llama-3.3-70b` | Free tier |
| SambaNova | `Meta-Llama-3.3-70B-Instruct` | Free tier |

## Self-Hosting Models

For privacy or unlimited usage, run models locally with Ollama:

```bash
# Small (16GB RAM, no GPU) — ~10-30 tok/s
ollama pull qwen2.5-coder:3b

# GPU (24GB+ VRAM) — ~100 tok/s
ollama pull qwen2.5-coder:32b

# Multi-GPU — full power
ollama pull deepseek-v3.2
```

## Project Instructions (XELA.md)

Run `/init` inside any project to generate a `XELA.md` file. This file tells Xela about your project — build commands, architecture, conventions. It's loaded automatically every session.

```bash
cd my-project
xela
# then type /init
```

Xela also reads `XELA.local.md` for personal project instructions (add it to `.gitignore`).

## Uninstall

```bash
# Remove CLI
npm uninstall -g @xelauvas/xela-cli

# Remove config (optional)
rm -rf ~/.xela
```

## Links

- **GitHub**: [github.com/xelauvas/codeclau](https://github.com/xelauvas/codeclau)
- **npm**: [@xelauvas/xela-cli](https://www.npmjs.com/package/@xelauvas/xela-cli)
- **Issues**: [github.com/xelauvas/codeclau/issues](https://github.com/xelauvas/codeclau/issues)

## License

MIT
