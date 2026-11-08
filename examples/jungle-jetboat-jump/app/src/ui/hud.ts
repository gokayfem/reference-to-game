import { Session, Results } from '../game/session';
import { TUNING } from '../game/boat';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function fmtTime(t: number) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
export function fmtTimeMs(t: number) {
  const m = Math.floor(t / 60), s = t % 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

/** All HUD values are read from Session state each frame — nothing is animated independently of the rules. */
export class Hud {
  private el = {
    hud: $('hud'), timer: $('timer'), score: $('score'), speed: $('speed'), gates: $('gates'), suns: $('suns'),
    zone: $('zone'), boostFill: $('boostFill'), boostLabel: $('boostLabel'), toasts: $('toasts'), countdown: $('countdown'),
    hint: $('hint'), speedCard: document.querySelector('.speed-card') as HTMLElement, boost: document.querySelector('.boost') as HTMLElement,
    gateChip: $('gateChip'), minimap: $<HTMLCanvasElement>('minimap'),
  };
  private lastZone = ''; private zoneTimer = 0; private hintTimer = 0;
  private cache: Record<string, string> = {};

  show(v: boolean) { this.el.hud.classList.toggle('hidden', !v); }
  private set(k: keyof Hud['el'], v: string) { if (this.cache[k] !== v) { this.cache[k] = v; (this.el[k] as HTMLElement).textContent = v; } }

  toast(text: string, cls = '') {
    const d = document.createElement('div'); d.className = `toast ${cls}`; d.textContent = text;
    this.el.toasts.appendChild(d);
    while (this.el.toasts.children.length > 3) this.el.toasts.firstElementChild!.remove();
    setTimeout(() => d.remove(), 1800);
  }
  hint(text: string, secs = 2.5) { this.el.hint.textContent = text; this.el.hint.classList.add('show'); this.hintTimer = secs; }
  flashGate() { this.el.gateChip.classList.remove('flash'); void this.el.gateChip.offsetWidth; this.el.gateChip.classList.add('flash'); }
  clear() { this.el.toasts.innerHTML = ''; this.lastZone = ''; this.el.zone.classList.remove('show'); this.el.hint.classList.remove('show'); this.cache = {}; }

  update(s: Session, dt: number) {
    const b = s.boat;
    this.set('timer', fmtTime(s.time));
    this.set('score', s.liveScore.toLocaleString('en-US'));
    this.set('speed', String(Math.round(Math.hypot(b.airborne ? Math.hypot(b.airVx, b.airVz) : b.speed, 0) * 3.6)));
    this.set('gates', `GATE ${s.gatesPassed}/${s.gates.length}`);
    this.set('suns', `${s.suns}/${s.tokens.length}`);
    const pct = b.boost / TUNING.boostCapacity;
    this.el.boostFill.style.width = `${(pct * 100).toFixed(1)}%`;
    this.set('boostLabel', b.boosting ? 'BOOSTING!' : pct >= 0.999 ? 'BOOST READY' : pct < 0.05 ? 'RECHARGING' : 'BOOST');
    this.el.boost.classList.toggle('active', b.boosting);
    this.el.speedCard.classList.toggle('boosting', b.boosting);
    if (s.phase === 'countdown') this.set('countdown', String(Math.ceil(s.countdown)));
    else if (s.phase === 'running' && s.time < 0.8) this.set('countdown', 'GO!');
    else this.set('countdown', '');
    const z = s.course.zoneAt(s.progressS);
    if (z !== this.lastZone && s.phase === 'running') { this.lastZone = z; this.el.zone.textContent = z.toUpperCase(); this.el.zone.classList.add('show'); this.zoneTimer = 2.4; }
    if (this.zoneTimer > 0 && (this.zoneTimer -= dt) <= 0) this.el.zone.classList.remove('show');
    if (this.hintTimer > 0 && (this.hintTimer -= dt) <= 0) this.el.hint.classList.remove('show');
  }

  toggleMap() { this.el.minimap.classList.toggle('hidden'); }
  get mapOpen() { return !this.el.minimap.classList.contains('hidden'); }

  drawMap(s: Session) {
    const cv = this.el.minimap; const g = cv.getContext('2d')!;
    const smp = s.course.samples;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of smp) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
    const pad = 30, W = cv.width, H = cv.height;
    const sc = Math.min((W - pad * 2) / (maxX - minX + 1), (H - pad * 2) / (maxZ - minZ + 1));
    // map: downstream goes up the canvas; mirror x so the player's right is drawn on the right
    const tx = (x: number) => W / 2 - (x - (minX + maxX) / 2) * sc;
    const tz = (z: number) => H - pad - (z - minZ) * sc;
    g.clearRect(0, 0, W, H);
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = '#6aa83a'; g.lineWidth = 26; g.beginPath(); smp.forEach((p, i) => (i ? g.lineTo(tx(p.x), tz(p.z)) : g.moveTo(tx(p.x), tz(p.z)))); g.stroke();
    g.strokeStyle = '#3cb9c0'; g.lineWidth = 14; g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 2; g.setLineDash([6, 8]); g.stroke(); g.setLineDash([]);
    for (const gt of s.gates) {
      const p = s.course.sampleAt(gt.s);
      g.fillStyle = gt.passed ? '#57e08a' : gt.index === s.nextGate ? '#3fe3e8' : '#f2d23a';
      g.beginPath(); g.arc(tx(p.x), tz(p.z), 7, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#12283a'; g.lineWidth = 2; g.stroke();
    }
    for (const t of s.tokens) if (!t.collected) { g.fillStyle = '#ffc531'; g.fillRect(tx(t.x) - 2, tz(t.z) - 2, 4, 4); }
    const j = s.course.jump; const rp = s.course.sampleAt(j.rampEndS);
    g.fillStyle = '#e8642a'; g.fillRect(tx(rp.x) - 6, tz(rp.z) - 6, 12, 12);
    const fp = s.course.sampleAt(s.finishS);
    g.fillStyle = '#12283a'; g.font = '900 16px Nunito, sans-serif'; g.fillText('FINISH', tx(fp.x) + 12, tz(fp.z) + 5);
    const sp = s.course.sampleAt(0); g.fillText('START', tx(sp.x) + 12, tz(sp.z));
    const b = s.boat;
    g.save(); g.translate(tx(b.x), tz(b.z)); g.rotate(-b.heading);
    g.fillStyle = '#e8642a'; g.strokeStyle = '#fff'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, -11); g.lineTo(7, 8); g.lineTo(-7, 8); g.closePath(); g.fill(); g.stroke(); g.restore();
  }
}

