// Wildcard stub for DCE'd modules
// Uses a Proxy on module.exports so ANY named import resolves to undefined
// For ESM: we export common names that appear in the codebase
const _u = undefined;
const _f = () => {};
const _a = [];
const _o = {};
const _s = '';
const _n = 0;
const _false = false;

// Re-export everything as undefined stubs
export default _o;

// Common exports used across the codebase
export { _u as WORKFLOW_TOOL_NAME };
export { _u as TUNGSTEN_TOOL_NAME };
export { _u as isReplBridgeActive };
export { _u as connectorTextType };
export { _u as ConnectorTextType };
export { _f as buildComputerUseTools };
export { _f as bindSessionContext };
export { _f as getSentinelCategory };
export { _o as DEFAULT_GRANT_FLAGS };
export { _o as API_RESIZE_PARAMS };
export { _f as targetImageSize };
export { _o as PermissionMode };
export { _o as McpbManifest };
export { _o as CoordinateMode };
export { _o as CuSubGates };
export { _a as BROWSER_TOOLS };
export { _o as ComputerUseAPI };
export { _f as resourceFromAttributes };
