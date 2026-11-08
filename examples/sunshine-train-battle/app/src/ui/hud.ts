// State-driven DOM HUD in the reference's blue/orange/cream family. Every value is read from GameState.
import type { Game, GameState } from '../game/game';
import { CARS, ENGINE_TRIGGER, carAt, carEnd, JUMP_GAP_AFTER, TUNING } from '../game/level';
import { isReloading, MAG_SIZE } from '../game/rules';

const BADGE = `<svg viewBox="0 0 100 110" class="badge-svg"><defs><linearGradient id="bo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9a3c"/><stop offset="1" stop-color="#e2560f"/></linearGradient></defs>
<polygon points="50,3 95,28 95,82 50,107 5,82 5,28" fill="#1b2b4a" stroke="#3fd2ff" stroke-width="5"/>
<polygon points="50,14 85,34 85,76 50,96 15,76 15,34" fill="url(#bo)" stroke="#16243f" stroke-width="3"/>
<g stroke="#1b1f27" stroke-width="5" stroke-linecap="round"><line x1="32" y1="36" x2="68" y2="74"/><line x1="68" y1="36" x2="32" y2="74"/></g>
<g stroke="#f4efe8" stroke-width="2.6" stroke-linecap="round"><line x1="32" y1="36" x2="68" y2="74"/><line x1="68" y1="36" x2="32" y2="74"/></g>
<rect x="26" y="30" width="12" height="9" rx="2" fill="#f4efe8" transform="rotate(45 32 34)"/><rect x="62" y="30" width="12" height="9" rx="2" fill="#f4efe8" transform="rotate(-45 68 34)"/></svg>`;
const SHIELD = `<svg viewBox="0 0 100 116" class="shield-svg"><defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#66e9ff"/><stop offset="1" stop-color="#1b8fd6"/></linearGradient></defs>
<path d="M50 4 L92 20 L88 64 C84 88 66 104 50 112 C34 104 16 88 12 64 L8 20 Z" fill="rgba(20,60,110,0.55)" stroke="#8ff3ff" stroke-width="5"/>
<path class="shield-fill" d="M50 16 L80 28 L77 62 C74 80 62 92 50 98 C38 92 26 80 23 62 L20 28 Z" fill="url(#sg)"/>
<path d="M33 58 L46 72 L70 42" fill="none" stroke="#f4fbff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export class Hud {
  root: HTMLElement;
  private el: Record<string, HTMLElement> = {};
  private popLayer: HTMLElement;
  private pops: { el: HTMLElement; x: number; y: number; z: number; life: number }[] = [];
  private toastT = 0;
  private hitT = 0;
  private dmgT = 0; private dmgAngle = 0;
  private segs: HTMLElement[] = [];
  visible = true;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div class="objective"><div class="obj-car"></div><div class="obj-text"></div></div>
      <div class="topright">
        <div class="badge">${BADGE}</div>
        <div class="ammo"><span class="mag">12</span><span class="reserve">60</span><div class="reloadbar"><i></i></div></div>
        <div class="compass"><div class="strip"></div><div class="needle"></div></div>
        <div class="score"><span class="score-v">0</span> PTS · <span class="cry-v">0</span> crystals</div>
      </div>
      <div class="reticle"><div class="ring"></div><div class="dot"></div><i class="t1"></i><i class="t2"></i><i class="t3"></i><i class="t4"></i><div class="hitmark"></div></div>
      <div class="dmg"></div>
      <div class="prompt"></div>
      <div class="toast"></div>
      <div class="vitals">
        <div class="shield-icon">${SHIELD}</div>
        <div class="bars"><div class="hp"><div class="segs"></div><span class="hp-v">100</span></div><div class="energy"><i></i></div></div>
      </div>
      <div class="pops"></div>
      <div class="route hidden"><div class="route-title">ROUTE · REACH THE ENGINE</div><div class="route-cars"></div><div class="route-hint">M to close</div></div>`;
    parent.appendChild(this.root);
    const q = (s: string) => this.root.querySelector(s) as HTMLElement;
    for (const k of ['obj-car', 'obj-text', 'mag', 'reserve', 'reloadbar', 'strip', 'score-v', 'cry-v', 'reticle', 'hitmark', 'dmg', 'prompt', 'toast', 'hp-v', 'energy', 'route', 'route-cars', 'shield-icon', 'ammo']) this.el[k] = q('.' + k);
    this.popLayer = q('.pops');
    const segs = q('.segs');
    for (let i = 0; i < 10; i++) { const s = document.createElement('i'); segs.appendChild(s); this.segs.push(s); }
    const cars = this.el['route-cars'];
    cars.innerHTML = CARS.map((c, i) => `<div class="rc" data-i="${i}"><div class="rc-body"><span class="rc-n">${i + 1}</span></div><div class="rc-name">${c.name}</div></div>${i < CARS.length - 1 ? `<div class="rc-link ${i === JUMP_GAP_AFTER ? 'gap' : ''}"></div>` : ''}`).join('') +
      `<div class="rc-link"></div><div class="rc engine" data-i="6"><div class="rc-body"><span class="rc-n">⚑</span></div><div class="rc-name">Engine</div></div>`;
  }

  toggleRoute(force?: boolean) { this.el.route.classList.toggle('hidden', force === undefined ? undefined : !force); }
  routeOpen() { return !this.el.route.classList.contains('hidden'); }

  toast(text: string, sub = '') { this.el.toast.innerHTML = `<b>${text}</b>${sub ? `<span>${sub}</span>` : ''}`; this.el.toast.classList.add('show'); this.toastT = 2.4; }
  hit() { this.hitT = 0.18; }
  damage(angle: number) { this.dmgT = 0.8; this.dmgAngle = angle; }
  popup(text: string, x: number, y: number, z: number, cls = '') {
    const el = document.createElement('div'); el.className = 'pop ' + cls; el.textContent = text;
    this.popLayer.appendChild(el); this.pops.push({ el, x, y, z, life: 1.2 });
  }
  clearPops() { for (const p of this.pops) p.el.remove(); this.pops = []; }

  update(dt: number, g: Game, project: (x: number, y: number, z: number) => { x: number; y: number; visible: boolean }) {
    const s: GameState = g.s;
    this.root.classList.toggle('hidden', !this.visible);
    this.root.classList.toggle('menu', g.s.phase !== 'playing');
    const w = s.weapon;
    this.el.mag.textContent = String(w.mag);
    this.el.reserve.textContent = String(w.reserve);
    this.el.ammo.classList.toggle('low', w.mag <= 3);
    const rb = this.el.reloadbar;
    rb.style.opacity = isReloading(w) ? '1' : '0';
    (rb.firstElementChild as HTMLElement).style.width = isReloading(w) ? `${(1 - w.reloadTimer / TUNING.reloadSeconds) * 100}%` : '0%';
    this.el['score-v'].textContent = String(s.score);
    this.el['cry-v'].textContent = String(s.crystals);
    const hp = s.player.health;
    this.el['hp-v'].textContent = String(Math.ceil(hp));
    this.segs.forEach((e, i) => e.classList.toggle('on', hp > i * 10 + 0.01));
    (this.el.energy.firstElementChild as HTMLElement).style.width = `${s.shield.energy}%`;
    this.el['shield-icon'].classList.toggle('active', s.shield.active);
    this.el['shield-icon'].classList.toggle('empty', s.shield.energy < 1);
    const fill = this.el['shield-icon'].querySelector('.shield-fill') as SVGElement;
    fill.style.opacity = String(0.25 + 0.75 * s.shield.energy / 100);

    // objective
    const pc = Math.max(0, Math.min(6, carAt(s.player.z)));
    const next = s.cleared.findIndex((c) => !c);
    if (pc >= 6 || next === -1) {
      this.el['obj-car'].textContent = 'ENGINE';
      this.el['obj-text'].textContent = next === -1 ? 'Reach the engine checkpoint' : 'Clear the engine approach';
    } else {
      const car = CARS[pc];
      this.el['obj-car'].textContent = `CAR ${pc + 1}/6 · ${car.name.toUpperCase()}`;
      const left = car.required.filter((id) => !s.robots.find((r) => r.id === id)?.defeated).length;
      this.el['obj-text'].textContent = car.required.length === 0 ? 'Advance to the next car' : left > 0 ? `Defeat robots  ${car.required.length - left}/${car.required.length}` : 'Car clear · gate open — advance';
    }

    // compass: N = +Z (direction of travel)
    const heading = ((-s.player.yaw * 180 / Math.PI) % 360 + 360) % 360;
    const ticks: string[] = [];
    const PX = 2.4;
    for (let d = Math.ceil((heading - 70) / 15) * 15; d <= heading + 70; d += 15) {
      const dd = ((d % 360) + 360) % 360;
      const label = dd === 0 ? 'N' : dd === 90 ? 'E' : dd === 180 ? 'S' : dd === 270 ? 'W' : String(dd);
      ticks.push(`<span class="tk ${dd % 90 === 0 ? 'card' : ''} ${dd === 0 ? 'north' : ''}" style="left:${(d - heading) * PX + 150}px">${label}</span>`);
    }
    // engine marker
    const ex = ENGINE_TRIGGER.x - s.player.x, ez = ENGINE_TRIGGER.z - s.player.z;
    const eb = ((-Math.atan2(ex, ez) * 180 / Math.PI) % 360 + 360) % 360;
    let off = eb - heading; while (off > 180) off -= 360; while (off < -180) off += 360;
    ticks.push(`<b class="mk" style="left:${Math.max(-6, Math.min(306, off * PX + 150))}px"></b>`);
    this.el.strip.innerHTML = ticks.join('');

    // reticle
    const onRobot = s.aim.kind === 'robot';
    this.el.reticle.classList.toggle('enemy', onRobot);
    this.el.reticle.classList.toggle('blocked', s.shield.active || isReloading(w));
    this.hitT -= dt; this.el.hitmark.style.opacity = this.hitT > 0 ? '1' : '0';
    this.dmgT -= dt; this.el.dmg.style.opacity = String(Math.max(0, this.dmgT));
    this.el.dmg.style.transform = `translate(-50%,-50%) rotate(${this.dmgAngle}rad)`;

    // context prompts
    let prompt = '';
    const p = s.player;
    if (pc === JUMP_GAP_AFTER && p.z > carEnd(JUMP_GAP_AFTER) - 3 && s.cleared[JUMP_GAP_AFTER]) prompt = 'JUMP';
    else if (pc >= 1 && pc <= 5 && !s.cleared[pc] && p.z > carEnd(pc) - 2.5) prompt = 'GATE LOCKED · CLEAR THIS CAR';
    else if (w.mag === 0 && w.reserve === 0 && !isReloading(w)) prompt = 'OUT OF CELLS · COLLECT DROPS';
    else if (w.mag === 0 && !isReloading(w)) prompt = 'R · RELOAD';
    else if (s.shield.energy <= 0 ) prompt = 'SHIELD RECHARGING';
    this.el.prompt.textContent = prompt;
    this.el.prompt.classList.toggle('show', !!prompt);

    this.toastT -= dt; if (this.toastT <= 0) this.el.toast.classList.remove('show');

    // route overlay state
    this.root.querySelectorAll<HTMLElement>('.rc').forEach((e) => {
      const i = Number(e.dataset.i);
      e.classList.toggle('cleared', i < 6 && s.cleared[i]);
      e.classList.toggle('here', i === pc);
      e.classList.toggle('next', i === next);
    });

    // floating score popups
    for (const pp of this.pops) {
      pp.life -= dt;
      const sc = project(pp.x, pp.y + (1.2 - pp.life) * 0.6, pp.z);
      pp.el.style.display = sc.visible ? 'block' : 'none';
      pp.el.style.transform = `translate(${sc.x}px, ${sc.y}px) translate(-50%,-50%) scale(${0.9 + Math.min(0.3, (1.2 - pp.life) * 2)})`;
      pp.el.style.opacity = String(Math.min(1, pp.life * 2));
    }
    for (const pp of this.pops) if (pp.life <= 0) pp.el.remove();
    this.pops = this.pops.filter((pp) => pp.life > 0);
  }
}

export const MAG = MAG_SIZE;
