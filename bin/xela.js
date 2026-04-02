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
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    models: [
      'qwen/qwen3.6-plus-preview:free',
      'deepseek/deepseek-chat-v3-0324:free',
      'google/gemini-2.5-pro-exp-03-25:free',
      'meta-llama/llama-4-maverick:free',
      'nvidia/llama-3.1-nemotron-ultra-253b:free',
    ],
    default: 'qwen/qwen3.6-plus-preview:free',
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['qwen-qwq-32b', 'llama-3.3-70b-versatile', 'gemma2-9b-it', 'mixtral-8x7b-32768'],
    default: 'qwen-qwq-32b',
  },
  ollama: {
    baseUrl: 'http://localhost:11434/v1',
    models: ['qwen2.5-coder:7b', 'llama3.2:latest', 'codellama:latest', 'deepseek-coder-v2:latest'],
    default: 'qwen2.5-coder:7b',
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    default: 'deepseek-chat',
  },
  openai: {
    baseUrl: undefined,
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'o4-mini'],
    default: 'gpt-4o',
  },
  cerebras: {
    baseUrl: 'https://api.cerebras.ai/v1',
    models: ['llama-3.3-70b', 'llama-3.1-8b'],
    default: 'llama-3.3-70b',
  },
  sambanova: {
    baseUrl: 'https://api.sambanova.ai/v1',
    models: ['Meta-Llama-3.3-70B-Instruct', 'DeepSeek-R1-Distill-Llama-70B'],
    default: 'Meta-Llama-3.3-70B-Instruct',
  },
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

  // Pick model
  const providerInfo = PROVIDERS[provider];
  const models = providerInfo.models;
  console.log('');
  console.log('  Models:');
  models.forEach((m, i) => {
    const tag = m === providerInfo.default ? ' (default)' : '';
    console.log(`    ${i + 1}. ${m}${tag}`);
  });
  console.log(`    ${models.length + 1}. custom (type any model ID)`);
  console.log('');
  const modelChoice = await ask('  Pick a model [1]: ');
  const modelNum = parseInt(modelChoice) || 1;
  let model;
  if (modelNum > models.length) {
    model = await ask('  Model ID: ');
    if (!model) model = providerInfo.default;
  } else {
    model = models[Math.min(modelNum - 1, models.length - 1)];
  }

  mkdirSync(XELA_HOME, { recursive: true });
  const config = { provider, apiKey, model, baseUrl: '' };
  writeFileSync(XELA_CONFIG, JSON.stringify(config, null, 2));
  console.log('');
  console.log(`  Provider: ${provider}`);
  console.log(`  Model: ${model}`);
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
const pInfo = PROVIDERS[provider] || PROVIDERS.openrouter;

// Set env vars
if (config.apiKey) {
  process.env.OPENAI_API_KEY = config.apiKey;
}
if (!process.env.OPENAI_BASE_URL) {
  process.env.OPENAI_BASE_URL = config.baseUrl || pInfo.baseUrl;
}
if (!process.env.OPENAI_MODEL) {
  process.env.OPENAI_MODEL = config.model || pInfo.default || 'gpt-4o';
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
