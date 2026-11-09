/**
 * YAML parsing wrapper.
 *
 * Uses Bun.YAML when running under Bun, the `yaml` npm package when it is
 * installed, and otherwise a built-in parser for the YAML subset that skill
 * frontmatter and plugin manifests use (block mappings and sequences, flow
 * arrays, quoted/plain scalars, `|` and `>` block scalars, comments). Before
 * this fallback existed a missing package silently produced empty frontmatter,
 * so every skill lost its description.
 */

export function parseYaml(input: string): unknown {
  if (typeof Bun !== 'undefined') {
    return Bun.YAML.parse(input)
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('yaml') as { parse?: (s: string) => unknown }
    if (mod && typeof mod.parse === 'function') {
      const out = mod.parse(input)
      // The missing-module stub returns its argument unchanged
      if (out !== input) return out
    }
  } catch {
    // fall through to the built-in parser
  }
  return parseYamlSubset(input)
}

type Line = { indent: number; text: string; raw: string }

function splitLines(input: string): Line[] {
  const lines: Line[] = []
  for (const raw of input.replace(/\r\n?/g, '\n').split('\n')) {
    const text = stripComment(raw).replace(/\s+$/, '')
    if (text.trim() === '') continue
    const indent = raw.length - raw.replace(/^[ \t]*/, '').length
    lines.push({ indent, text: text.trim(), raw })
  }
  return lines
}

function stripComment(line: string): string {
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === "'" && !inDouble) inSingle = !inSingle
    else if (ch === '"' && !inSingle) inDouble = !inDouble
    else if (ch === '#' && !inSingle && !inDouble && (i === 0 || /\s/.test(line[i - 1]!))) {
      return line.slice(0, i)
    }
  }
  return line
}

function parseScalar(text: string): unknown {
  const t = text.trim()
  if (t === '' || t === '~' || t === 'null' || t === 'Null' || t === 'NULL') return null
  if (t === 'true' || t === 'True' || t === 'TRUE') return true
  if (t === 'false' || t === 'False' || t === 'FALSE') return false
  if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(t)) return Number(t)
  if (/^0x[0-9a-fA-F]+$/.test(t)) return parseInt(t, 16)
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
    try {
      return JSON.parse(t)
    } catch {
      return t.slice(1, -1)
    }
  }
  if (t.startsWith("'") && t.endsWith("'") && t.length >= 2) {
    return t.slice(1, -1).replace(/''/g, "'")
  }
  if (t.startsWith('[') && t.endsWith(']')) return parseFlowArray(t)
  if (t.startsWith('{') && t.endsWith('}')) return parseFlowMap(t)
  return t
}

function splitFlow(inner: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote: string | null = null
  let current = ''
  for (const ch of inner) {
    if (quote) {
      current += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
    } else if (ch === '[' || ch === '{') {
      depth++
      current += ch
    } else if (ch === ']' || ch === '}') {
      depth--
      current += ch
    } else if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim() !== '') parts.push(current)
  return parts
}

function parseFlowArray(text: string): unknown[] {
  const inner = text.slice(1, -1).trim()
  if (inner === '') return []
  return splitFlow(inner).map(p => parseScalar(p))
}

function parseFlowMap(text: string): Record<string, unknown> {
  const inner = text.slice(1, -1).trim()
  const out: Record<string, unknown> = {}
  if (inner === '') return out
  for (const part of splitFlow(inner)) {
    const idx = part.indexOf(':')
    if (idx < 0) continue
    out[parseScalar(part.slice(0, idx)) as string] = parseScalar(part.slice(idx + 1))
  }
  return out
}

/** Splits "key: value" at the first colon that is followed by a space or end. */
function splitKeyValue(text: string): { key: string; value: string } | null {
  let quote: string | null = null
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === ':' && (i === text.length - 1 || text[i + 1] === ' ')) {
      return { key: String(parseScalar(text.slice(0, i))), value: text.slice(i + 1).trim() }
    }
  }
  return null
}

