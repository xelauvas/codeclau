// Custom Node.js ESM loader hooks
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { resolve as pathResolve } from 'node:path';
import { existsSync, readFileSync, statSync, readdirSync, writeFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const SRC_ROOT = pathResolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUN_BUNDLE_URL = pathToFileURL(join(SRC_ROOT, '_shims', 'bun_bundle.js')).href;
const REACT_COMPILER_URL = pathToFileURL(join(SRC_ROOT, '_shims', 'react_compiler_runtime.js')).href;

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

// Scan all files that import a given specifier to find what named exports they need
// We cache generated stubs to disk for speed
const STUB_DIR = join(SRC_ROOT, '_shims', '_generated_stubs');
try { if (!existsSync(STUB_DIR)) { const { mkdirSync } = await import('node:fs'); mkdirSync(STUB_DIR, { recursive: true }); } } catch {}

function generateStubUrl(specifier) {
  // Create a unique stub filename based on the specifier
  const safeName = specifier.replace(/[^a-zA-Z0-9]/g, '_') + '.mjs';
  const stubPath = join(STUB_DIR, safeName);

  // Find all files that import from this specifier and collect named imports
  const names = collectNamedImports(specifier);

  // Generate a module that exports all needed names with sensible defaults
  const exports = names.map(n => {
    // Heuristic: ALL_CAPS or ends with S/LIST/ARRAY → empty array
    if (/^[A-Z_]+S$/.test(n) || /TOOLS$|LIST$|ARRAY$|ITEMS$|ENTRIES$|_S$/.test(n)) {
      return `export const ${n} = [];`;
    }
    // Functions: starts with lowercase or is/has/get/set/check/handle etc.
    if (/^(is|has|get|set|check|handle|create|build|make|run|init|setup|load|parse|format|validate|render|should|can|will|do|on|emit|add|remove|update|delete|find|filter|map|reduce|sort|reset|clear|start|stop|enable|disable|register|unregister|subscribe|unsubscribe|compute|calculate|generate|convert|transform|normalize|serialize|deserialize|resolve|reject|throw|log|debug|warn|error|assert|ensure|require|import|export|with|from|to|into|of|for|by|at|in|fetch|send|post|put|patch)[A-Z]/.test(n)) {
      return `export const ${n} = () => undefined;`;
    }
    return `export const ${n} = undefined;`;
  }).join('\n');
  const source = `// Auto-generated stub for: ${specifier}\nexport default {};\n${exports}\n`;

  writeFileSync(stubPath, source);
  const url = pathToFileURL(stubPath).href;
  stubUrls.add(url);
  return url;
}

function collectNamedImports(specifier) {
  // Quick scan of source files to find named imports from this specifier
  const names = new Set();
  const pattern = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Search through known source directories
  try {
    scanDir(SRC_ROOT, pattern, names, 0);
  } catch {}

  return [...names];
}

function scanDir(dir, pattern, names, depth) {
  if (depth > 4) return;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '_shims') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(full, pattern, names, depth + 1);
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
        try {
          const content = readFileSync(full, 'utf-8');
          // Match: import { name1, name2 } from 'specifier'
          // Also: import { type X, name1 } from 'specifier'
          const regex = new RegExp(`import\\s*\\{([^}]+)\\}\\s*from\\s*['"](?:[^'"]*[/])?${pattern}(?:\\.js|\\.ts|\\.tsx|\\.mjs)?['"]`, 'g');
          let m;
          while ((m = regex.exec(content))) {
            const imports = m[1];
            // Parse individual imports, skip 'type X'
            for (const part of imports.split(',')) {
              const trimmed = part.trim();
              if (!trimmed || trimmed.startsWith('type ')) continue;
              const name = trimmed.split(/\s+as\s+/)[0].trim();
              if (name && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)) {
                names.add(name);
              }
            }
          }
          // Match: import X from 'specifier' (default import)
          // Already handled by export default {}
        } catch {}
      }
    }
  } catch {}
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'bun:bundle') {
    return { url: BUN_BUNDLE_URL, shortCircuit: true };
  }
  if (specifier === 'react/compiler-runtime') {
    return { url: REACT_COMPILER_URL, shortCircuit: true };
  }

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
    const rawSource = readFileSync(filePath, 'utf-8');

    let { code } = transformSync(rawSource, {
      loader: url.endsWith('.tsx') ? 'tsx' : 'ts',
      format: 'esm',
      target: 'node22',
      jsx: 'transform',
      jsxFactory: 'React.createElement',
      jsxFragment: 'React.Fragment',
      sourcefile: filePath,
    });

    // If the compiled code still has require() calls, inject a CJS-compatible require
    // that resolves relative to this file's directory
    if (code.includes('require(') || code.includes('require.resolve(')) {
      const preamble = `
import { createRequire as __createRequire } from 'node:module';
const require = __createRequire(import.meta.url);
`;
      code = preamble + code;
    }

    return { format: 'module', source: code, shortCircuit: true };
  }

  return nextLoad(url, context);
}
