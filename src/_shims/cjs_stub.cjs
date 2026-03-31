// CJS stub for missing/DCE'd modules
// Returns no-op functions for any property access
const noop = () => {};
noop.default = noop;

module.exports = new Proxy(noop, {
  get(target, prop) {
    if (prop === '__esModule') return true;
    if (prop === 'default') return target;
    if (prop === 'then') return undefined; // Not a Promise
    if (prop === Symbol.toPrimitive) return () => '';
    if (prop === Symbol.iterator) return undefined;
    if (prop === Symbol.asyncIterator) return undefined;
    // Return a no-op function for any property
    return noop;
  },
  apply() { return noop; },
});
