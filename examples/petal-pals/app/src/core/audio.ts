// WebAudio manager: separate music / ambience / effects buses, mute and volume, unlocked by a user gesture.
const SFX = ['leaflet-chirp', 'peach-chirp', 'bubble-chirp', 'grazer-call', 'finch-chirp', 'shutter', 'pickup', 'munch', 'befriend', 'discover', 'flute', 'ui-click', 'footstep', 'step-wood', 'splash'] as const;
export type Sfx = typeof SFX[number];

export class Audio {
  ctx: AudioContext | null = null;
  private master!: GainNode; private music!: GainNode; private sfx!: GainNode; private amb!: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private loops: AudioBufferSourceNode[] = [];
  muted = false; musicVol = 0.55; sfxVol = 0.8;
  private started = false;

  async unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
      this.music = this.ctx.createGain(); this.music.connect(this.master);
      this.amb = this.ctx.createGain(); this.amb.connect(this.master);
      this.sfx = this.ctx.createGain(); this.sfx.connect(this.master);
      this.applyVolumes();
      this.loadAll();
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
  }
  private async load(name: string) {
    try {
      const r = await fetch(`assets/audio/${name}.mp3`);
      const buf = await this.ctx!.decodeAudioData(await r.arrayBuffer());
      this.buffers.set(name, buf);
    } catch (e) { console.warn('audio load failed', name, e); }
  }
  private async loadAll() {
    await Promise.all([...SFX, 'ambience', 'music'].map(n => this.load(n)));
    this.startLoops();
  }
  private startLoops() {
    if (this.started || !this.ctx) return; this.started = true;
    for (const [name, bus] of [['music', this.music], ['ambience', this.amb]] as const) {
      const b = this.buffers.get(name); if (!b) continue;
      const src = this.ctx.createBufferSource(); src.buffer = b; src.loop = true;
      // skip MP3 encoder/decoder padding so the crossfaded loop is gapless
      const d = b.getChannelData(0); let a = 0, z = d.length - 1;
      while (a < 4096 && Math.abs(d[a]) < 1e-4) a++;
      while (z > d.length - 4096 && Math.abs(d[z]) < 1e-4) z--;
      src.loopStart = a / b.sampleRate; src.loopEnd = (z + 1) / b.sampleRate;
      src.connect(bus); src.start(0, src.loopStart); this.loops.push(src);
    }
  }
  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 1, t, 0.05);
    this.music.gain.setTargetAtTime(this.musicVol * 0.78, t, 0.1);
    this.amb.gain.setTargetAtTime(this.sfxVol * 0.5, t, 0.1);
    this.sfx.gain.setTargetAtTime(this.sfxVol, t, 0.05);
  }
  setMuted(m: boolean) { this.muted = m; this.applyVolumes(); }
  /** Briefly lower music under an important cue. */
  duck(seconds = 1.5) {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    this.music.gain.cancelScheduledValues(t); this.music.gain.setTargetAtTime(this.musicVol * 0.18, t, 0.05);
    this.music.gain.setTargetAtTime(this.musicVol * 0.78, t + seconds, 0.4);
  }
  play(name: Sfx, opts: { vol?: number; rate?: number } = {}) {
    if (!this.ctx) return; const b = this.buffers.get(name); if (!b) return;
    const src = this.ctx.createBufferSource(); src.buffer = b; src.playbackRate.value = opts.rate ?? 1;
    const g = this.ctx.createGain(); g.gain.value = opts.vol ?? 1; src.connect(g); g.connect(this.sfx); src.start();
  }
}
