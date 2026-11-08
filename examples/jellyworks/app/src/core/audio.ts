/** Event-driven Web Audio: one-shot buffers, a single pooled belt loop and a music loop. */
export const CUES = ['belt-loop', 'press-clunk', 'gummy-drop', 'factory-complete', 'mixer-whir', 'ui-click', 'place-module', 'error-blocked', 'cooler-hiss', 'factory-music'] as const;
export type Cue = (typeof CUES)[number];

export class AudioManager {
  ctx: AudioContext | null = null;
  private buffers = new Map<Cue, AudioBuffer>();
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private beltGain!: GainNode;
  private beltSrc: AudioBufferSourceNode | null = null;
  private musicSrc: AudioBufferSourceNode | null = null;
  private lastPlay = new Map<Cue, number>();
  private raw = new Map<Cue, ArrayBuffer>();
  muted = false;
  sfxVol = 0.8;
  musicVol = 0.5;

  /** Fetch encoded audio before the user gesture (decoded on unlock). */
  async preload(onProgress?: (n: number) => void) {
    let done = 0;
    await Promise.all(CUES.map(async (c) => {
      try {
        const r = await fetch(`assets/audio/${c}.mp3`);
        if (r.ok) this.raw.set(c, await r.arrayBuffer());
      } catch { /* missing audio is non-fatal */ }
      onProgress?.(++done / CUES.length);
    }));
  }

  /** Must be called from a user gesture. */
  async unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') await this.ctx.resume(); return; }
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
    this.sfx = this.ctx.createGain(); this.sfx.connect(this.master);
    this.music = this.ctx.createGain(); this.music.connect(this.master);
    this.beltGain = this.ctx.createGain(); this.beltGain.gain.value = 0; this.beltGain.connect(this.sfx);
    this.apply();
    await Promise.all([...this.raw.entries()].map(async ([c, buf]) => {
      try { this.buffers.set(c, await this.ctx!.decodeAudioData(buf.slice(0))); } catch { /* skip */ }
    }));
    this.startLoops();
  }

  private startLoops() {
    if (!this.ctx) return;
    const belt = this.buffers.get('belt-loop');
    if (belt && !this.beltSrc) {
      this.beltSrc = this.ctx.createBufferSource(); this.beltSrc.buffer = belt; this.beltSrc.loop = true;
      this.beltSrc.connect(this.beltGain); this.beltSrc.start();
    }
    const mus = this.buffers.get('factory-music');
    if (mus && !this.musicSrc) {
      this.musicSrc = this.ctx.createBufferSource(); this.musicSrc.buffer = mus; this.musicSrc.loop = true;
      this.musicSrc.connect(this.music); this.musicSrc.start();
    }
  }

  apply() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 1, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.sfxVol, t, 0.05);
    this.music.gain.setTargetAtTime(this.musicVol * 0.55, t, 0.1);
  }

  setBelt(running: boolean) {
    if (!this.ctx) return;
    this.beltGain.gain.setTargetAtTime(running ? 0.22 : 0, this.ctx.currentTime, 0.25);
  }

  play(c: Cue, opts: { vol?: number; rate?: number; minGap?: number } = {}) {
    if (!this.ctx || this.muted) return;
    const buf = this.buffers.get(c);
    if (!buf) return;
    const now = this.ctx.currentTime;
    if (now - (this.lastPlay.get(c) ?? -1) < (opts.minGap ?? 0.05)) return;
    this.lastPlay.set(c, now);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = opts.rate ?? 1;
    const g = this.ctx.createGain(); g.gain.value = opts.vol ?? 1;
    src.connect(g).connect(this.sfx);
    src.start();
  }

  suspend() { this.ctx?.suspend(); }
  resume() { this.ctx?.resume(); }
}