function parseBlock(lines: Line[], start: number, indent: number): { value: unknown; next: number } {
  if (start >= lines.length) return { value: null, next: start }
  if (lines[start]!.text.startsWith('- ') || lines[start]!.text === '-') {
    return parseSequence(lines, start, indent)
  }
  return parseMapping(lines, start, indent)
}

function parseBlockScalar(lines: Line[], start: number, indent: number, style: '|' | '>'): { value: string; next: number } {
  const collected: string[] = []
  let i = start
  let base = -1
  while (i < lines.length && lines[i]!.indent > indent) {
    const raw = lines[i]!.raw.replace(/\s+$/, '')
    if (base < 0) base = lines[i]!.indent
    collected.push(raw.slice(Math.min(base, raw.length - raw.trimStart().length)))
    i++
  }
  const text = style === '|' ? collected.join('\n') : collected.join(' ').replace(/\s+/g, ' ')
  return { value: text, next: i }
}

function parseMapping(lines: Line[], start: number, indent: number): { value: Record<string, unknown>; next: number } {
  const out: Record<string, unknown> = {}
  let i = start
  while (i < lines.length) {
    const line = lines[i]!
    if (line.indent < indent) break
    if (line.indent > indent) {
      i++
      continue
    }
    const kv = splitKeyValue(line.text)
    if (!kv) {
      i++
      continue
    }
    if (kv.value === '' ) {
      // nested block or empty
      if (i + 1 < lines.length && lines[i + 1]!.indent > indent) {
        const nested = parseBlock(lines, i + 1, lines[i + 1]!.indent)
        out[kv.key] = nested.value
        i = nested.next
      } else if (i + 1 < lines.length && lines[i + 1]!.indent === indent && lines[i + 1]!.text.startsWith('- ')) {
        // sequence at the same indentation as its key (common YAML style)
        const nested = parseSequence(lines, i + 1, indent)
        out[kv.key] = nested.value
        i = nested.next
      } else {
        out[kv.key] = null
        i++
      }
    } else if (kv.value === '|' || kv.value === '>' || kv.value === '|-' || kv.value === '>-') {
      const block = parseBlockScalar(lines, i + 1, indent, kv.value[0] as '|' | '>')
      out[kv.key] = kv.value.endsWith('-') ? block.value.replace(/\n+$/, '') : block.value
      i = block.next
    } else {
      out[kv.key] = parseScalar(kv.value)
      i++
    }
  }
  return { value: out, next: i }
}

function parseSequence(lines: Line[], start: number, indent: number): { value: unknown[]; next: number } {
  const out: unknown[] = []
  let i = start
  while (i < lines.length) {
    const line = lines[i]!
    if (line.indent < indent) break
    if (line.indent > indent || !(line.text.startsWith('- ') || line.text === '-')) {
      i++
      continue
    }
    const rest = line.text === '-' ? '' : line.text.slice(2).trim()
    if (rest === '') {
      if (i + 1 < lines.length && lines[i + 1]!.indent > indent) {
        const nested = parseBlock(lines, i + 1, lines[i + 1]!.indent)
        out.push(nested.value)
        i = nested.next
      } else {
        out.push(null)
        i++
      }
      continue
    }
    const kv = splitKeyValue(rest)
    if (kv && !rest.startsWith('"') && !rest.startsWith("'") && !rest.startsWith('[') && !rest.startsWith('{')) {
      // "- key: value" starts an inline mapping whose other keys follow at indent + 2
      const item: Record<string, unknown> = {}
      item[kv.key] = kv.value === '' ? null : parseScalar(kv.value)
      let j = i + 1
      const childIndent = indent + 2
      if (j < lines.length && lines[j]!.indent >= childIndent) {
        const more = parseMapping(lines, j, lines[j]!.indent)
        Object.assign(item, more.value)
        j = more.next
      }
      out.push(item)
      i = j
    } else {
      out.push(parseScalar(rest))
      i++
    }
  }
  return { value: out, next: i }
}

export function parseYamlSubset(input: string): unknown {
  const lines = splitLines(input)
  if (lines.length === 0) return null
  const first = lines[0]!
  return parseBlock(lines, 0, first.indent).value
}
