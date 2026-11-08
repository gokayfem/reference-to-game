import world from '../data/world.json';
import { Course, getCourse } from './courseProgress';
import { BoatState, InputState, makeBoat, stepControls, TUNING, forwardOf, rightOf } from './boat';

export const DT = 1 / 60;
export const POINTS = {
  token: world.tuning.pickupPoints, gate: 250, landing: world.tuning.cleanLandingPoints, hit: 50,
  recoveryTime: 3, timeBonusPar: 120, timeBonusPerSec: 40,
};
export const CONTACT_COOLDOWN = 1.0;

export type Phase = 'ready' | 'countdown' | 'running' | 'finished';
export type GameEvent =
  | { type: 'pickup'; id: string; x: number; y: number; z: number }
  | { type: 'gate'; index: number; id: string }
  | { type: 'gateIgnored'; index: number; reason: 'backward' | 'order' | 'repeat' }
  | { type: 'scrape'; charged: boolean; x: number; z: number; strength: number }
  | { type: 'launch' }
  | { type: 'land'; result: 'clean' | 'rough'; vy: number }
  | { type: 'recover'; reason: 'missed-jump' | 'out-of-channel' | 'stuck' }
  | { type: 'finishBlocked'; missing: number }
  | { type: 'finish' }
  | { type: 'go' }
  | { type: 'boost' };

export interface Gate { id: string; index: number; s: number; halfWidth: number; passed: boolean }
export interface Token { id: string; s: number; lateral: number; x: number; y: number; z: number; collected: boolean }
export interface Rock { id: string; s: number; lateral: number; x: number; z: number; radius: number }

export interface Results {
  time: number; suns: number; totalSuns: number; gates: number; hits: number; penalties: number; recoveries: number;
  cleanLanding: boolean; landingBonus: number; gatePoints: number; tokenPoints: number; timeBonus: number;
  score: number; stars: number;
}

export function starsFor(r: { time: number; suns: number; recoveries: number; cleanLanding: boolean }): number {
  let stars = 1;
  if (r.suns >= 20 && r.recoveries <= 3) stars = 2;
  if (stars === 2 && r.suns >= 25 && r.cleanLanding && r.time < 110) stars = 3;
  return stars;
}

export class Session {
  readonly course: Course;
  phase: Phase = 'ready';
  boat!: BoatState;
  prev = { x: 0, y: 0, z: 0, heading: 0, bank: 0, pitch: 0 };
  progressS = 0; lateral = 0; progressIndex = 0;
  time = 0; countdown = 0; simTime = 0;
  gates: Gate[] = [];
  tokens: Token[] = [];
  rocks: Rock[] = [];
  nextGate = 0;
  lastCheckpointS = 6;
  hits = 0; contactsTotal = 0; lastContactTime = -99;
  recoveries = 0;
  cleanLanding = false; landingAwarded = false;
  airStartS = 0;
  stuckTimer = 0;
  finishBlockedCooldown = 0;
  onRamp = false;
  results: Results | null = null;
  readonly finishS: number;
  /** increments on every teleport so views can clear wakes/damping */
  teleportSerial = 0;
  events: GameEvent[] = [];

  constructor(course = getCourse()) {
    this.course = course;
    this.finishS = course.length - 14;
    this.reset();
  }

  reset() {
    const c = this.course;
    const start = c.sampleAt(6);
    this.boat = makeBoat(start.x, start.waterY, start.z, Math.atan2(start.tx, start.tz));
    this.snapshot();
    this.phase = 'ready'; this.time = 0; this.countdown = 0; this.simTime = 0;
    this.gates = world.gates.map((g, i) => ({ id: g.id, index: i, s: g.u * c.length, halfWidth: g.halfWidth, passed: false }));
    this.tokens = world.tokens.map(t => {
      const s = t.u * c.length; const p = c.toWorld(s, t.lateral);
      return { id: t.id, s, lateral: t.lateral, x: p.x, y: this.surfaceY(s, t.lateral) + 0.95, z: p.z, collected: false };
    });
    this.rocks = world.rocks.map(r => {
      const s = r.u * c.length; const p = c.toWorld(s, r.lateral);
      return { id: r.id, s, lateral: r.lateral, x: p.x, z: p.z, radius: r.radius };
    });
    this.nextGate = 0; this.lastCheckpointS = 6;
    this.hits = 0; this.contactsTotal = 0; this.lastContactTime = -99; this.recoveries = 0;
    this.cleanLanding = false; this.landingAwarded = false; this.stuckTimer = 0; this.finishBlockedCooldown = 0;
    this.results = null; this.onRamp = false;
    const pr = c.project(this.boat.x, this.boat.z, 6, 20);
    this.progressS = pr.s; this.lateral = pr.lateral; this.progressIndex = pr.index;
    this.teleportSerial++;
    this.events = [];
  }

