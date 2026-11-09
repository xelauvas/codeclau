// CJS stub for missing/DCE'd modules.
//
// Named exports resolve to `undefined`, so feature-gated code written as
// `feature('X') ? require('./mod.js').Thing : null` degrades to "feature
// absent" instead of receiving a no-op function that the app then treats as a
// real tool, task or command (which used to break startup silently).
// The default export is '' for text-file imports (.txt/.md), and the object is
// still callable (returns '') for code that invokes the module itself.
// Stub function by name: predicates stay false, getters/loaders yield nothing,
// transform-style helpers (project/apply/convert...) pass their input through.
function stubFunctionFor(name) {
  if (/^(is|has|should|can|was|needs|allow|supports|uses|matches|includes|contains)[A-Z_]/.test(name)) return () => false;
  if (/^(get|find|read|load|fetch|resolve|create|build|make|compute|calculate|extract|lookup|select|detect)[A-Z_]/.test(name)) return () => undefined;
  return (x) => x;
}
const noop = (x) => x;

function makeStub(spec) {
  return new Proxy(noop, {
  get(target, prop) {
    if (prop === '__makeStub') return makeStub;
    if (prop === '__esModule') return true;
    if (prop === 'default') return '';
    if (prop === 'then') return undefined; // Not a Promise
    if (prop === Symbol.toPrimitive) return () => '';
    if (prop === Symbol.iterator) return undefined;
    if (prop === Symbol.asyncIterator) return undefined;
    // String methods keep working for code that treats the module as text
    if (typeof ''[prop] === 'function') return String.prototype[prop].bind('');
    if (process.env.XELA_LOADER_DEBUG) {
      process.stderr.write(`[require] STUB property ${String(prop)} requested from missing module ${spec}\n`);
    }
    // PascalCase names are classes, tools, tasks, components: `undefined` lets
    // `feature('X') ? require(m).Thing : null` skip them. camelCase names are
    // functions: an inert no-op keeps `isFooEnabled()`-style checks falsy.
    if (typeof prop === 'string' && /^[A-Z]/.test(prop)) return undefined;
    return typeof prop === 'string' ? stubFunctionFor(prop) : noop;
  },
  apply() { return ''; },
  });
}

const stub = makeStub('(unknown)');
module.exports = stub;
module.exports.__makeStub = makeStub;
