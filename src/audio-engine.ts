import type { GameSceneSnapshot } from './game-renderer';

export class DstAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private muted = false;
  private lastAmbientTick = 0;
  private lastFireTick = 0;

  private ensureContext(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx && typeof window !== 'undefined') {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (Ctor) {
        this.ctx = new Ctor();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.32;
        this.masterGain.connect(this.ctx.destination);
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(muted ? 0 : 0.32, this.ctx.currentTime);
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  unlock() {
    this.ensureContext();
  }

  playHudClick() {
    this.playEvent('dontstarve/HUD/click_move', 0.65);
  }

  playEvents(events: Array<{ path: string; name?: string; volume?: number }>, _character?: string) {
    if (this.muted || !Array.isArray(events)) return;
    for (const ev of events.slice(0, 6)) {
      if (ev?.path) {
        this.playEvent(ev.path, ev.volume ?? 0.9);
      }
    }
  }

  updateAmbient(phase: string) {
    if (this.muted) return;
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (now - this.lastAmbientTick >= 4.0) {
      this.lastAmbientTick = now;
      if (phase === 'day') {
        this.synthTone(ctx, now, 1320, 1580, 0.09, 'sine', 0.05);
        this.synthTone(ctx, now + 0.11, 1580, 1420, 0.11, 'sine', 0.05);
      } else if (phase === 'dusk') {
        this.synthTone(ctx, now, 880, 860, 0.06, 'sine', 0.04);
        this.synthTone(ctx, now + 0.08, 880, 860, 0.06, 'sine', 0.04);
      }
    }
  }

  playEvent(event: string, volume = 1.0) {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const ev = event.toLowerCase();
    const now = ctx.currentTime;
    const vol = Math.max(0.05, Math.min(1.0, volume));

    if (ev.includes('click') || ev.includes('hover')) {
      this.synthTone(ctx, now, 520, 340, 0.045, 'triangle', 0.22 * vol);
    } else if (ev.includes('chop') || ev.includes('tree')) {
      this.synthNoiseBurst(ctx, now, 0.08, 420, 0.45 * vol);
      this.synthTone(ctx, now, 165, 82, 0.09, 'sawtooth', 0.38 * vol);
    } else if (ev.includes('mine') || ev.includes('rock') || ev.includes('ice')) {
      this.synthTone(ctx, now, 1480, 920, 0.11, 'sine', 0.32 * vol);
      this.synthTone(ctx, now + 0.01, 2240, 1760, 0.09, 'triangle', 0.24 * vol);
    } else if (ev.includes('collect') || ev.includes('pickup') || ev.includes('item_osh')) {
      this.synthTone(ctx, now, 440, 680, 0.075, 'sine', 0.28 * vol);
    } else if (ev.includes('craft') || ev.includes('build') || ev.includes('recipe') || ev.includes('research')) {
      this.synthTone(ctx, now, 392, 523.25, 0.1, 'triangle', 0.28 * vol);
      this.synthTone(ctx, now + 0.08, 523.25, 659.25, 0.14, 'triangle', 0.28 * vol);
    } else if (ev.includes('eat') || ev.includes('bite')) {
      this.synthNoiseBurst(ctx, now, 0.06, 680, 0.3 * vol);
      this.synthTone(ctx, now + 0.07, 290, 210, 0.07, 'sine', 0.25 * vol);
    } else if (ev.includes('attack') || ev.includes('whoosh') || ev.includes('hurt') || ev.includes('hit')) {
      this.synthNoiseBurst(ctx, now, 0.1, 320, 0.45 * vol);
      this.synthTone(ctx, now, 220, 95, 0.12, 'sawtooth', 0.35 * vol);
    } else if (ev.includes('talk')) {
      // Klei character instrument voice notes (muted horn / harmonium)
      const notes = [261.6, 293.7, 329.6, 349.2, 392.0, 440.0];
      for (let i = 0; i < 3; ++i) {
        const f = notes[Math.floor(Math.random() * notes.length)];
        this.synthTone(ctx, now + i * 0.085, f, f * 0.98, 0.07, 'sawtooth', 0.16 * vol);
      }
    } else if (ev.includes('open') || ev.includes('chest') || ev.includes('close')) {
      const f0 = ev.includes('close') ? 310 : 220;
      const f1 = ev.includes('close') ? 190 : 340;
      this.synthTone(ctx, now, f0, f1, 0.11, 'triangle', 0.28 * vol);
    }
  }

  syncScene(scene: GameSceneSnapshot) {
    if (this.muted) return;
    if (Array.isArray(scene.soundEvents)) {
      this.playEvents(scene.soundEvents, scene.player.prefab);
    }
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;

    // Gentle fire crackle when standing near campfire or firepit
    if (scene.tick - this.lastFireTick >= 18) {
      const hasFire = scene.entities?.some(
        e => (e.prefab === 'campfire' || e.prefab === 'firepit') && Math.hypot(e.x - scene.player.x, e.z - scene.player.z) < 12,
      );
      if (hasFire) {
        this.lastFireTick = scene.tick;
        this.synthNoiseBurst(ctx, ctx.currentTime, 0.035, 1100, 0.09);
      }
    }
    this.updateAmbient(scene.clock.phase);
  }

  private synthTone(
    ctx: AudioContext,
    startTime: number,
    fStart: number,
    fEnd: number,
    duration: number,
    type: OscillatorType,
    gainVal: number,
  ) {
    if (!this.masterGain) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(fStart, startTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, fEnd), startTime + duration);
    g.gain.setValueAtTime(0.001, startTime);
    g.gain.linearRampToValueAtTime(gainVal, startTime + duration * 0.15);
    g.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.01);
  }

  private synthNoiseBurst(
    ctx: AudioContext,
    startTime: number,
    duration: number,
    filterFreq: number,
    gainVal: number,
  ) {
    if (!this.masterGain) return;
    const sampleCount = Math.max(64, Math.floor(ctx.sampleRate * duration));
    const buf = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < sampleCount; ++i) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / sampleCount);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(filterFreq, startTime);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gainVal, startTime);
    g.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.masterGain);
    src.start(startTime);
  }
}
