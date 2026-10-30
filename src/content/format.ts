/** Preserve tiny multipliers and large prices instead of rounding them to zero. */
export function formatRuleNumber(value: number): string {
  if (!Number.isFinite(value)) return '超出数值范围'
  const magnitude = Math.abs(value)
  return magnitude > 0 && (magnitude < 0.001 || magnitude >= 1e7) ? value.toExponential(3).replace(/\.?(0+)e/, 'e') : String(Number(value.toFixed(3)))
}
