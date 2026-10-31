export const MAX_WIRE_MESSAGE = 2 * 1024 * 1024
const CHUNK_SIZE = 12000
export function frameMessage(text: string, id: number): string[] {
  if (text.length > MAX_WIRE_MESSAGE) return []
  if (text.length <= CHUNK_SIZE) return [text]
  const total = Math.ceil(text.length / CHUNK_SIZE)
  return Array.from({ length: total }, (_, index) => JSON.stringify({ prismChunk: 2, id, index, total, data: text.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE) }))
}
/** Ordered data channels deliver one bounded message at a time. */
export function createMessageAssembler() {
  let id = -1, total = 0, next = 0, size = 0, started = 0, parts: string[] = []
  return (text: string, now: number): string | null => {
    if (text.length > CHUNK_SIZE * 2 + 1024) return null
    let value: Record<string, unknown>
    try { value = JSON.parse(text) as Record<string, unknown> } catch { return null }
    if (!value || value.prismChunk !== 2) return text.length <= CHUNK_SIZE ? text : null
    const p = value as { id: number; index: number; total: number; data: string }
    if (!Number.isSafeInteger(p.id) || !Number.isInteger(p.index) || !Number.isInteger(p.total) || p.total < 2 || p.total > Math.ceil(MAX_WIRE_MESSAGE / CHUNK_SIZE) || typeof p.data !== 'string' || p.data.length > CHUNK_SIZE) return null
    if (p.index === 0) { id = p.id; total = p.total; next = 0; size = 0; parts = []; started = now }
    if (p.id !== id || p.total !== total || p.index !== next || now - started > 5000) return null
    size += p.data.length; if (size > MAX_WIRE_MESSAGE) { parts = []; id = -1; return null }
    parts.push(p.data); next++
    if (next < total) return null
    const message = parts.join(''); parts = []; id = -1; return message
  }
}
