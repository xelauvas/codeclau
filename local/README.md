# Xela with a local model (llama.cpp)

Everything needed to run Xela on your own GPU, without any cloud API. Tested on
an RTX 5090 Laptop (24 GB) with Qwen3.6-27B at 31-47 tok/s.

## 1. Install Xela

```bash
npm install -g @xelauvas/xela-cli
```

This gives you two commands: `xela` (cloud providers, interactive setup) and
`xela-local` (local model, this guide).

## 2. Build llama.cpp with CUDA

```bash
sudo apt install -y git cmake build-essential python3 curl
git clone https://github.com/ggml-org/llama.cpp ~/llama.cpp
cd ~/llama.cpp
cmake -B build -DGGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES=120   # 120 = RTX 50xx; 89 = RTX 40xx; 86 = RTX 30xx
cmake --build build --config Release -j --target llama-server
```

Needs the NVIDIA driver and the CUDA toolkit (12.8 or newer for RTX 50xx).

## 3. Download the model

```bash
mkdir -p ~/models && cd ~/models
# main model, ~17.6 GB
curl -L -o Qwen3.6-27B-UD-Q4_K_XL.gguf \
  https://huggingface.co/unsloth/Qwen3.6-27B-GGUF/resolve/main/Qwen3.6-27B-UD-Q4_K_XL.gguf
# MTP draft head for speculative decoding, ~3.2 GB (optional, +50% speed at 64k context)
curl -L -o mtp-Qwen3.6-27B-Q8_0.gguf \
  https://huggingface.co/unsloth/Qwen3.6-27B-GGUF/resolve/main/mtp-Qwen3.6-27B-Q8_0.gguf
```

Keep the models on the Linux disk (not `/mnt/c`) when using WSL.

## 4. Run

```bash
xela-local                      # starts the server if needed, then Xela in the current directory
CTX=65536 xela-local            # faster mode: 64k context + speculative decoding
OPENAI_THINKING=off xela-local  # no reasoning, quicker answers
```

Environment variables (all optional):

| Variable | Default | Meaning |
|---|---|---|
| `XELA_MODELS_DIR` | `~/models` | folder with the GGUF files |
| `LLAMA_SERVER` | `~/llama.cpp/build/bin/llama-server` | server binary |
| `CTX` | `131072` | context length; MTP turns on automatically at 65536 or less |
| `XELA_CONFIG_DIR` | `~/.xela-local` | Xela config, separate from `~/.claude` |
| `XELA_SERVER_URL` | `http://localhost:8080` | use an existing server (another machine works too) |

The server can be started by hand with `start-qwen.sh` (same directory as
`xela-local`); its log is in `$XELA_MODELS_DIR/server.log`.

## What is different from the cloud setup

- Auto mode permission classifier runs on the local model; read-only tools skip
  it. Expect 5-7 s per write/shell action.
- Background memory extraction, compaction, workflows and subagents all use the
  same local server (4 parallel slots).
- `/peers`, proactive mode (`/proactive on`), assistant mode (`xela-local --assistant`)
  and the other Claude Code features are enabled by default; see
  `src/_shims/bun_bundle.js` for the feature list (`XELA_FEATURES_DISABLE=NAME` to turn one off).

## Using Xela from any computer (like Claude Code or Codex)

The model stays on the GPU machine; Xela Code on any other computer signs in with a
XelaSphere account and talks to `https://api.xelasphere.com`, which forwards to that model.

**On any computer** (Node 20+ and bash/curl; no GPU, no model):

```bash
npm install -g @xelauvas/xela-cli
xela-local                 # first run: "Sign in with your XelaSphere account" opens the browser
xela-local --login         # sign in again / switch account        xela-local --logout
xela-local --whoami        # account, server and model in use
```

The browser opens `https://xelasphere.com/cli/auth?code=XXXX-XXXX`; after you approve, the CLI
receives an API key tied to your account (saved in `~/.xela-local/server.env`). The same account
and the same model are used by the chat on xelasphere.com.

**On the GPU machine** the server runs `start-qwen.sh` with a key, and `xela-link --daemon` keeps a
reverse SSH tunnel to the XelaSphere server so `api.xelasphere.com` reaches it (details in the
XelaSphere repo, `deploy/XELA-CODE-LINK.md`). Without an account you can still point the CLI at any
llama-server directly: `xela-local --setup` (or `--server URL --key KEY`), optionally exposed with
`xela-tunnel` (ngrok) or on the LAN (`http://<gpu-machine-ip>:8080`; in WSL enable mirrored
networking and open port 8080 in the Windows firewall).
