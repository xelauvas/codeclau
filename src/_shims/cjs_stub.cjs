// CJS stub for missing/DCE'd modules
// Returns safe defaults for any property access
const noop = () => {};

// Make a string-like object that also works as a function
const stub = new Proxy(noop, {
  get(target, prop) {
    if (prop === '__esModule') return true;
    // .default should return empty string (for text file imports like .txt/.md)
    if (prop === 'default') return '';
    if (prop === 'then') return undefined; // Not a Promise
    if (prop === Symbol.toPrimitive) return () => '';
    if (prop === Symbol.iterator) return undefined;
    if (prop === Symbol.asyncIterator) return undefined;
    // String methods should work (trimEnd, etc.)
    if (typeof ''[prop] === 'function') return String.prototype[prop].bind('');
    // Return a no-op function for any other property
    return noop;
  },
  apply() { return ''; },
});

module.exports = stub;
