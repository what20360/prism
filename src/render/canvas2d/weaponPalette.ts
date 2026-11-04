import type { DamageType } from '../../core/world'
import type { Team } from '../../core/types'
/** Shared by projectiles, ray weapons, their muzzle and aiming cues. */
export function weaponPalette(team: Team, type: DamageType, remaining: number, power: number) {
  const energy = Math.max(0, Math.min(1, remaining)), strength = Math.min(18, Math.log2(1 + Math.max(0, power)))
  const base = type === 'electric' ? 185 : type === 'heat' ? 28 : 205
  const hue = (team === 'player' ? base + 38 * (1 - energy) + strength : team === 'neutral' ? 45 + strength : type === 'electric' ? 275 + 20 * energy : 350 + 25 * (1 - energy)) % 360
  return { hue, energy, alpha: 0.16 + 0.84 * Math.sqrt(energy), color: `hsl(${hue}, ${18 + 78 * energy}%, ${94 - 23 * energy}%)`, halo: `hsla(${hue}, 96%, 75%, ${0.03 + 0.28 * energy})` }
}