export function renderResults(r: Results, best: { bestTime: number | null; bestScore: number }, newBest: boolean) {
  $('stars').innerHTML = [1, 2, 3].map(i => `<span class="${i <= r.stars ? 'on' : 'off'}">★</span>`).join('');
  const rows: [string, string][] = [
    ['Time', fmtTimeMs(r.time)],
    ['Sun tokens', `${r.suns}/${r.totalSuns}  (+${r.tokenPoints.toLocaleString('en-US')})`],
    ['Gates', `${r.gates}/6  (+${r.gatePoints.toLocaleString('en-US')})`],
    ['Canyon leap', r.cleanLanding ? `Clean  (+${r.landingBonus})` : 'Missed'],
    ['Collision penalties', `${r.hits} hits  (−${r.penalties})`],
    ['Recoveries', `${r.recoveries}  (+${r.recoveries * 3}s)`],
    ['Time bonus', `+${r.timeBonus.toLocaleString('en-US')}`],
  ];
  $('resGrid').innerHTML = rows.map(([a, b]) => `<span>${a}</span><span>${b}</span>`).join('');
  $('resScore').textContent = r.score.toLocaleString('en-US');
  $('resBest').textContent = `${newBest ? 'NEW PERSONAL BEST! · ' : ''}Best ${best.bestTime != null ? fmtTimeMs(best.bestTime) : '—'} · ${best.bestScore.toLocaleString('en-US')} pts`;
}
