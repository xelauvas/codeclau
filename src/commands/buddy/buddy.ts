import { companionUserId, getCompanion, roll } from '../../buddy/companion.js'
import { RARITY_STARS, type StoredCompanion } from '../../buddy/types.js'
import type { LocalCommandCall } from '../../types/command.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'

const NAMES = [
  'Pixel', 'Mochi', 'Biscuit', 'Noodle', 'Pebble', 'Waffle', 'Comet', 'Tofu', 'Ziggy', 'Maple',
  'Bagel', 'Clover', 'Dot', 'Fig', 'Juniper', 'Kiwi', 'Lumen', 'Nimbus', 'Olive', 'Quill',
]

const PERSONALITIES = [
  'quietly curious, hums while you compile, delighted by a green test run',
  'dramatic about typos, loyal to tabs, secretly proud of every commit',
  'calm and deliberate, counts semicolons for fun, allergic to force-push',
  'chaotic optimist, cheers for every build, naps during long installs',
  'dry wit, keeps a mental list of TODOs you forgot, forgives merge conflicts',
  'tiny perfectionist, loves a tidy diff, sighs at console.log left behind',
  'warm and encouraging, believes every bug is just a feature that got lost',
  'nocturnal, sharpest after midnight, suspicious of regexes that work first try',
]

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function hatch(): StoredCompanion {
  const seed = hash(companionUserId() + ':soul')
  return {
    name: NAMES[seed % NAMES.length]!,
    personality: PERSONALITIES[(seed >>> 8) % PERSONALITIES.length]!,
    hatchedAt: Date.now(),
  }
}

function describe(): string {
  const c = getCompanion()
  if (!c) return 'No companion yet. Run `/buddy` to hatch one.'
  const muted = getGlobalConfig().companionMuted ? ' (muted)' : ''
  const stats = Object.entries(c.stats)
    .map(([k, v]) => `${k} ${v}`)
    .join(' · ')
  return [
    `${c.name}${muted} — ${c.shiny ? 'shiny ' : ''}${c.rarity} ${c.species} ${RARITY_STARS[c.rarity]}`,
    `Eyes: ${c.eye} · hat: ${c.hat}`,
    `Personality: ${c.personality}`,
    `Stats: ${stats}`,
    `Hatched ${new Date(c.hatchedAt).toLocaleDateString()}. Commands: /buddy rename <name>, /buddy mute, /buddy unmute, /buddy release`,
  ].join('\n')
}

export const call: LocalCommandCall = async args => {
  const [action, ...rest] = (args || '').trim().split(/\s+/).filter(Boolean)
  const config = getGlobalConfig()
  switch ((action || '').toLowerCase()) {
    case 'rename': {
      const name = rest.join(' ').trim()
      if (!config.companion) return { type: 'text', value: 'No companion to rename. Run `/buddy` first.' }
      if (!name) return { type: 'text', value: 'Usage: /buddy rename <name>' }
      saveGlobalConfig(prev => ({ ...prev, companion: { ...prev.companion!, name: name.slice(0, 24) } }))
      return { type: 'text', value: `Renamed to ${name.slice(0, 24)}.\n\n${describe()}` }
    }
    case 'mute':
      saveGlobalConfig(prev => ({ ...prev, companionMuted: true }))
      return { type: 'text', value: 'Companion muted. `/buddy unmute` brings it back.' }
    case 'unmute':
      saveGlobalConfig(prev => ({ ...prev, companionMuted: false }))
      return { type: 'text', value: describe() }
    case 'release':
      if (!config.companion) return { type: 'text', value: 'No companion to release.' }
      saveGlobalConfig(prev => ({ ...prev, companion: undefined, companionMuted: undefined }))
      return { type: 'text', value: 'Released. Run `/buddy` to hatch a new one (same bones, new soul).' }
    default: {
      if (config.companion) return { type: 'text', value: describe() }
      const soul = hatch()
      saveGlobalConfig(prev => ({ ...prev, companion: soul, companionMuted: false }))
      const { bones } = roll(companionUserId())
      return {
        type: 'text',
        value: `An egg cracks… it's a ${bones.shiny ? 'shiny ' : ''}${bones.rarity} ${bones.species} ${RARITY_STARS[bones.rarity]}!\n\n${describe()}`,
      }
    }
  }
}
