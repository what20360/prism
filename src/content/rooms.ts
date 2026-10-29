import type { RoomTemplate } from '../core/world'

/**
 * M1 playground: one 1920x1080 room with a few pillars, matching
 * docs/balance.md (wall/collision layout values are placeholders).
 */
export const TRAINING_ROOM: RoomTemplate = {
  id: 'training',
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  walls: [
    { x: 360, y: 300, width: 120, height: 480 },
    { x: 1440, y: 300, width: 120, height: 480 },
    { x: 820, y: 140, width: 280, height: 90 },
    { x: 820, y: 850, width: 280, height: 90 },
  ],
}
