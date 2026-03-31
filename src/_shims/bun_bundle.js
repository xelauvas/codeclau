// Shim for bun:bundle - replaces build-time feature flags with runtime config
// All features default to false (minimal external build)
const ENABLED_FEATURES = new Set([
  // Only enable what's absolutely needed for basic REPL
]);

export function feature(name) {
  return ENABLED_FEATURES.has(name);
}
