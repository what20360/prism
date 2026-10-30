import { createSaveStore, MAX_SAVE_BYTES, SAVE_SLOTS, type SaveSlot } from '../storage/saveStore'
import type { SavesHandlers, SavesState } from '../ui/sections/saves'
import { checkpointLabel, readCheckpoint, type RunCheckpoint } from './checkpoints'
const LABELS = { auto: '自动存档', 'slot-1': '存档1', 'slot-2': '存档2', 'slot-3': '存档3' }
export function createSaveManager(options: { capture: () => RunCheckpoint | null; load: (saved: RunCheckpoint) => void; refresh: () => void }) {
  const store = createSaveStore(); let message = ''
  const update = (text: string) => { message = text; options.refresh() }
  const autoSave = () => {
    const saved = options.capture()
    if (!saved) return
    if (!store.write('auto', JSON.stringify(saved))) message = '自动保存失败：浏览器存储不可用或空间不足，请导出备份。'
  }
  const read = (slot: SaveSlot) => { const raw = store.read(slot); if (!raw) throw new Error('该槽位没有存档'); return readCheckpoint(raw) }
  const download = (saved: RunCheckpoint) => {
    const text = JSON.stringify(saved); readCheckpoint(text)
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = `PRISM_${saved.mode}_${saved.savedAt.replace(/[:.]/g, '-')}.json`; link.hidden = true
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const handlers: SavesHandlers = {
    onExportCurrent: () => { try { const saved = options.capture(); if (!saved) throw new Error('当前没有可导出的单人进度'); download(saved); update('已导出当前进度。') } catch (error) { update(error instanceof Error ? error.message : '导出失败') } },
    onSave: (slot) => { const saved = options.capture(); if (!saved) { update('当前模式或已结束的对局无法保存。'); return }
      update(store.write(slot, JSON.stringify(saved)) ? `已保存到${LABELS[slot]}。` : '保存失败，请检查浏览器存储空间或导出已有存档。') },
    onLoad: (slot) => { try { const saved = read(slot); autoSave(); options.load(saved); update(`已读取${LABELS[slot]}。点击继续恢复战斗。`) } catch (error) { update(error instanceof Error ? error.message : '读取失败') } },
    onExport: (slot) => {
      try {
        download(read(slot)); update(`已导出${LABELS[slot]}。`)
      } catch (error) { update(error instanceof Error ? error.message : '导出失败') }
    },
    onImport: async (slot, file) => {
      try {
        if (file.size > MAX_SAVE_BYTES) throw new Error('存档不能超过 2 MiB')
        const saved = readCheckpoint(await file.text())
        if (!store.write(slot, JSON.stringify(saved))) throw new Error('浏览器无法写入存档，请保留文件备份')
        update(`已导入到${LABELS[slot]}：${checkpointLabel(saved)}。读取后才会替换当前局。`)
      } catch (error) { update(`${error instanceof Error ? error.message : '导入失败'}。现有存档与当前局未改变。`) }
    },
  }
  const state = (): SavesState => ({ canSave: options.capture() !== null, message, slots: SAVE_SLOTS.map((id) => {
    try { const saved = read(id); return { id, label: LABELS[id], detail: checkpointLabel(saved), savedAt: saved.savedAt, available: true } }
    catch { return { id, label: LABELS[id], detail: store.read(id) ? '此存档不可读取，可向手动槽导入有效备份。' : '空槽位', available: false } }
  }) })
  return { autoSave, state, handlers }
}
