import type { Command } from '../../commands.js'

export type SkillIndexEntry = {
  name: string
  description: string
  /** lowercased tokens of name + description, with a name-weight prefix */
  tokens: Map<string, number>
  loadedFrom?: string
}

export type SkillHit = { name: string; description: string; score: number }

const STOP = new Set(
  'the a an and or of to in on for with is are be this that it as at by from into your you my our we i me do does how what which when where can should would could please make use using about need want like just also then than over under not no yes if else all any some more most very really'.split(
    ' ',
  ),
)

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9àâîșşțţăéèêë\-_/\s]/g, ' ')
    .split(/[\s/_\-]+/)
    .map(t => t.trim())
    .filter(t => t.length > 2 && !STOP.has(t))
    .map(stem)
}

// Tiny stemmer: enough to match "testing" with "tests" and "deploying" with "deploy"
function stem(word: string): string {
  return word
    .replace(/(ations?|ing|ers?|ed|es|s)$/u, (m, _g, offset) => (offset > 3 ? '' : m))
}

let cache: { key: string; index: SkillIndexEntry[] } | null = null

function indexKey(commands: Command[]): string {
  return commands.map(c => c.name).join('|')
}

/** Lexical index over prompt-type commands (skills). Memoized per command set. */
export function getSkillIndex(commands: Command[]): SkillIndexEntry[] {
  const key = indexKey(commands)
  if (cache && cache.key === key) return cache.index
  const index: SkillIndexEntry[] = []
  for (const c of commands) {
    if (c.type !== 'prompt') continue
    if ((c as { isHidden?: boolean }).isHidden) continue
    const description = c.description ?? ''
    const tokens = new Map<string, number>()
    for (const t of tokenize(c.name.replace(/[:]/g, ' '))) tokens.set(t, (tokens.get(t) ?? 0) + 2)
    for (const t of tokenize(description)) tokens.set(t, (tokens.get(t) ?? 0) + 1)
    index.push({
      name: c.name,
      description,
      tokens,
      loadedFrom: (c as { loadedFrom?: string }).loadedFrom ?? (c as { source?: string }).source,
    })
  }
  cache = { key, index }
  return index
}

export function clearSkillIndexCache(): void {
  cache = null
}

/**
 * Scores skills against a query: sum of matched token weights, scaled by
 * inverse document frequency so generic words ("code", "file") count less.
 */
export function searchSkills(
  query: string,
  commands: Command[],
  options: { limit?: number; minScore?: number; exclude?: Set<string> } = {},
): SkillHit[] {
  const index = getSkillIndex(commands)
  const q = tokenize(query)
  if (q.length === 0 || index.length === 0) return []
  const df = new Map<string, number>()
  for (const entry of index) for (const t of entry.tokens.keys()) df.set(t, (df.get(t) ?? 0) + 1)
  const n = index.length
  const hits: SkillHit[] = []
  for (const entry of index) {
    if (options.exclude?.has(entry.name)) continue
    let score = 0
    for (const t of new Set(q)) {
      const w = entry.tokens.get(t)
      if (!w) continue
      const idf = Math.log(1 + n / (df.get(t) ?? 1))
      score += w * idf
    }
    if (score > 0) hits.push({ name: entry.name, description: entry.description, score })
  }
  hits.sort((a, b) => b.score - a.score)
  const minScore = options.minScore ?? 3
  return hits.filter(h => h.score >= minScore).slice(0, options.limit ?? 5)
}
