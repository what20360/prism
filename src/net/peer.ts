import { createMessageAssembler, frameMessage } from './framing'
export type PeerStatus = 'gathering' | 'waiting' | 'connecting' | 'connected' | 'disconnected' | 'failed'
interface Signal { readonly format: 'prism-duel'; readonly version: 1; readonly id: string; readonly type: 'offer' | 'answer'; readonly sdp: string }
export interface DuelPeer {
  offer(): Promise<string>; answer(invitation: string): Promise<string>; accept(response: string): Promise<void>
  send(message: string): boolean; close(): void
}
export function decodeSignal(code: string, type: Signal['type']): Signal {
  if (code.length > 96000 || !code.trim().startsWith('PRISM1-')) throw new Error('请粘贴完整的 PRISM 连接代码')
  let data: Signal
  try { data = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(code.trim().slice(7)), (c) => c.charCodeAt(0)))) as Signal } catch { throw new Error('连接代码损坏') }
  if (!data || typeof data !== 'object' || data.format !== 'prism-duel' || data.version !== 1 || data.type !== type || typeof data.sdp !== 'string' || data.sdp.length > 64000 || !data.sdp.startsWith('v=0') || typeof data.id !== 'string' || !/^[a-zA-Z0-9-]{8,60}$/.test(data.id)) throw new Error(type === 'offer' ? '这不是有效的邀请代码' : '这不是有效的回应代码')
  return data
}
function encodeSignal(signal: Signal): string { return 'PRISM1-' + btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(signal)))) }
export function createDuelPeer(options: { status: (state: PeerStatus) => void; message: (text: string) => void }): DuelPeer {
  if (typeof RTCPeerConnection === 'undefined') throw new Error('当前浏览器不支持直连对战，请使用较新的 Chrome、Edge、Firefox 或 Safari。')
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
  let channel: RTCDataChannel | undefined, closed = false, sessionId = '', frameId = 0
  const assemble = createMessageAssembler()
  const pending = new Set<() => void>()
  const report = (status: PeerStatus) => { if (!closed) options.status(status) }
  const attach = (data: RTCDataChannel) => {
    if (data.label !== 'prism-1v1-v1' || channel) { data.close(); return }
    channel = data
    data.onopen = () => report('connected'); data.onclose = () => report('disconnected'); data.onerror = () => report('failed')
    data.onmessage = (event) => { if (!closed && typeof event.data === 'string' && event.data.length <= 25024) { const message = assemble(event.data, performance.now()); if (message !== null) options.message(message) } }
    if (data.readyState === 'open') report('connected')
  }
  pc.ondatachannel = (event) => attach(event.channel)
  pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') report(pc.connectionState === 'failed' ? 'failed' : 'disconnected') }
  const gathered = () => new Promise<void>((resolve, reject) => {
    if (closed) { reject(new Error('连接已取消')); return }
    if (pc.iceGatheringState === 'complete') { resolve(); return }
    const done = () => { clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', change); pending.delete(cancel); closed ? reject(new Error('连接已取消')) : resolve() }
    const change = () => { if (pc.iceGatheringState === 'complete') done() }
    const cancel = () => done()
    const timer = setTimeout(done, 8000); pending.add(cancel); pc.addEventListener('icegatheringstatechange', change)
  })
  const localCode = async (type: Signal['type']) => { await gathered(); if (closed || !pc.localDescription?.sdp) throw new Error('未能生成连接代码'); if (!pc.localDescription.sdp.includes('a=candidate:')) throw new Error('未获得可直连的网络地址，请尝试允许 WebRTC 的浏览器或更换网络。'); report('waiting'); return encodeSignal({ format: 'prism-duel', version: 1, id: sessionId, type, sdp: pc.localDescription.sdp }) }
  return {
    offer: async () => { report('gathering'); sessionId = crypto.randomUUID(); attach(pc.createDataChannel('prism-1v1-v1', { ordered: true })); await pc.setLocalDescription(await pc.createOffer()); return localCode('offer') },
    answer: async (code) => { const invite = decodeSignal(code, 'offer'); sessionId = invite.id; report('gathering'); await pc.setRemoteDescription({ type: 'offer', sdp: invite.sdp }); await pc.setLocalDescription(await pc.createAnswer()); return localCode('answer') },
    accept: async (code) => { const answer = decodeSignal(code, 'answer'); if (answer.id !== sessionId) throw new Error('回应属于另一场对局，请重新复制'); report('connecting'); await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp }) },
    send: (text) => { if (closed || !channel || channel.readyState !== 'open' || channel.bufferedAmount > 256 * 1024) return false; try { const parts = frameMessage(text, ++frameId); if (!parts.length) return false; for (const part of parts) channel.send(part); return true } catch { return false } },
    close: () => { if (closed) return; closed = true; for (const cancel of [...pending]) cancel(); channel?.close(); pc.close() },
  }
}
