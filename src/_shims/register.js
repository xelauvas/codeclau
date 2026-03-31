// Register our custom ESM loader
import { register } from 'node:module';
import { createRequire } from 'node:module';
register('./loader.js', import.meta.url);

// Provide a global `require` for CJS-style requires in ESM context
// (Bun supports this but Node ESM doesn't)
import { dirname, resolve, extname } from 'node:path';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
import Module from 'node:module';

const baseRequire = createRequire(import.meta.url);
const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Register .ts and .tsx handlers for CJS require
const cjsTranspile = (module, filename) => {
  const code = readFileSync(filename, 'utf-8');
  const { code: compiled } = transformSync(code, {
    loader: filename.endsWith('.tsx') ? 'tsx' : 'ts',
    format: 'cjs',
    target: 'node22',
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    sourcefile: filename,
    define: { 'import.meta.url': JSON.stringify('file://' + filename) },
  });
  module._compile(compiled, filename);
};

Module._extensions['.ts'] = cjsTranspile;
Module._extensions['.tsx'] = cjsTranspile;

// Patch Module._resolveFilename to handle bun:bundle and .js → .ts resolution
const origResolve = Module._resolveFilename;
const BUN_BUNDLE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), 'bun_bundle.js');
const REACT_COMPILER_PATH = resolve(dirname(fileURLToPath(import.meta.url)), 'react_compiler_runtime.js');

Module._resolveFilename = function(request, parent, isMain, options) {
  // Intercept bun:bundle for CJS
  if (request === 'bun:bundle') return BUN_BUNDLE_PATH;
  if (request === 'react/compiler-runtime') return REACT_COMPILER_PATH;

  // Handle src/ prefixed imports in CJS
  if (request.startsWith('src/')) {
    const abs = resolve(SRC_ROOT, request.slice(4));
    for (const ext of ['', '.ts', '.tsx', '.js']) {
      const p = abs.replace(/\.js$/, '') + ext;
      if (existsSync(p) && statSync(p).isFile()) return p;
    }
    if (existsSync(abs) && statSync(abs).isFile()) return abs;
  }

  try {
    return origResolve.call(this, request, parent, isMain, options);
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      // Try .ts/.tsx instead of .js
      for (const ext of ['.ts', '.tsx']) {
        const tsRequest = request.replace(/\.js$/, ext);
        try { return origResolve.call(this, tsRequest, parent, isMain, options); } catch {}
      }
      // If request is relative and parent is an ESM file loaded via our loader,
      // the parent won't have a proper filename. Try resolving from SRC_ROOT.
      if (request.startsWith('./') || request.startsWith('../')) {
        // Get the calling file from the stack trace
        const stack = new Error().stack || '';
        const callerMatch = stack.match(/at [^\n]+ \(file:\/\/([^:]+):/);
        if (callerMatch) {
          const callerDir = dirname(callerMatch[1]);
          const absolute = resolve(callerDir, request);
          for (const ext of ['', '.ts', '.tsx', '.js']) {
            const p = absolute.replace(/\.js$/, '') + ext;
            if (existsSync(p) && statSync(p).isFile()) return p;
          }
          // Also try without stripping .js
          for (const ext of ['.ts', '.tsx']) {
            const p = absolute + ext;
            if (existsSync(p) && statSync(p).isFile()) return p;
          }
        }
      }
    }
    // Last resort: return CJS stub for missing modules
    // (DCE'd feature-gated code)
    const CJS_STUB_PATH = resolve(dirname(fileURLToPath(import.meta.url)), 'cjs_stub.cjs');
    return CJS_STUB_PATH;
  }
};

// Create a smart require that resolves relative paths from the caller's location
globalThis.require = function smartRequire(id) {
  // For absolute or node_modules paths, use base require
  if (!id.startsWith('.')) {
    return baseRequire(id);
  }

  // Get caller's file path from stack trace
  const origPrepare = Error.prepareStackTrace;
  Error.prepareStackTrace = (_, stack) => stack;
  const stack = new Error().stack;
  Error.prepareStackTrace = origPrepare;

  let callerFile = null;
  for (const frame of stack) {
    const fn = frame.getFileName();
    if (fn && fn !== fileURLToPath(import.meta.url) && !fn.includes('node:')) {
      callerFile = fn.startsWith('file://') ? fileURLToPath(fn) : fn;
      break;
    }
  }

  if (callerFile) {
    const callerDir = dirname(callerFile);
    const abs = resolve(callerDir, id);

    // Try exact, then .ts, .tsx
    for (const candidate of [abs, abs.replace(/\.js$/, '.ts'), abs.replace(/\.js$/, '.tsx')]) {
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        return baseRequire(candidate);
      }
    }
  }

  // Fallback to default
  return baseRequire(id);
};

// Define MACRO as a global (build-time constants)
globalThis.MACRO = {
  VERSION: '0.1.0-openai',
  BUILD_TIME: new Date().toISOString(),
  PACKAGE_URL: '',
  NATIVE_PACKAGE_URL: '',
  FEEDBACK_CHANNEL: '',
  ISSUES_EXPLAINER: '',
  VERSION_CHANGELOG: '',
};
