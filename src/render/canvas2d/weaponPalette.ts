import type { DamageType } from '../../core/world'
import type { Team } from '../../core/types'
/** Shared by projectiles, ray weapons, their muzzle and aiming cues. */
export function weaponPalette(team: Team, type: DamageType, remaining: number, power: number) {
  const energy = Math.max(0, Math.min(1, remaining)), strength = Math.min(18, Math.log2(1 + Math.max(0, power)))
  const base = type === 'electric' ? 185 : type === 'heat' ? 28 : 205
  const hue = (team === 'player' ? base + 38 * (1 - energy) + strength : team === 'neutral' ? 45 + strength : type === 'electric' ? 275 + 20 * energy : 350 + 25 * (1 - energy)) % 360
  return { hue, color: `hsl(${hue}, 94%, ${39 + 40 * energy}%)`, halo: `hsla(${hue}, 96%, ${48 + 24 * energy}%, ${0.07 + 0.3 * energy})` }
}
