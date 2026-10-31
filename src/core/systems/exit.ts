import type { World } from '../world'
import { tryGetPlayer } from '../world'

/** The exit only exists once the room is cleared, and only for non-boss rooms. */
export function updateExit(world: World): void {
  const exit = world.room.exit
  if (!exit || world.exitReached) return

  const player = world.coop ? [...world.actors.values()].find((a)=>a.alive&&a.team==='player'&&a.pos.x>=exit.x&&a.pos.x<=exit.x+exit.width&&a.pos.y>=exit.y&&a.pos.y<=exit.y+exit.height) : tryGetPlayer(world)
  if (!player) return

  const { x, y } = player.pos
  const inside =
    x >= exit.x && x <= exit.x + exit.width && y >= exit.y && y <= exit.y + exit.height

  if (inside) world.exitReached = true
}
