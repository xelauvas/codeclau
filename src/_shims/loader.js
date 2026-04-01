// Custom Node.js ESM loader hooks
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { resolve as pathResolve } from 'node:path';
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { createHash } from 'node:crypto';

const SRC_ROOT = pathResolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUN_BUNDLE_URL = pathToFileURL(join(SRC_ROOT, '_shims', 'bun_bundle.js')).href;
const REACT_COMPILER_URL = pathToFileURL(join(SRC_ROOT, '_shims', 'react_compiler_runtime.js')).href;

// --- Transpilation cache ---
const TRANSPILE_CACHE_DIR = pathResolve(SRC_ROOT, '..', '.cache', 'transpile');
try { mkdirSync(TRANSPILE_CACHE_DIR, { recursive: true }); } catch {}

function transpileCacheKey(filePath, stat) {
  return createHash('md5').update(filePath + ':' + stat.mtimeMs + ':' + stat.size).digest('hex');
}

// Track which URLs are stubs so we know in load()
const stubUrls = new Set();

function isFile(p) {
  try { return statSync(p).isFile(); } catch { return false; }
}

function tryResolveFile(base) {
  if (isFile(base)) return base;
  // Try adding extensions
  for (const ext of ['.ts', '.tsx', '.js', '.mjs', '.jsx', '.md']) {
    if (isFile(base + ext)) return base + ext;
  }
  // Strip known extensions and try alternatives
  const noExt = base.replace(/\.(js|mjs|jsx|ts|tsx)$/, '');
  if (noExt !== base) {
    for (const ext of ['.ts', '.tsx', '.js', '.mjs', '.jsx']) {
      if (isFile(noExt + ext)) return noExt + ext;
    }
  }
  // Try as directory with index
  for (const idx of ['/index.ts', '/index.tsx', '/index.js']) {
    if (isFile(base + idx)) return base + idx;
    if (noExt !== base && isFile(noExt + idx)) return noExt + idx;
  }
  return null;
}

// --- Universal stub for unresolved modules ---
// Instead of scanning 1887+ files to find named imports, we pre-generate a single
// universal stub that exports ALL known names as undefined/noop/[]. This avoids
// the expensive recursive directory scan on every startup.
const STUB_DIR = join(SRC_ROOT, '_shims', '_generated_stubs');
try { mkdirSync(STUB_DIR, { recursive: true }); } catch {}

const UNIVERSAL_STUB_PATH = join(STUB_DIR, '_universal_stub.mjs');