  start() { if (this.phase === 'ready') { this.phase = 'countdown'; this.countdown = 3; } }

  get suns() { return this.tokens.filter(t => t.collected).length; }
  get gatesPassed() { return this.gates.filter(g => g.passed).length; }
  get liveScore() {
    const v = this.suns * POINTS.token + this.gatesPassed * POINTS.gate + (this.landingAwarded ? POINTS.landing : 0) - this.hits * POINTS.hit;
    return Math.max(0, v);
  }

  /** Effective navigable half width (narrowed at the ramp so the leap is a deliberate line). */
  channelHalfWidth(s: number): number {
    const j = this.course.jump;
    const hw = this.course.sampleAt(s).halfWidth;
    if (s > j.rampEndS - j.rampLength - 6 && s < j.gapEndS) {
      // funnel into the ramp
      const k = Math.min(1, Math.max(0, (s - (j.rampEndS - j.rampLength - 6)) / 6));
      return hw + (j.rampHalfWidth + 0.6 - hw) * k;
    }
    return hw;
  }

  rampHeightAt(s: number, lateral: number): number {
    const j = this.course.jump;
    const a = j.rampEndS - j.rampLength;
    if (s < a || s > j.rampEndS || Math.abs(lateral) > j.rampHalfWidth) return 0;
    return j.rampHeight * ((s - a) / j.rampLength);
  }

  surfaceY(s: number, lateral: number): number {
    return this.course.sampleAt(s).waterY + this.rampHeightAt(s, lateral);
  }

  private snapshot() {
    const b = this.boat;
    this.prev = { x: b.x, y: b.y, z: b.z, heading: b.heading, bank: b.bank, pitch: b.pitch };
  }

  private emit(e: GameEvent) { this.events.push(e); }

  step(inp: InputState) {
    this.snapshot();
    if (this.phase === 'ready' || this.phase === 'finished') {
      // idle bobbing only
      this.boat.y = this.surfaceY(this.progressS, this.lateral);
      if (this.phase === 'finished') this.integrateCoast();
      return;
    }
    if (this.phase === 'countdown') {
      this.countdown -= DT;
      if (this.countdown <= 0) { this.phase = 'running'; this.emit({ type: 'go' }); }
      this.boat.y = this.surfaceY(this.progressS, this.lateral);
      return;
    }
    this.simTime += DT; this.time += DT;
    if (this.finishBlockedCooldown > 0) this.finishBlockedCooldown -= DT;
    const b = this.boat;
    const wasBoosting = b.boosting;
    stepControls(b, inp, DT);
    if (b.boosting && !wasBoosting) this.emit({ type: 'boost' });
    const prevS = this.progressS;
    const px = b.x, pz = b.z;
    if (b.airborne) this.stepAir(); else this.stepWater();
    if (this.phase !== 'running') return;
    const pr = this.course.project(b.x, b.z, this.progressIndex);
    this.progressS = pr.s; this.lateral = pr.lateral; this.progressIndex = pr.index;
    if (!b.airborne) { this.collideRocks(px, pz); this.collideBanks(); }
    this.checkGates(prevS, this.progressS);
    this.checkTokens(px, pz);
    this.checkFinish(prevS, this.progressS);
    this.checkStuck(inp);
    this.updateVisualAttitude();
  }

  private integrateCoast() {
    const b = this.boat;
    b.speed = Math.max(0, b.speed - 3 * DT); b.steer *= 0.9;
    const f = forwardOf(b.heading);
    b.x += f.x * b.speed * DT; b.z += f.z * b.speed * DT;
    const pr = this.course.project(b.x, b.z, this.progressIndex);
    this.progressS = pr.s; this.lateral = pr.lateral; this.progressIndex = pr.index;
    this.collideBanks();
    b.y = this.surfaceY(this.progressS, this.lateral);
    this.updateVisualAttitude();
  }

