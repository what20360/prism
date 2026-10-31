import type { Intent } from '../core/controller'
import type { Snapshot } from '../core/snapshot'
import type { IntentSource } from '../input/keyboard'
import type { PointerSource } from '../input/pointer'
import type { TouchSource } from '../input/touch'
import type { Renderer } from '../render/canvas2d/renderer'
import { DEFAULT_SETTINGS, type ControlSettings } from '../storage/config'
/** Authors input from the viewer's snapshot; remote clients never author positions. */
export function readDuelIntent(snapshot: Snapshot, input: IntentSource, pointer: PointerSource, touch: TouchSource, renderer: Renderer, settings: ControlSettings = DEFAULT_SETTINGS): Intent {
  const actor = snapshot.actors.find((a) => a.team === 'player')
  if (!actor?.alive) return { move: { x: 0, y: 0 }, fire: false }
  const keys = input.read(), fingers = touch.read(), mouse = pointer.position(), focus = { x: actor.x, y: actor.y, vision: actor.vision }
  const point = mouse ? renderer.viewToWorld(mouse.x, mouse.y, focus) : undefined
  const delta = point ? { x: point.x - actor.x, y: point.y - actor.y } : undefined
  const length = delta ? Math.hypot(delta.x, delta.y) : 0
  const move = Math.hypot(fingers.move.x, fingers.move.y) > 0 ? fingers.move : keys.move
  const aim = fingers.aim ?? (delta && length >= 1 ? { x: delta.x / length, y: delta.y / length } : { x: Math.cos(actor.aimAngle), y: Math.sin(actor.aimAngle) })
  let lockTarget: number | null | undefined
  const selection = pointer.consumeLock?.()
  if (selection !== undefined) {
    const pos = selection ? renderer.viewToWorld(selection.x, selection.y, focus) : null
    lockTarget = pos ? snapshot.actors.find((a) => a.team !== 'player' && a.alive && Math.hypot(a.x - pos.x, a.y - pos.y) <= a.radius + 16)?.id ?? null : null
  }
  return { move, aim, fire: Boolean(actor.autoFire && settings.fireMode === 'auto' || pointer.firing() || fingers.fire), placeMine: keys.placeMine || fingers.placeMine,
    autoAim: actor.autoAim && settings.aimMode === 'auto', autoPickup: settings.autoPickup !== false, lockTarget, skills: [...new Set([...(keys.skills ?? []), ...(fingers.skills ?? []), ...(keys.skill === undefined ? [] : [keys.skill])])] }
}
