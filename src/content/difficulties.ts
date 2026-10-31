export const DUNGEON_START_SHARDS = 200
export const DIFFICULTIES = ['标准', '进阶', '危险', '残酷', '炼狱', '极限', '绝境'] as const
export type DungeonDifficulty = 1 | 2 | 3 | 4 | 5 | 6 | 7
export function dungeonDifficulty(value: unknown): DungeonDifficulty {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 7) throw new Error('请选择 1–7 档闯关难度')
  return value as DungeonDifficulty
}
export function difficultyName(value: DungeonDifficulty): string { return `${value} · ${DIFFICULTIES[value - 1]}` }
/** Depth is floor + room/5, from 0 through the final boss at 5. */
export function dungeonProfile(difficulty: DungeonDifficulty, depth: number) {
  const rank = difficulty - 1
  return { hp: 1.4 ** rank * 1.055 ** (rank * depth), damage: 1.17 ** rank * 1.018 ** (rank * depth),
    armor: 12 * rank * (1 + depth / 5), speed: 1.04 ** rank * 1.01 ** (rank * depth),
    bulletSpeed: 1.05 ** rank * 1.012 ** (rank * depth), fireRate: 1.07 ** rank * 1.018 ** (rank * depth),
    count: 1 + 0.14 * rank + 0.05 * rank * depth, waves: 1 + Math.floor(rank * (0.25 + depth * 0.2)) }
}