  private stepWater() {
    const b = this.boat; const c = this.course;
    const f = forwardOf(b.heading), r = rightOf(b.heading);
    const smp = c.sampleAt(this.progressS);
    const cur = TUNING.current * (c.zoneAt(this.progressS) === 'Rapid steps' ? 1.6 : 1);
    b.x += (f.x * b.speed + r.x * b.slip + smp.tx * cur) * DT;
    b.z += (f.z * b.speed + r.z * b.slip + smp.tz * cur) * DT;
    const pr = c.project(b.x, b.z, this.progressIndex);
    const surf = this.surfaceY(pr.s, pr.lateral);
    const onRampNow = this.rampHeightAt(pr.s, pr.lateral) > 0;
    const j = c.jump;
    // launch: drove off the ramp lip
    if (this.onRamp && pr.s >= j.rampEndS && Math.abs(pr.lateral) <= j.rampHalfWidth + 0.5 && b.speed > 2) {
      b.airborne = true; b.vy = TUNING.launchUp;
      b.airVx = f.x * b.speed + r.x * b.slip; b.airVz = f.z * b.speed + r.z * b.slip;
      b.y = c.sampleAt(j.rampEndS).waterY + j.rampHeight;
      this.airStartS = pr.s; this.onRamp = false;
      this.emit({ type: 'launch' });
      return;
    }
    this.onRamp = onRampNow;
    // fell into the cascade gap without flying
    if (pr.s > j.rampEndS + 0.5 && pr.s < j.gapEndS) { this.recover('missed-jump'); return; }
    const t = this.simTime;
    const wave = 0.05 * Math.sin(t * 2.3 + b.x * 0.4) + 0.04 * Math.sin(t * 3.1 + b.z * 0.5);
    const target = surf + (onRampNow ? 0 : wave);
    b.y += (target - b.y) * Math.min(1, DT * 18);
    b.vy = 0;
  }

  private stepAir() {
    const b = this.boat; const c = this.course;
    // limited air steering rotates the horizontal velocity slightly
    const steerRot = -b.steer * TUNING.maxYawRate * TUNING.airSteer * 0.5 * DT;
    const cs = Math.cos(steerRot), sn = Math.sin(steerRot);
    const vx = b.airVx * cs + b.airVz * sn, vz = -b.airVx * sn + b.airVz * cs;
    b.airVx = vx; b.airVz = vz;
    b.x += b.airVx * DT; b.z += b.airVz * DT;
    b.vy -= TUNING.gravity * DT; b.y += b.vy * DT;
    const pr = c.project(b.x, b.z, this.progressIndex, 40);
    const surf = this.surfaceY(pr.s, pr.lateral);
    if (b.y <= surf && b.vy < 0) {
      const j = c.jump;
      const inGap = pr.s < j.gapEndS;
      const outOfChannel = Math.abs(pr.lateral) > this.channelHalfWidth(pr.s) + 0.5;
      const vyLand = b.vy;
      b.airborne = false; b.y = surf; b.vy = 0;
      if (inGap || outOfChannel) {
        this.progressS = pr.s; this.lateral = pr.lateral; this.progressIndex = pr.index;
        this.recover(inGap ? 'missed-jump' : 'out-of-channel');
        return;
      }
      const f = forwardOf(b.heading);
      b.speed = Math.max(4, (b.airVx * f.x + b.airVz * f.z) * 0.88); b.slip = 0;
      const dx = b.x - j.landX, dz = b.z - j.landZ;
      const along = dx * j.landTx + dz * j.landTz, side = dx * -j.landTz + dz * j.landTx;
      const inZone = (along / j.landHalfLength) ** 2 + (side / j.landHalfWidth) ** 2 <= 1;
      const clean = inZone && Math.abs(b.bank) < 0.35 && vyLand > -16;
      if (clean && !this.landingAwarded) { this.landingAwarded = true; this.cleanLanding = true; }
      this.emit({ type: 'land', result: clean ? 'clean' : 'rough', vy: vyLand });
    }
  }