// Comprehensive list of all export names collected from previously generated stubs
const UNIVERSAL_STUB_SOURCE = `// Universal stub — exports all known names for unresolved modules
export default {};

// --- Arrays (names ending in S, LIST, TOOLS, etc.) ---
export const BROWSER_TOOLS = [];
export const DEFAULT_SESSION_TIMEOUT_MS = [];
export const RARITY_COLORS = [];
export const EYES = [];
export const HATS = [];
export const RARITIES = [];
export const RARITY_WEIGHTS = [];
export const SPECIES = [];
export const STAT_NAMES = [];
export const AGENT_PATHS = [];
export const DEFAULT_GRANT_FLAGS = [];
export const MEMORY_TYPE_VALUES = [];
export const SYNC_KEYS = [];
export const CUSTOMIZATION_SURFACES = [];
export const FIND_KEYS = [];
export const OPERATORS = [];
export const SIMPLE_MOTIONS = [];
export const TEXT_OBJ_SCOPES = [];
export const TEXT_OBJ_TYPES = [];
export const SOURCES = [];
export const FRAME_INTERVAL_MS = [];
export const ONE_SHOT_BUILTIN_AGENT_TYPES = [];
export const REPL_ONLY_TOOLS = [];
export const SETTING_SOURCES = [];
export const MDM_SUBPROCESS_TIMEOUT_MS = [];

// --- Functions (is/has/get/set/create/handle...) ---
export const isBackgroundTask = () => undefined;
export const isInProcessTeammateTask = () => undefined;
export const isMcpServerCommandEntry = () => undefined;
export const isMcpServerNameEntry = () => undefined;
export const isMcpServerUrlEntry = () => undefined;
export const isPaneBackend = () => undefined;
export const isOperatorKey = () => undefined;
export const isTextObjScopeKey = () => undefined;
export const isReplModeEnabled = () => undefined;
export const isSettingSourceEnabled = () => undefined;
export const getSourceDisplayName = () => undefined;
export const getSettingSourceName = () => undefined;
export const getSwarmSocketName = () => undefined;
export const getSettingSourceDisplayNameLowercase = () => undefined;
export const getSettingSourceDisplayNameCapitalized = () => undefined;
export const getEnabledSettingSources = () => undefined;
export const getMacOSPlistPaths = () => undefined;
export const getSyntaxTheme = () => undefined;
export const createClaudeForChromeMcpServer = () => undefined;
export const createInitialPersistentState = () => undefined;
export const createInitialVimState = () => undefined;
export const parseSettingSourcesFlag = () => undefined;
export const reduceAnsiCodes = () => undefined;

// --- Constants/schemas/values ---
export const BRIDGE_LOGIN_INSTRUCTION = undefined;
export const BRIDGE_LOGIN_ERROR = undefined;
export const axolotl = undefined;
export const blob = undefined;
export const cactus = undefined;
export const capybara = undefined;
export const cat = undefined;
export const chonk = undefined;
export const dragon = undefined;
export const duck = undefined;
export const ghost = undefined;
export const goose = undefined;
export const mushroom = undefined;
export const octopus = undefined;
export const owl = undefined;
export const penguin = undefined;
export const rabbit = undefined;
export const robot = undefined;
export const snail = undefined;
export const turtle = undefined;
export const ElicitRequestSchema = undefined;
export const ElicitationCompleteNotificationSchema = undefined;
export const REMOTE_CONTROL_DISCONNECTED_MSG = undefined;
export const CallToolRequestSchema = undefined;
export const ListToolsRequestSchema = undefined;
export const defaultStyle = undefined;
export const connectResponseSchema = undefined;
export const CallToolResultSchema = undefined;
export const ErrorCode = undefined;
export const ListPromptsResultSchema = undefined;
export const ListResourcesResultSchema = undefined;
export const ListRootsRequestSchema = undefined;
export const ListToolsResultSchema = undefined;
export const McpError = undefined;
export const McpJsonConfigSchema = undefined;
export const McpServerConfigSchema = undefined;
export const PromptListChangedNotificationSchema = undefined;
export const ResourceListChangedNotificationSchema = undefined;
export const ToolListChangedNotificationSchema = undefined;
export const ConfigScopeSchema = undefined;
export const PolicyLimitsResponseSchema = undefined;
export const SettingsSchema = undefined;
export const RemoteManagedSettingsResponseSchema = undefined;
export const UserSyncDataSchema = undefined;
export const TeamMemoryDataSchema = undefined;
export const TeamMemoryTooManyEntriesSchema = undefined;
export const HooksSchema = undefined;
export const appendCappedMessage = undefined;
export const inputSchema = undefined;
export const outputSchema = undefined;
export const gitDiffSchema = undefined;
export const hunkSchema = undefined;
export const ReadResourceResultSchema = undefined;
export const TodoListSchema = undefined;
export const McpStdioServerConfigSchema = undefined;
export const DEFAULT_UPLOAD_CONCURRENCY = undefined;
export const FILE_COUNT_LIMIT = undefined;
export const OUTPUTS_SUBDIR = undefined;
export const JSONRPCMessageSchema = undefined;
export const MAX_VIM_COUNT = undefined;
export const AGENT_TOOL_NAME = undefined;
export const LEGACY_AGENT_TOOL_NAME = undefined;
export const EXIT_PLAN_MODE_V2_TOOL_NAME = undefined;
export const TEAM_CREATE_TOOL_NAME = undefined;
export const CLAUDE_FOLDER_PERMISSION_PATTERN = undefined;
export const FILE_EDIT_TOOL_NAME = undefined;
export const GLOBAL_CLAUDE_FOLDER_PERMISSION_PATTERN = undefined;
export const SKILL_TOOL_NAME = undefined;
export const TEAM_LEAD_NAME = undefined;
export const TMUX_COMMAND = undefined;
export const VERIFICATION_AGENT_TYPE = undefined;
export const TODO_WRITE_TOOL_NAME = undefined;
export const TASK_CREATE_TOOL_NAME = undefined;
export const TASK_OUTPUT_TOOL_NAME = undefined;
export const ENTER_PLAN_MODE_TOOL_NAME = undefined;
export const NOTEBOOK_EDIT_TOOL_NAME = undefined;
export const SEND_MESSAGE_TOOL_NAME = undefined;
export const TASK_GET_TOOL_NAME = undefined;
export const TASK_LIST_TOOL_NAME = undefined;
export const TASK_UPDATE_TOOL_NAME = undefined;
export const ENTER_WORKTREE_TOOL_NAME = undefined;
export const EXIT_WORKTREE_TOOL_NAME = undefined;
export const WORKFLOW_TOOL_NAME = undefined;
export const TEAM_DELETE_TOOL_NAME = undefined;
export const ContinuousEventPriority = undefined;
export const DefaultEventPriority = undefined;
export const DiscreteEventPriority = undefined;
export const NoEventPriority = undefined;
export const ConcurrentRoot = undefined;
export const LegacyRoot = undefined;
export const REPL_TOOL_NAME = undefined;
export const EXIT_PLAN_MODE_TOOL_NAME = undefined;
export const CONFIG_TOOL_NAME = undefined;
export const FILE_UNEXPECTEDLY_MODIFIED_ERROR = undefined;
export const TOOL_SEARCH_TOOL_NAME = undefined;
export const SWARM_SESSION_NAME = undefined;
export const TEAMMATE_COMMAND_ENV_VAR = undefined;
export const PLUTIL_ARGS_PREFIX = undefined;
export const PLUTIL_PATH = undefined;
export const WINDOWS_REGISTRY_KEY_PATH_HKCU = undefined;
export const WINDOWS_REGISTRY_KEY_PATH_HKLM = undefined;
export const WINDOWS_REGISTRY_VALUE_NAME = undefined;
export const CLAUDE_CODE_SETTINGS_SCHEMA_URL = undefined;
export const HIDDEN_SESSION_NAME = undefined;
export const SWARM_VIEW_WINDOW_NAME = undefined;
export const ColorDiff = undefined;
export const ColorFile = undefined;
export const ansiCodesToString = undefined;
export const diffAnsiCodes = undefined;
export const styledCharsFromTokens = undefined;
export const tokenize = undefined;
export const undoAnsiCodes = undefined;
`;

