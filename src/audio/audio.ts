import type { Snapshot } from '../core/snapshot'
import type { ControlSettings } from '../storage/config'

export type Sound = 'shot' | 'electric' | 'laser' | 'hit' | 'coreHit' | 'explosion' | 'hurt' | 'buy' | 'sell' | 'deflect' | 'revive' | 'victory' | 'failure' | 'mine' | 'rage' | 'dash' | 'pickup'

/** Procedural audio stays outside the deterministic simulation and needs no assets. */
export function createAudioEngine() {
  let context: AudioContext | undefined
  let music: GainNode | undefined
  let effects: GainNode | undefined
  let settings: ControlSettings | undefined
  let paused = false
  let nextNote = 0
  let sequence = 0
  let lastTick = -1
  let previousBullets = new Set<number>()
  let previousMines = new Set<number>()
  let previousEffects = new Set<string>()
  let previousTraces = new Set<string>()
  let lastHealth: number | undefined
  let ended = false
  let lastShotTime = -1

  const tone = (frequency: number, duration: number, volume: number, type: OscillatorType,
    when: number, bus: GainNode, endFrequency = frequency) => {
    if (!context) return
    const oscillator = context.createOscillator()
    const envelope = context.createGain()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(Math.max(20, frequency), when)
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), when + duration)
    envelope.gain.setValueAtTime(0.0001, when)
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), when + 0.012)
    envelope.gain.exponentialRampToValueAtTime(0.0001, when + duration)
    oscillator.connect(envelope).connect(bus)
    oscillator.start(when)
    oscillator.stop(when + duration + 0.03)
    oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect() }
  }

  const notify = (sound: Sound) => {
    if (!context || !effects || context.state !== 'running' || settings?.sfx === false) return
    const now = context.currentTime
    const play = (f: number, d: number, v: number, wave: OscillatorType = 'sine', end = f, delay = 0) =>
      tone(f, d, v, wave, now + delay, effects!, end)
    if (sound === 'shot') { if (now - lastShotTime < 0.045) return; lastShotTime = now; play(420, 0.08, 0.18, 'triangle', 100) }
    else if (sound === 'electric') { if (now - lastShotTime < 0.07) return; lastShotTime = now; play(1400, 0.13, 0.09, 'sawtooth', 190); play(2500, 0.08, 0.04, 'triangle', 420) }
    else if (sound === 'laser') { if (now - lastShotTime < 0.085) return; lastShotTime = now; play(520, 0.14, 0.08, 'sine', 300); play(1040, 0.12, 0.04, 'triangle', 620) }
    else if (sound === 'hit') play(900, 0.06, 0.12, 'sine', 400)
    else if (sound === 'coreHit') { play(1200, 0.15, 0.16); play(1800, 0.1, 0.09, 'sine', 1800, 0.04) }
    else if (sound === 'explosion') { play(110, 0.32, 0.32, 'sawtooth', 24); play(47, 0.36, 0.3) }
    else if (sound === 'hurt') play(180, 0.24, 0.22, 'triangle', 45)
    else if (sound === 'buy' || sound === 'sell') {
      const notes = sound === 'buy' ? [523, 659, 784] : [784, 659, 440]
      notes.forEach((note, i) => play(note, 0.17, 0.13, 'sine', note, i * 0.065))
    } else if (sound === 'deflect') { play(320, 0.24, 0.16, 'sine', 1600); play(960, 0.18, 0.1) }
    else if (sound === 'rage') { play(110, 0.35, 0.2, 'sawtooth', 440); play(220, 0.25, 0.1) }
    else if (sound === 'dash') play(300, 0.18, 0.14, 'triangle', 1300)
    else if (sound === 'pickup') { play(660, 0.14, 0.1); play(990, 0.14, 0.07, 'sine', 990, 0.04) }
    else if (sound === 'mine') play(660, 0.1, 0.1, 'triangle', 330)
    else if (sound === 'revive' || sound === 'victory') {
      ;[262, 330, 392, 523].forEach((note, i) => play(note, 0.45, 0.14, 'sine', note, i * 0.12))
    } else play(220, 0.6, 0.17, 'triangle', 55)
  }

  const applyVolume = () => {
    if (!context || !music || !effects) return
    music.gain.setTargetAtTime(settings?.music === false ? 0 : paused ? 0.075 : 0.22, context.currentTime, 0.1)
    effects.gain.setTargetAtTime(settings?.sfx === false ? 0 : 0.6, context.currentTime, 0.04)
  }

  const unlock = () => {
    try {
      if (!context) {
        const Audio = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!Audio) return
        context = new Audio()
        music = context.createGain()
        effects = context.createGain()
        const compressor = context.createDynamicsCompressor()
        compressor.threshold.value = -14
        compressor.ratio.value = 5
        music.connect(compressor)
        effects.connect(compressor)
        compressor.connect(context.destination)
        nextNote = context.currentTime + 0.08
        applyVolume()
      }
      if (context.state === 'suspended') void context.resume().catch(() => {})
    } catch { /* Audio is optional on browsers without an available output device. */ }
  }

  const scheduler = window.setInterval(() => {
    if (!context || !music || context.state !== 'running') return
    if (nextNote < context.currentTime) nextNote = context.currentTime + 0.02
    while (nextNote < context.currentTime + 0.2) {
      const roots = [130.81, 103.83, 155.56, 116.54]
      const root = roots[Math.floor(sequence / 16) % roots.length] ?? 130.81
      const arp = [1, 1.5, 2, 2.25, 1.5, 2, 3, 2.25][sequence % 8] ?? 1
      if (settings?.music !== false) {
        tone(root * arp * 2, 0.42, 0.11, 'sine', nextNote, music)
        if (sequence % 4 === 0) tone(root / 2, 0.9, 0.2, 'triangle', nextNote, music)
        if (sequence % 16 === 0) {
          tone(root, 2.4, 0.075, 'sine', nextNote, music)
          tone(root * 1.5, 2.4, 0.04, 'sine', nextNote, music)
        }
      }
      nextNote += 60 / 88 / 2
      sequence += 1
    }
  }, 100)
  const visibility = () => {
    if (!context) return
    if (document.hidden) void context.suspend().catch(() => {})
    else { nextNote = context.currentTime + 0.08; void context.resume().catch(() => {}) }
  }
  document.addEventListener('visibilitychange', visibility)

  return {
    unlock, notify,
    configure: (value: ControlSettings) => { settings = value; applyVolume() },
    update: (snapshot: Snapshot, isPaused: boolean) => {
      if (paused !== isPaused) { paused = isPaused; applyVolume() }
      if (snapshot.tick < lastTick) {
        previousBullets.clear(); previousEffects.clear(); previousMines.clear(); lastHealth = undefined; ended = false
      }
      if (snapshot.tick === lastTick) return
      lastTick = snapshot.tick
      const shots = snapshot.projectiles.filter((bullet) => bullet.team === 'player')
      if (shots.some((bullet) => !previousBullets.has(bullet.id))) notify('shot')
      previousBullets = new Set(shots.map((bullet) => bullet.id))
      const traceKeys = new Set<string>()
      for (const trace of snapshot.traces ?? []) {
        const key = `${trace.ownerId}:${trace.kind}:${trace.from.x}:${trace.to.x}:${snapshot.tick + trace.ttl}`; traceKeys.add(key)
        if (trace.team === 'player' && !previousTraces.has(key)) notify(trace.kind)
      }
      previousTraces = traceKeys
      const mines = snapshot.mines.filter((mine) => mine.team === 'player')
      if (mines.some((mine) => !previousMines.has(mine.id))) notify('mine')
      previousMines = new Set(mines.map((mine) => mine.id))
      const keys = new Set<string>()
      for (const effect of snapshot.effects) {
        const key = `${effect.kind}:${effect.x}:${effect.y}:${snapshot.tick + effect.ttl}`
        keys.add(key)
        if (!previousEffects.has(key)) {
          const sound: Sound = effect.kind === 'block' ? 'hit' : effect.kind === 'reflect' ? 'deflect' : effect.kind === 'death' ? 'hit' : effect.kind
          notify(sound)
        }
      }
      previousEffects = keys
      const player = snapshot.actors.find((actor) => actor.team === 'player')
      if (player) {
        const health = player.hp + player.shield
        if (lastHealth !== undefined && health < lastHealth) notify('hurt')
        lastHealth = health
      }
      if (!ended && (snapshot.gameOver || snapshot.victory)) {
        ended = true; notify(snapshot.victory ? 'victory' : 'failure')
      }
    },
    dispose: () => { window.clearInterval(scheduler); document.removeEventListener('visibilitychange', visibility); void context?.close().catch(() => {}) },
  }
}
