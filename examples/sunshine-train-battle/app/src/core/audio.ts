// WebAudio mixer: fal-generated SFX and music, unlocked from the Play gesture.
export type Sfx = 'shot' | 'shieldhit' | 'reload' | 'robotshot' | 'hit' | 'pickup' | 'defeat' | 'land' | 'victory' | 'unlock' | 'hurt';
const FILES: (Sfx | 'trainloop' | 'music')[] = ['shot', 'shieldhit', 'reload', 'robotshot', 'hit', 'pickup', 'defeat', 'land', 'victory', 'unlock', 'hurt', 'trainloop', 'music'];

export class Audio {
  ctx: AudioContext | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private master!: GainNode; private sfxBus!: GainNode; private musicBus!: GainNode; private ambBus!: GainNode;
  private loops = new Map<string, AudioBufferSourceNode>();
  muted = false; volume = 0.8; musicVolume = 0.45; sfxVolume = 0.9;
  private raw = new Map<string, ArrayBuffer>();
  private lastPlay = new Map<string, number>();

  /** Fetch files early (no AudioContext needed yet). */
  async preload(base: string, onProgress: (k: number) => void) {
    let n = 0;
    await Promise.all(FILES.map(async (f) => {
      try { const r = await fetch(`${base}assets/audio/${f}.mp3`); if (r.ok) this.raw.set(f, await r.arrayBuffer()); } catch { /* audio optional */ }
      onProgress(++n / FILES.length);
    }));
  }

  async unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain(); this.sfxBus.connect(this.master);
      this.musicBus = this.ctx.createGain(); this.musicBus.connect(this.master);
      this.ambBus = this.ctx.createGain(); this.ambBus.connect(this.master);
      await Promise.all([...this.raw].map(async ([k, b]) => { try { this.buffers.set(k, await this.ctx!.decodeAudioData(b.slice(0))); } catch { /* skip */ } }));
      this.applyVolumes();
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const v = this.muted ? 0 : this.volume;
    this.master.gain.value = v; this.sfxBus.gain.value = this.sfxVolume; this.musicBus.gain.value = this.musicVolume * 0.6; this.ambBus.gain.value = 0.35;
  }

  play(name: Sfx, vol = 1, rate = 1) {
    if (!this.ctx || this.muted) return;
    const b = this.buffers.get(name); if (!b) return;
    const now = this.ctx.currentTime;
    if ((this.lastPlay.get(name) ?? -1) > now - 0.03) return; // avoid stacking identical cues in one frame
    this.lastPlay.set(name, now);
    const src = this.ctx.createBufferSource(); src.buffer = b; src.playbackRate.value = rate * (0.96 + Math.random() * 0.08);
    const g = this.ctx.createGain(); g.gain.value = vol; src.connect(g); g.connect(this.sfxBus); src.start();
  }

  startLoop(name: 'trainloop' | 'music') {
    if (!this.ctx || this.loops.has(name)) return;
    const b = this.buffers.get(name); if (!b) return;
    const src = this.ctx.createBufferSource(); src.buffer = b; src.loop = true;
    src.connect(name === 'music' ? this.musicBus : this.ambBus); src.start();
    this.loops.set(name, src);
  }
  stopLoops() { for (const s of this.loops.values()) { try { s.stop(); } catch { /* */ } s.disconnect(); } this.loops.clear(); }
  suspend() { this.ctx?.suspend(); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  duck(on: boolean) { if (this.ctx) this.musicBus.gain.setTargetAtTime((on ? 0.25 : 1) * this.musicVolume * 0.6, this.ctx.currentTime, 0.1); }
}