// Write the universal stub once at startup
try { writeFileSync(UNIVERSAL_STUB_PATH, UNIVERSAL_STUB_SOURCE); } catch {}
const UNIVERSAL_STUB_URL = pathToFileURL(UNIVERSAL_STUB_PATH).href;
stubUrls.add(UNIVERSAL_STUB_URL);

function generateStubUrl(_specifier) {
  return UNIVERSAL_STUB_URL;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'bun:bundle') {
    return { url: BUN_BUNDLE_URL, shortCircuit: true };
  }
  // react/compiler-runtime is provided natively by React 19 — don't intercept

  // Handle src/ prefixed imports
  if (specifier.startsWith('src/')) {
    const base = join(SRC_ROOT, specifier.slice(4));
    const resolved = tryResolveFile(base);
    if (resolved) {
      return { url: pathToFileURL(resolved).href, shortCircuit: true };
    }
    const stubUrl = generateStubUrl(specifier);
    return { url: stubUrl, shortCircuit: true };
  }

  // Handle relative imports
  if (specifier.startsWith('.') && context.parentURL) {
    const parentDir = dirname(fileURLToPath(context.parentURL));
    const candidate = pathResolve(parentDir, specifier);
    const resolved = tryResolveFile(candidate);
    if (resolved) {
      return { url: pathToFileURL(resolved).href, shortCircuit: true };
    }
    // If it's a text file import (Bun text loader), return a string stub
    if (/\.(md|txt|css|html|svg|xml)$/i.test(specifier)) {
      const textStubPath = join(STUB_DIR, 'text_stub.mjs');
      if (!isFile(textStubPath)) {
        writeFileSync(textStubPath, `export default '';\n`);
      }
      return { url: pathToFileURL(textStubPath).href, shortCircuit: true };
    }
    // Extract the basename for stub generation
    const stubUrl = generateStubUrl(specifier.split('/').pop().replace(/\.\w+$/, ''));
    return { url: stubUrl, shortCircuit: true };
  }

  // npm packages
  try {
    const result = await nextResolve(specifier, context);
    return result;
  } catch (err) {
    const stubUrl = generateStubUrl(specifier.split('/').pop() || specifier);
    return { url: stubUrl, shortCircuit: true };
  }
}