  private applyContact(nx: number, nz: number, strength: number) {
    const b = this.boat;
    const f = forwardOf(b.heading), r = rightOf(b.heading);
    let vx = f.x * b.speed + r.x * b.slip, vz = f.z * b.speed + r.z * b.slip;
    const vn = vx * nx + vz * nz;
    if (vn < 0) { vx -= 1.5 * vn * nx; vz -= 1.5 * vn * nz; }
    vx *= 0.62; vz *= 0.62;
    b.speed = vx * f.x + vz * f.z; b.slip = vx * r.x + vz * r.z;
    if (vn < -0.3) {
      this.contactsTotal++;
      const charged = this.simTime - this.lastContactTime >= CONTACT_COOLDOWN;
      if (charged) { this.hits++; this.lastContactTime = this.simTime; }
      this.emit({ type: 'scrape', charged, x: b.x, z: b.z, strength: Math.min(1, Math.abs(vn) / 10 + strength * 0) });
    }
  }

  /** Swept circle vs rock circles: test the segment from previous to current position. */
  private collideRocks(px: number, pz: number) {
    const b = this.boat;
    for (const rk of this.rocks) {
      if (Math.abs(rk.s - this.progressS) > 30) continue;
      const R = rk.radius + TUNING.hullRadius;
      const ex = b.x - px, ez = b.z - pz; const len2 = ex * ex + ez * ez;
      let t = len2 > 0 ? ((rk.x - px) * ex + (rk.z - pz) * ez) / len2 : 1; t = Math.max(0, Math.min(1, t));
      const cx = px + ex * t, cz = pz + ez * t;
      const dx = cx - rk.x, dz = cz - rk.z; const d = Math.hypot(dx, dz);
      if (d < R) {
        const nx = d > 1e-5 ? dx / d : -ex / Math.sqrt(len2 || 1), nz = d > 1e-5 ? dz / d : -ez / Math.sqrt(len2 || 1);
        b.x = rk.x + nx * (R + 0.01); b.z = rk.z + nz * (R + 0.01);
        this.applyContact(nx, nz, 1);
      }
    }
  }

  private collideBanks() {
    const b = this.boat; const c = this.course;
    const hw = this.channelHalfWidth(this.progressS) - TUNING.hullRadius;
    const smp = c.sampleAt(this.progressS);
    if (Math.abs(this.lateral) > hw) {
      const sgn = Math.sign(this.lateral);
      const push = Math.abs(this.lateral) - hw;
      b.x -= smp.rx * sgn * push; b.z -= smp.rz * sgn * push;
      this.lateral = sgn * hw;
      if (this.phase === 'running') this.applyContact(-smp.rx * sgn, -smp.rz * sgn, 0.5);
    }
    // course ends (upstream start and downstream lagoon wall)
    if (this.progressS < 1 || this.progressS > c.length - 3) {
      const dir = this.progressS < 1 ? 1 : -1;
      const lim = this.progressS < 1 ? 1 : c.length - 3;
      const p = c.toWorld(lim, this.lateral);
      b.x = p.x; b.z = p.z; this.progressS = lim;
      if (this.phase === 'running') this.applyContact(smp.tx * dir, smp.tz * dir, 0.5);
    }
  }

  private checkGates(prevS: number, s: number) {
    for (const g of this.gates) {
      const crossedFwd = prevS < g.s && s >= g.s;
      const crossedBack = prevS >= g.s && s < g.s;
      if (!crossedFwd && !crossedBack) continue;
      if (Math.abs(this.lateral) > g.halfWidth) continue;
      if (crossedBack) { this.emit({ type: 'gateIgnored', index: g.index, reason: 'backward' }); continue; }
      if (g.passed) { this.emit({ type: 'gateIgnored', index: g.index, reason: 'repeat' }); continue; }
      if (g.index !== this.nextGate) { this.emit({ type: 'gateIgnored', index: g.index, reason: 'order' }); continue; }
      g.passed = true; this.nextGate++; this.lastCheckpointS = g.s + 3;
      this.emit({ type: 'gate', index: g.index, id: g.id });
    }
  }

