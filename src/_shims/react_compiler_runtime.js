// Shim for react/compiler-runtime
// The React Compiler's `c` function creates a memoization cache for a component.
// This is a minimal implementation that provides the cache array.
import { useMemo, useRef } from 'react';

export function c(size) {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const ref = useRef(null);
  if (ref.current === null || ref.current.length !== size) {
    const cache = new Array(size);
    for (let i = 0; i < size; i++) {
      cache[i] = Symbol.for('react.memo_cache_sentinel');
    }
    ref.current = cache;
  }
  return ref.current;
}