export function load(url, context, nextLoad) {
  // Handle .md/.txt imports (Bun text loader) — export content as default string
  if (url.endsWith('.md') || url.endsWith('.txt')) {
    let text = '';
    try { text = readFileSync(fileURLToPath(url), 'utf-8'); } catch {}
    return { format: 'module', source: `export default ${JSON.stringify(text)};`, shortCircuit: true };
  }

  if (url.endsWith('.ts') || url.endsWith('.tsx')) {
    const filePath = fileURLToPath(url);
    const fileStat = statSync(filePath);
    const cacheHash = transpileCacheKey(filePath, fileStat);
    const cachePath = join(TRANSPILE_CACHE_DIR, cacheHash + '.mjs');

    // Check transpilation cache first
    let code;
    if (existsSync(cachePath)) {
      code = readFileSync(cachePath, 'utf-8');
    } else {
      const rawSource = readFileSync(filePath, 'utf-8');

      ({ code } = transformSync(rawSource, {
        loader: url.endsWith('.tsx') ? 'tsx' : 'ts',
        format: 'esm',
        target: 'node22',
        jsx: 'transform',
        jsxFactory: 'React.createElement',
        jsxFragment: 'React.Fragment',
        sourcefile: filePath,
      }));

      // If the compiled code still has require() calls, inject a CJS-compatible require
      // that resolves relative to this file's directory
      if (code.includes('require(') || code.includes('require.resolve(')) {
        const preamble = `
import { createRequire as __createRequire } from 'node:module';
const require = __createRequire(import.meta.url);
`;
        code = preamble + code;
      }

      // Write to cache (fire-and-forget is fine, but use sync for simplicity)
      try { writeFileSync(cachePath, code); } catch {}
    }

    return { format: 'module', source: code, shortCircuit: true };
  }

  // For .js files: try default loader first, but if it fails on `with` syntax
  // (import attributes), strip the `with { ... }` clauses and return as module
  if (url.endsWith('.js') || url.endsWith('.mjs')) {
    try {
      return nextLoad(url, context);
    } catch (err) {
      if (err?.message?.includes('Unexpected token') && err?.message?.includes('with')) {
        const filePath = fileURLToPath(url);
        let source = readFileSync(filePath, 'utf-8');
        // Strip `with { type: 'json' }` and similar import attributes
        source = source.replace(/\swith\s*\{[^}]*\}/g, '');
        return { format: 'module', source, shortCircuit: true };
      }
      throw err;
    }
  }

  return nextLoad(url, context);
}
