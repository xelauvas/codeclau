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

The model server stays on the GPU machine; Xela on any other computer or
network talks to it over the internet. Install once, enter the server address
once, then just run `xela-local`.

**On the GPU machine**, start the server with a key and expose it through a
tunnel (no router or firewall changes needed; the key is the only protection,
so keep it secret):

```bash
LLAMA_API_KEY=choose-a-secret CTX=65536 start-qwen.sh   # or let xela-local start it
start-tunnel.sh                                          # ngrok (needs `ngrok config add-authtoken ...` once)
```

`start-tunnel.sh` prints the public https URL and checks that requests without
the key are refused. The free ngrok URL changes on every restart; claim the
free static domain in the ngrok dashboard (Domains) and run
`NGROK_DOMAIN=yourname.ngrok-free.app start-tunnel.sh` to keep it fixed.

Same network only? Skip the tunnel and use `http://<gpu-machine-ip>:8080`. If
the server runs inside WSL, enable mirrored networking (Windows 11: add
`networkingMode=mirrored` under `[wsl2]` in `%UserProfile%\.wslconfig`, then
`wsl --shutdown`) and allow port 8080 in the Windows firewall:

```powershell
New-NetFirewallHyperVRule -Name llama-8080 -DisplayName "llama-server 8080 (WSL)" -Direction Inbound -VMCreatorId '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' -Protocol TCP -LocalPorts 8080
New-NetFirewallRule -DisplayName "llama-server 8080" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow
```

**On any other computer** (Node 20+ and bash/curl; no GPU, no model):

```bash
npm install -g @xelauvas/xela-cli
xela-local            # first run asks: Server URL, API key → saved in ~/.xela-local/server.env
```

Afterwards `xela-local` works in any directory. `xela-local --setup` changes
the server; `xela-local --server URL --key KEY` sets it non-interactively.
`XELA_SERVER_URL` / `LLAMA_API_KEY` in the environment override the saved
values. The launcher never starts a server when the address is not localhost.