  private checkTokens(px: number, pz: number) {
    const b = this.boat;
    for (const t of this.tokens) {
      if (t.collected) continue;
      if (Math.abs(t.s - this.progressS) > 25) continue;
      // swept distance against the token
      const ex = b.x - px, ez = b.z - pz; const len2 = ex * ex + ez * ez;
      let k = len2 > 0 ? ((t.x - px) * ex + (t.z - pz) * ez) / len2 : 1; k = Math.max(0, Math.min(1, k));
      const d = Math.hypot(px + ex * k - t.x, pz + ez * k - t.z);
      if (d < 1.9 && Math.abs(b.y + 0.6 - t.y) < 2.2) {
        t.collected = true;
        this.emit({ type: 'pickup', id: t.id, x: t.x, y: t.y, z: t.z });
      }
    }
  }

  private checkFinish(prevS: number, s: number) {
    if (!(prevS < this.finishS && s >= this.finishS)) return;
    const missing = this.gates.length - this.gatesPassed;
    if (missing > 0) {
      if (this.finishBlockedCooldown <= 0) { this.emit({ type: 'finishBlocked', missing }); this.finishBlockedCooldown = 2; }
      return;
    }
    this.phase = 'finished';
    const tokenPoints = this.suns * POINTS.token;
    const gatePoints = this.gatesPassed * POINTS.gate;
    const landingBonus = this.landingAwarded ? POINTS.landing : 0;
    const penalties = this.hits * POINTS.hit;
    const timeBonus = Math.max(0, Math.round((POINTS.timeBonusPar - this.time) * POINTS.timeBonusPerSec));
    const base = Math.max(0, tokenPoints + gatePoints + landingBonus - penalties);
    this.results = {
      time: this.time, suns: this.suns, totalSuns: this.tokens.length, gates: this.gatesPassed, hits: this.hits,
      penalties, recoveries: this.recoveries, cleanLanding: this.cleanLanding, landingBonus, gatePoints, tokenPoints,
      timeBonus, score: base + timeBonus,
      stars: starsFor({ time: this.time, suns: this.suns, recoveries: this.recoveries, cleanLanding: this.cleanLanding }),
    };
    this.emit({ type: 'finish' });
  }

  private checkStuck(inp: InputState) {
    if (inp.throttle && Math.abs(this.boat.speed) < 1.2 && !this.boat.airborne) this.stuckTimer += DT;
    else this.stuckTimer = Math.max(0, this.stuckTimer - DT * 2);
    if (this.stuckTimer > 4) this.recover('stuck');
  }

  recover(reason: 'missed-jump' | 'out-of-channel' | 'stuck') {
    const c = this.course; const s = this.lastCheckpointS;
    const smp = c.sampleAt(s);
    const b = this.boat;
    b.x = smp.x; b.z = smp.z; b.y = smp.waterY; b.heading = Math.atan2(smp.tx, smp.tz);
    b.speed = 6; b.slip = 0; b.vy = 0; b.airborne = false; b.steer = 0; b.bank = 0; b.pitch = 0;
    this.onRamp = false; this.stuckTimer = 0;
    this.time += POINTS.recoveryTime; this.recoveries++;
    const pr = c.project(b.x, b.z, Math.round(s), 40);
    this.progressS = pr.s; this.lateral = pr.lateral; this.progressIndex = pr.index;
    this.snapshot();
    this.teleportSerial++;
    this.emit({ type: 'recover', reason });
  }

  private updateVisualAttitude() {
    const b = this.boat;
    const maxBank = TUNING.maxBankDeg * Math.PI / 180;
    const targetBank = b.airborne ? b.bank * 0.98 : -b.steer * maxBank * Math.min(1, Math.abs(b.speed) / 10);
    b.bank += (targetBank - b.bank) * Math.min(1, DT * 6);
    let targetPitch = b.throttleLevel * 0.07 * Math.min(1, b.speed / 8);
    if (this.onRamp) targetPitch = Math.atan2(this.course.jump.rampHeight, this.course.jump.rampLength);
    if (b.airborne) targetPitch = Math.atan2(b.vy, Math.hypot(b.airVx, b.airVz)) * 0.7;
    b.pitch += (targetPitch - b.pitch) * Math.min(1, DT * 7);
  }

  drainEvents(): GameEvent[] { const e = this.events; this.events = []; return e; }
}
