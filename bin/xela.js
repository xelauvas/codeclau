#!/usr/bin/env node
import { execFileSync, execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { createInterface } from 'readline';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const INSTALL_DIR = join(__dirname, '..');
const XELA_HOME = join(homedir(), '.xela');
const XELA_CONFIG = join(XELA_HOME, 'config.json');

const PROVIDERS = {
  openrouter:  { baseUrl: 'https://openrouter.ai/api/v1',    model: 'qwen/qwen3.6-plus-preview:free' },
  groq:        { baseUrl: 'https://api.groq.com/openai/v1',  model: 'qwen-qwq-32b' },
  ollama:      { baseUrl: 'http://localhost:11434/v1',        model: 'qwen2.5-coder:7b' },
  deepseek:    { baseUrl: 'https://api.deepseek.com',         model: 'deepseek-chat' },
  openai:      { baseUrl: undefined,                          model: 'gpt-4o' },
  cerebras:    { baseUrl: 'https://api.cerebras.ai/v1',       model: 'llama-3.3-70b' },
  sambanova:   { baseUrl: 'https://api.sambanova.ai/v1',      model: 'Meta-Llama-3.3-70B-Instruct' },
};

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer.trim()); }));
}

async function setup() {
  console.log('');
  console.log('  Welcome to Xela! Let\'s get you set up.');
  console.log('');

  // Pick provider
  const providerNames = Object.keys(PROVIDERS);
  console.log('  Providers:');
  providerNames.forEach((p, i) => console.log(`    ${i + 1}. ${p}`));
  console.log('');
  const choice = await ask('  Pick a provider [1]: ');
  const idx = (parseInt(choice) || 1) - 1;
  const provider = providerNames[Math.min(idx, providerNames.length - 1)];

  // Get API key (skip for ollama)
  let apiKey = '';
  if (provider === 'ollama') {
    apiKey = 'ollama';
  } else {
    console.log('');
    if (provider === 'openrouter') {
      console.log('  Get a free key at: https://openrouter.ai/keys');
    } else if (provider === 'groq') {
      console.log('  Get a free key at: https://console.groq.com/keys');
    } else if (provider === 'deepseek') {
      console.log('  Get a key at: https://platform.deepseek.com/api_keys');
    }
    apiKey = await ask('  API key: ');
    if (!apiKey) {
      console.log('  No key provided. You can add it later in ~/.xela/config.json');
      apiKey = '';
    }
  }

  mkdirSync(XELA_HOME, { recursive: true });
  const config = { provider, apiKey, model: '', baseUrl: '' };
  writeFileSync(XELA_CONFIG, JSON.stringify(config, null, 2));
  console.log('');
  console.log(`  Saved to ${XELA_CONFIG}`);
  console.log('  You can edit it anytime: nano ~/.xela/config.json');
  console.log('');
  return config;
}

// Load or create config
let config = {};
if (!existsSync(XELA_CONFIG)) {
  config = await setup();
} else {
  try {
    config = JSON.parse(readFileSync(XELA_CONFIG, 'utf-8'));
  } catch {}
  // If key is still placeholder, run setup again
  if (!config.apiKey || config.apiKey === 'sk-or-your-key-here') {
    config = await setup();
  }
}

const provider = config.provider || 'openrouter';
const providerInfo = PROVIDERS[provider] || PROVIDERS.openrouter;

// Set env vars
if (config.apiKey) {
  process.env.OPENAI_API_KEY = config.apiKey;
}
if (!process.env.OPENAI_BASE_URL) {
  process.env.OPENAI_BASE_URL = config.baseUrl || providerInfo.baseUrl;
}
if (!process.env.OPENAI_MODEL) {
  process.env.OPENAI_MODEL = config.model || providerInfo.model || 'gpt-4o';
}

// Handle -m/--model flag
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if ((args[i] === '-m' || args[i] === '--model') && args[i + 1]) {
    process.env.OPENAI_MODEL = args[i + 1];
    args.splice(i, 2);
    i--;
  }
}

// Launch node with the TSX loader shim
try {
  execFileSync(process.execPath, [
    '--import', join(INSTALL_DIR, 'src', '_shims', 'register.js'),
    join(INSTALL_DIR, 'start.js'),
    ...args,
  ], { stdio: 'inherit', env: process.env });
} catch (e) {
  process.exit(e.status || 1);
}
