/** WebAudio mixer: engine loop (pitch from throttle/speed), constant river bed, music, rate-limited one-shots. */
const FILES = {
  engine: 'engine-loop.mp3', river: 'river-loop.mp3', music: 'course-music.mp3',
  splash: 'landing-splash.mp3', pickup: 'pickup-chime.mp3', gate: 'gate-chime.mp3', scrape: 'rock-scrape.mp3', boost: 'boost-whoosh.mp3',
} as const;
type Key = keyof typeof FILES;

export class Audio {
  ctx: AudioContext | null = null;
  private buffers = new Map<Key, AudioBuffer>();
  private master!: GainNode; private sfx!: GainNode; private musicBus!: GainNode;
  private engineSrc: AudioBufferSourceNode | null = null; private engineGain!: GainNode;
  private riverSrc: AudioBufferSourceNode | null = null;
  private musicSrc: AudioBufferSourceNode | null = null;
  private lastPlay = new Map<Key, number>();
  muted = false; musicVol = 0.45; sfxVol = 0.8;
  playCount = new Map<Key, number>();

  async unlock(base: string) {
    if (this.ctx) { await this.ctx.resume(); return; }
    const ctx = new AudioContext(); this.ctx = ctx;
    this.master = ctx.createGain(); this.master.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.connect(this.master);
    this.engineGain = ctx.createGain(); this.engineGain.gain.value = 0; this.engineGain.connect(this.sfx);
    this.applyVolumes();
    await Promise.all((Object.keys(FILES) as Key[]).map(async k => {
      try {
        const r = await fetch(base + FILES[k]);
        this.buffers.set(k, await ctx.decodeAudioData(await r.arrayBuffer()));
      } catch (e) { console.warn('audio load failed', k, e); }
    }));
  }

  applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = this.muted ? 0 : 1;
    this.sfx.gain.value = this.sfxVol;
    this.musicBus.gain.value = this.musicVol;
  }

  private loop(k: Key, dest: AudioNode, gain: number) {
    const b = this.buffers.get(k); if (!b || !this.ctx) return null;
    const s = this.ctx.createBufferSource(); s.buffer = b; s.loop = true;
    const g = this.ctx.createGain(); g.gain.value = gain; s.connect(g); g.connect(dest); s.start();
    return s;
  }

  /** Start loops for a run; always stops previous ones first so restarts never stack loops. */
  startLoops() {
    this.stopLoops();
    if (!this.ctx) return;
    this.engineSrc = this.loop('engine', this.engineGain, 1);
    this.riverSrc = this.loop('river', this.sfx, 0.32);
    this.musicSrc = this.loop('music', this.musicBus, 1);
  }
  stopLoops() {
    for (const s of [this.engineSrc, this.riverSrc, this.musicSrc]) { try { s?.stop(); } catch { /* already stopped */ } s?.disconnect(); }
    this.engineSrc = this.riverSrc = this.musicSrc = null;
  }
  get activeLoops() { return [this.engineSrc, this.riverSrc, this.musicSrc].filter(Boolean).length; }

  engine(throttle: number, speed: number, airborne: boolean) {
    if (!this.ctx || !this.engineSrc) return;
    const rate = 0.75 + Math.min(1.4, Math.abs(speed) / 14) * 0.45 + throttle * 0.15 + (airborne ? 0.25 : 0);
    this.engineSrc.playbackRate.setTargetAtTime(rate, this.ctx.currentTime, 0.08);
    this.engineGain.gain.setTargetAtTime(0.22 + throttle * 0.25, this.ctx.currentTime, 0.1);
  }

  play(k: Key, gain = 1, minGap = 0.06) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - (this.lastPlay.get(k) ?? -1) < minGap) return;
    this.lastPlay.set(k, now);
    this.playCount.set(k, (this.playCount.get(k) ?? 0) + 1);
    const b = this.buffers.get(k); if (!b) return;
    const s = this.ctx.createBufferSource(); s.buffer = b;
    const g = this.ctx.createGain(); g.gain.value = gain;
    s.connect(g); g.connect(this.sfx); s.start();
  }

  suspend() { this.ctx?.suspend(); }
  resume() { this.ctx?.resume(); }
}
