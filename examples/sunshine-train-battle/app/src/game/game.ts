// Fixed-step simulation. Owns all rule state; views only read it and consume events.
import { buildSolids, CARS, ENEMIES, ENGINE_TRIGGER, ENGINE_TRIGGER_R, EnemyType, gateId, PLAYER_START, robotBounds, ROBOT_HP, ROOF_Y, SHIELD_ARC_DEG, TUNING, carAt } from './level';
import { movePlayer, raySolids, segmentAABB, segmentSphere, Solid, V3, v3 } from './collision';
import { addReserve, applyDamage, CELL_AMMO, collectNear, hashStr, inFrontArc, isReloading, Loot, LOOT_SCORE, newShield, newWeapon, rng, shieldBlock, ShieldState, startReload, tickShield, tickWeapon, tryFire, Weapon } from './rules';

export const DT = 1 / 60;
export const EYE = 1.6;

export type Phase = 'title' | 'playing' | 'paused' | 'dead' | 'won';
export type RobotState = 'idle' | 'move' | 'telegraph' | 'recover' | 'windup' | 'hop' | 'land' | 'stagger' | 'defeated';

export interface Robot {
  id: string; type: EnemyType; car: number;
  x: number; y: number; z: number; px: number; py: number; pz: number;
  yaw: number; hp: number; maxHp: number; defeated: boolean; dropped: boolean;
  state: RobotState; t: number; cooldown: number; strafe: number; seed: number; draws: number;
  hopFrom: { x: number; z: number }; hopTo: { x: number; z: number }; flash: number; staggerCd: number;
}
export interface Bolt { id: number; owner: 'player' | 'robot'; x: number; y: number; z: number; px: number; py: number; pz: number; vx: number; vy: number; vz: number; life: number; alive: boolean; src: string }
export interface Player {
  x: number; y: number; z: number; px: number; py: number; pz: number;
  vx: number; vy: number; vz: number; yaw: number; pitch: number;
  grounded: boolean; coyote: number; jumpBuf: number; health: number; stamina: number; sprinting: boolean; hurt: number; moving: number;
}
export type GameEvent = { type: string; x?: number; y?: number; z?: number; value?: number; id?: string; text?: string; kind?: string };

export interface InputFrame { moveX: number; moveZ: number; jump: boolean; sprint: boolean; fire: boolean; reload: boolean; shield: boolean; yaw: number; pitch: number }

interface Snapshot {
  health: number; energy: number; mag: number; reserve: number; score: number; crystals: number;
  robots: Robot[]; loot: Loot[]; collected: string[]; cleared: boolean[]; checkpoint: number;
}

export interface GameState {
  phase: Phase; time: number; score: number; crystals: number; shots: number; hits: number; recoveries: number; falls: number;
  player: Player; weapon: Weapon; shield: ShieldState;
  robots: Robot[]; loot: Loot[]; collectedIds: Set<string>; bolts: Bolt[];
  cleared: boolean[]; checkpoint: number; solids: Solid[];
  aim: { kind: 'robot' | 'solid' | 'none'; id: string; x: number; y: number; z: number };
  muzzleBlocked: boolean; lastStep: number;
}

let boltSeq = 0;

export class Game {
  s!: GameState;
  events: GameEvent[] = [];
  private snapshot!: Snapshot;
  /** camera-space muzzle offset (right, up, forward) supplied by the weapon view */
  muzzleOffset = { r: 0.2, u: -0.17, f: 0.62 };

  constructor() { this.reset(); }

  reset() {
    const solids = buildSolids();
    this.s = {
      phase: 'title', time: 0, score: 0, crystals: 0, shots: 0, hits: 0, recoveries: 0, falls: 0,
      player: {
        x: PLAYER_START.x, y: PLAYER_START.y, z: PLAYER_START.z, px: PLAYER_START.x, py: PLAYER_START.y, pz: PLAYER_START.z,
        vx: 0, vy: 0, vz: 0, yaw: 0, pitch: -0.08, grounded: true, coyote: 0, jumpBuf: 0, health: TUNING.health, stamina: 1, sprinting: false, hurt: 0, moving: 0,
      },
      weapon: newWeapon(), shield: newShield(),
      robots: ENEMIES.map((e) => this.makeRobot(e.id, e.type, e.car, e.x, e.z)),
      loot: [], collectedIds: new Set(), bolts: [],
      cleared: CARS.map((c) => c.required.length === 0), checkpoint: 0, solids,
      aim: { kind: 'none', id: '', x: 0, y: 0, z: 0 }, muzzleBlocked: false, lastStep: 0,
    };
    this.syncGates();
    this.events = [];
    this.snapshot = this.takeSnapshot();
  }

  private makeRobot(id: string, type: EnemyType, car: number, x: number, z: number): Robot {
    const seed = hashStr(id);
    return {
      id, type, car, x, y: ROOF_Y, z, px: x, py: ROOF_Y, pz: z, yaw: Math.PI, hp: ROBOT_HP[type], maxHp: ROBOT_HP[type],
      defeated: false, dropped: false, state: 'idle', t: 0.5, cooldown: 1.2 + (seed % 100) / 70, strafe: seed % 2 ? 1 : -1, seed, draws: 0,
      hopFrom: { x, z }, hopTo: { x, z }, flash: 0, staggerCd: 0,
    };
  }

  private rand(r: Robot) { r.draws++; return rng(r.seed + r.draws * 7919)(); }

  emit(e: GameEvent) { this.events.push(e); }

  private syncGates() {
    CARS.forEach((_, i) => { if (i > 0) { const g = this.s.solids.find((x) => x.id === gateId(i)); if (g) g.active = !this.s.cleared[i]; } });
  }

  private takeSnapshot(): Snapshot {
    const s = this.s;
    return JSON.parse(JSON.stringify({
      health: s.player.health, energy: s.shield.energy, mag: s.weapon.mag, reserve: s.weapon.reserve, score: s.score, crystals: s.crystals,
      robots: s.robots, loot: s.loot, collected: [...s.collectedIds], cleared: s.cleared, checkpoint: s.checkpoint,
    }));
  }

  checkpointSpawn(): V3 { return v3(0, ROOF_Y, CARS[this.s.checkpoint].z - 3.0); }

  private placeAtCheckpoint() {
    const p = this.s.player, c = this.checkpointSpawn();
    p.x = p.px = c.x; p.y = p.py = c.y; p.z = p.pz = c.z; p.vx = p.vy = p.vz = 0; p.yaw = 0; p.pitch = -0.08; p.coyote = 0; p.jumpBuf = 0;
  }

  /** Retry after defeat: restores the checkpoint snapshot (enemies, loot, collected IDs) so rewards cannot be farmed. */
  retry() {
    const s = this.s, sn: Snapshot = JSON.parse(JSON.stringify(this.snapshot));
    s.player.health = sn.health; s.shield = newShield(); s.shield.energy = sn.energy;
    s.weapon = newWeapon(); s.weapon.mag = sn.mag; s.weapon.reserve = sn.reserve;
    s.score = sn.score; s.crystals = sn.crystals; s.robots = sn.robots; s.loot = sn.loot; s.collectedIds = new Set(sn.collected);
    s.cleared = sn.cleared; s.checkpoint = sn.checkpoint; s.bolts = [];
    this.syncGates(); this.placeAtCheckpoint();
    s.recoveries++; s.phase = 'playing';
    this.emit({ type: 'retry' });
  }

  start() { this.s.phase = 'playing'; }

  step(inp: InputFrame) {
    const s = this.s;
    if (s.phase !== 'playing') return;
    s.time += DT;
    const p = s.player;
    p.px = p.x; p.py = p.y; p.pz = p.z;
    for (const r of s.robots) { r.px = r.x; r.py = r.y; r.pz = r.z; }
    p.yaw = inp.yaw; p.pitch = inp.pitch;
    this.stepPlayer(inp);
    this.stepWeapon(inp);
    this.stepRobots();
    this.stepBolts();
    this.stepLoot();
    this.stepProgress();
  }

  private stepPlayer(inp: InputFrame) {
    const s = this.s, p = s.player;
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    const rx = -Math.cos(p.yaw), rz = Math.sin(p.yaw);
    let wx = fx * inp.moveZ + rx * inp.moveX, wz = fz * inp.moveZ + rz * inp.moveX;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; }
    // brief sprint: stamina drains while sprinting forward, recovers after
    p.sprinting = inp.sprint && inp.moveZ > 0 && p.stamina > 0;
    if (p.sprinting) p.stamina = Math.max(0, p.stamina - DT / 2.2); else p.stamina = Math.min(1, p.stamina + DT * 0.4);
    const speed = p.sprinting ? TUNING.sprintSpeed : TUNING.walkSpeed;
    const accel = p.grounded ? 45 : 14;
    const tx = wx * speed, tz = wz * speed;
    const dvx = tx - p.vx, dvz = tz - p.vz, dl = Math.hypot(dvx, dvz), maxDv = accel * DT;
    if (dl > maxDv) { p.vx += (dvx / dl) * maxDv; p.vz += (dvz / dl) * maxDv; } else { p.vx = tx; p.vz = tz; }
    p.moving = Math.hypot(p.vx, p.vz);

    if (inp.jump) p.jumpBuf = 0.12;
    else p.jumpBuf = Math.max(0, p.jumpBuf - DT);
    if (p.jumpBuf > 0 && (p.grounded || p.coyote > 0)) {
      p.vy = TUNING.jumpUpSpeed; p.grounded = false; p.coyote = 0; p.jumpBuf = 0; this.emit({ type: 'jump' });
    }
    p.vy -= TUNING.gravity * DT;
    const wasGrounded = p.grounded, fallSpeed = p.vy;
    // step-ups only while grounded, so gaps must be jumped rather than walked across
    const res = movePlayer(p, v3(p.vx * DT, p.vy * DT, p.vz * DT), s.solids, wasGrounded || p.coyote > 0);
    if (res.hitCeiling && p.vy > 0) p.vy = 0;
    if (res.grounded) {
      if (!wasGrounded && fallSpeed < -4) this.emit({ type: 'land' });
      p.vy = 0; p.grounded = true; p.coyote = 0.1;
    } else {
      p.grounded = false; p.coyote = Math.max(0, p.coyote - DT);
    }
    // robots are solid: push the player out of their body cylinders (no walking into / through enemies)
    for (const r of s.robots) {
      if (r.defeated) continue;
      const min = robotRadius(r.type) + 0.32;
      const dx = p.x - r.x, dz = p.z - r.z, d = Math.hypot(dx, dz);
      if (d >= min || p.y > r.y + 1.3 || p.y + 1.75 < r.y) continue;
      const nx = d > 1e-4 ? dx / d : 0, nz = d > 1e-4 ? dz / d : -1;
      const push = min - d;
      const old = v3(p.x, p.y, p.z);
      movePlayer(p, v3(nx * push, 0, nz * push), s.solids, false);
      if (Math.hypot(p.x - old.x, p.z - old.z) < push * 0.5) { r.x -= nx * push * 0.5; r.z -= nz * push * 0.5; } // pinned against cover: nudge the robot instead
      const vn = p.vx * nx + p.vz * nz; if (vn < 0) { p.vx -= vn * nx; p.vz -= vn * nz; }
    }
    if (p.hurt > 0) p.hurt -= DT;
    // fell below the train: return to the most recently cleared car with a penalty
    if (p.y < -0.4) {
      s.score = Math.max(0, s.score - 50); s.recoveries++; s.falls++;
      this.placeAtCheckpoint();
      this.emit({ type: 'fall', value: -50 });
    }
  }

  eye(): V3 { const p = this.s.player; return v3(p.x, p.y + EYE, p.z); }
  forward(): V3 { const p = this.s.player, c = Math.cos(p.pitch); return v3(Math.sin(p.yaw) * c, Math.sin(p.pitch), Math.cos(p.yaw) * c); }

  /** Nearest target along the reticle ray (solids and robots). */
  private aimRay() {
    const s = this.s, e = this.eye(), f = this.forward(), far = 120;
    const end = v3(e.x + f.x * far, e.y + f.y * far, e.z + f.z * far);
    let best = 1, kind: 'robot' | 'solid' | 'none' = 'none', id = '';
    const hs = raySolids(e, end, s.solids);
    if (hs) { best = hs.t; kind = 'solid'; id = hs.solid.id; }
    for (const r of s.robots) {
      if (r.defeated) continue;
      const t = segmentSphere(e, end, robotCenter(r), robotRadius(r.type) + 0.05);
      if (t !== null && t < best) { best = t; kind = 'robot'; id = r.id; }
    }
    s.aim = { kind, id, x: e.x + (end.x - e.x) * best, y: e.y + (end.y - e.y) * best, z: e.z + (end.z - e.z) * best };
  }

  muzzleWorld(): V3 {
    const p = this.s.player, e = this.eye(), f = this.forward();
    const r = v3(-Math.cos(p.yaw), 0, Math.sin(p.yaw));
    const u = v3(r.y * f.z - r.z * f.y, r.z * f.x - r.x * f.z, r.x * f.y - r.y * f.x); // up = right x forward
    const m = this.muzzleOffset;
    return v3(e.x + r.x * m.r + u.x * m.u + f.x * m.f, e.y + r.y * m.r + u.y * m.u + f.y * m.f, e.z + r.z * m.r + u.z * m.u + f.z * m.f);
  }

  private stepWeapon(inp: InputFrame) {
    const s = this.s;
    tickShield(s.shield, inp.shield, DT);
    if (tickWeapon(s.weapon, DT)) this.emit({ type: 'reloadDone' });
    if (inp.reload && startReload(s.weapon)) this.emit({ type: 'reload' });
    this.aimRay();
    if (!inp.fire) return;
    if (s.weapon.mag <= 0 && !isReloading(s.weapon)) { if (startReload(s.weapon)) this.emit({ type: 'reload' }); else if (s.weapon.fireCooldown <= 0) { s.weapon.fireCooldown = 0.3; this.emit({ type: 'dry' }); } return; }
    if (!tryFire(s.weapon, s.shield.active)) return;
    s.shots++;
    const e = this.eye();
    let m = this.muzzleWorld();
    // muzzle obstruction: if the weapon is pushed into geometry, launch from the eye instead
    s.muzzleBlocked = !!raySolids(e, m, s.solids);
    if (s.muzzleBlocked) m = e;
    let dx = s.aim.x - m.x, dy = s.aim.y - m.y, dz = s.aim.z - m.z;
    let dl = Math.hypot(dx, dy, dz);
    if (dl < 1.0) { const f = this.forward(); dx = f.x; dy = f.y; dz = f.z; dl = 1; }
    const sp = TUNING.projectileSpeed;
    s.bolts.push({ id: ++boltSeq, owner: 'player', x: m.x, y: m.y, z: m.z, px: m.x, py: m.y, pz: m.z, vx: dx / dl * sp, vy: dy / dl * sp, vz: dz / dl * sp, life: TUNING.projectileLifetime, alive: true, src: 'player' });
    this.emit({ type: 'fire', x: m.x, y: m.y, z: m.z });
  }

  private los(a: V3, b: V3) { return !raySolids(a, b, this.s.solids); }

  private stepRobots() {
    const s = this.s, p = s.player, pc = carAt(p.z);
    const target = v3(p.x, p.y + 1.15, p.z);
    for (const r of s.robots) {
      if (r.defeated) continue;
      if (r.flash > 0) r.flash -= DT;
      if (r.staggerCd > 0) r.staggerCd -= DT;
      const awake = pc >= r.car - 1 && Math.abs(p.z - r.z) < 17;
      if (!awake) continue;
      const dx = p.x - r.x, dz = p.z - r.z, dist = Math.hypot(dx, dz);
      const want = Math.atan2(dx, dz);
      // shield robots turn slowly and hold their facing while attacking, so flanking is a real option
      const turn = r.type === 'shield' ? (r.state === 'telegraph' || r.state === 'recover' ? 0 : 0.75) : 5;
      r.yaw = turnToward(r.yaw, want, turn * DT);
      const c = robotCenter(r);
      const sees = dist < 22 && this.los(c, target);
      r.t -= DT; r.cooldown -= DT;
      const b = robotBounds(r.car);
      switch (r.state) {
        case 'idle': case 'move': {
          if (r.type === 'jumper') {
            if (r.t <= 0) {
              if (r.cooldown <= 0 && sees) { r.state = 'telegraph'; r.t = 0.6; this.emit({ type: 'telegraph', id: r.id }); }
              else { r.state = 'windup'; r.t = 0.55; }
            }
            break;
          }
          r.state = 'move';
          const sp = r.type === 'shield' ? 1.1 : 1.7;
          let mx = 0, mz = 0;
          const nx = dx / (dist || 1), nz = dz / (dist || 1);
          const near = r.type === 'shield' ? 4.8 : 4.5, far = r.type === 'shield' ? 7.0 : 8.5;
          if (dist > far) { mx = nx; mz = nz; } else if (dist < near) { mx = -nx; mz = -nz; }
          else { mx = -nz * r.strafe * 0.7; mz = nx * r.strafe * 0.7; }
          if (r.t <= 0) { r.strafe *= -1; r.t = 1.6 + this.rand(r) * 1.4; }
          this.moveRobot(r, mx * sp * DT, mz * sp * DT);
          if (r.cooldown <= 0 && sees) { r.state = 'telegraph'; r.t = r.type === 'shield' ? 0.85 : 0.75; this.emit({ type: 'telegraph', id: r.id }); }
          break;
        }
        case 'telegraph':
          if (r.t <= 0) {
            if (sees) this.robotFire(r, target);
            r.state = 'recover'; r.t = r.type === 'shield' ? 1.6 : 0.9;
            r.cooldown = (r.type === 'shield' ? 2.9 : r.type === 'jumper' ? 2.4 : 2.1) + this.rand(r) * 1.2;
          }
          break;
        case 'recover': case 'stagger':
          if (r.t <= 0) { r.state = 'idle'; r.t = r.type === 'jumper' ? 0.5 : 0.8; }
          break;
        case 'windup':
          if (r.t <= 0) {
            r.hopFrom = { x: r.x, z: r.z };
            r.hopTo = this.pickHop(r, b);
            r.state = 'hop'; r.t = 0.75; this.emit({ type: 'hop', id: r.id });
          }
          break;
        case 'hop': {
          const k = 1 - Math.max(0, r.t) / 0.75;
          r.x = r.hopFrom.x + (r.hopTo.x - r.hopFrom.x) * k;
          r.z = r.hopFrom.z + (r.hopTo.z - r.hopFrom.z) * k;
          r.y = ROOF_Y + Math.sin(k * Math.PI) * 1.6;
          if (r.t <= 0) { r.x = r.hopTo.x; r.z = r.hopTo.z; r.y = ROOF_Y; r.state = 'land'; r.t = 0.8; this.emit({ type: 'robotLand', id: r.id, x: r.x, y: r.y, z: r.z }); }
          break;
        }
        case 'land':
          if (r.t <= 0) { r.state = 'idle'; r.t = 0.3 + this.rand(r) * 0.5; }
          break;
      }
    }
  }

  private pickHop(r: Robot, b: { x0: number; x1: number; z0: number; z1: number }) {
    for (let i = 0; i < 12; i++) {
      const a = this.rand(r) * Math.PI * 2, d = 2 + this.rand(r) * 2.5;
      const x = r.x + Math.cos(a) * d, z = r.z + Math.sin(a) * d;
      if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
      if (this.robotBlocked(x, z, r)) continue;
      return { x, z };
    }
    return { x: r.x, z: r.z };
  }

  private robotBlocked(x: number, z: number, self: Robot) {
    const rad = 0.5;
    for (const s of this.s.solids) {
      if (s.kind !== 'cover' || !s.active) continue;
      if (x + rad > s.min.x && x - rad < s.max.x && z + rad > s.min.z && z - rad < s.max.z) return true;
    }
    for (const o of this.s.robots) if (o !== self && !o.defeated && Math.hypot(o.x - x, o.z - z) < 1.1) return true;
    const p = this.s.player;
    if (Math.abs(p.y - ROOF_Y) < 1.5 && Math.hypot(p.x - x, p.z - z) < robotRadius(self.type) + 0.9) return true;
    return false;
  }

  private moveRobot(r: Robot, mx: number, mz: number) {
    const b = robotBounds(r.car);
    const nx = Math.min(b.x1, Math.max(b.x0, r.x + mx));
    if (!this.robotBlocked(nx, r.z, r)) r.x = nx;
    const nz = Math.min(b.z1, Math.max(b.z0, r.z + mz));
    if (!this.robotBlocked(r.x, nz, r)) r.z = nz;
  }

  private robotFire(r: Robot, target: V3) {
    const c = robotCenter(r);
    const fx = Math.sin(r.yaw), fz = Math.cos(r.yaw);
    const o = v3(c.x + fx * 0.6, c.y + 0.05, c.z + fz * 0.6);
    const dx = target.x - o.x, dy = target.y - o.y, dz = target.z - o.z, dl = Math.hypot(dx, dy, dz) || 1;
    const sp = 11;
    this.s.bolts.push({ id: ++boltSeq, owner: 'robot', x: o.x, y: o.y, z: o.z, px: o.x, py: o.y, pz: o.z, vx: dx / dl * sp, vy: dy / dl * sp, vz: dz / dl * sp, life: 3, alive: true, src: r.id });
    this.emit({ type: 'robotFire', id: r.id, x: o.x, y: o.y, z: o.z });
  }

  private stepBolts() {
    const s = this.s;
    for (const b of s.bolts) {
      if (!b.alive) continue;
      b.px = b.x; b.py = b.y; b.pz = b.z;
      const p0 = v3(b.x, b.y, b.z), p1 = v3(b.x + b.vx * DT, b.y + b.vy * DT, b.z + b.vz * DT);
      b.life -= DT;
      let bestT = 2, act: (() => void) | null = null;
      const hs = raySolids(p0, p1, s.solids);
      if (hs) { bestT = hs.t; act = () => this.emit({ type: 'impact', kind: b.owner, x: p0.x + (p1.x - p0.x) * hs.t, y: p0.y + (p1.y - p0.y) * hs.t, z: p0.z + (p1.z - p0.z) * hs.t }); }
      if (b.owner === 'player') {
        for (const r of s.robots) {
          if (r.defeated) continue;
          const c = robotCenter(r);
          if (r.type === 'shield') {
            const ts = segmentSphere(p0, p1, c, 0.98);
            // barrier is down while the robot recovers from its own shot (readable punish window)
            if (ts !== null && ts < bestT && r.state !== 'recover' && inFrontArc(r.yaw, b.vx, b.vz, SHIELD_ARC_DEG)) {
              bestT = ts; const hx = p0.x + (p1.x - p0.x) * ts, hy = p0.y + (p1.y - p0.y) * ts, hz = p0.z + (p1.z - p0.z) * ts;
              act = () => this.emit({ type: 'robotShieldBlock', id: r.id, x: hx, y: hy, z: hz });
              continue;
            }
          }
          const t = segmentSphere(p0, p1, c, robotRadius(r.type));
          if (t !== null && t < bestT) { bestT = t; const hx = p0.x + (p1.x - p0.x) * t, hy = p0.y + (p1.y - p0.y) * t, hz = p0.z + (p1.z - p0.z) * t; act = () => this.hitRobot(r, hx, hy, hz); }
        }
      } else {
        const p = s.player;
        if (s.shield.active) {
          const e = this.eye(), f = this.forward();
          const c = v3(e.x + f.x * 0.55, e.y - 0.25, e.z + f.z * 0.55);
          const t = segmentSphere(p0, p1, c, 0.85);
          if (t !== null && t < bestT && inFrontArc(p.yaw, b.vx, b.vz, 120)) {
            bestT = t; const hx = p0.x + (p1.x - p0.x) * t, hy = p0.y + (p1.y - p0.y) * t, hz = p0.z + (p1.z - p0.z) * t;
            act = () => { shieldBlock(s.shield); this.emit({ type: 'shieldBlock', x: hx, y: hy, z: hz }); };
          }
        }
        const t = segmentAABB(p0, p1, v3(p.x - 0.35, p.y, p.z - 0.35), v3(p.x + 0.35, p.y + 1.75, p.z + 0.35));
        if (t !== null && t < bestT) { bestT = t; act = () => this.hurtPlayer(TUNING.enemyDamage, b.src); }
      }
      if (act) { b.alive = false; act(); continue; }
      b.x = p1.x; b.y = p1.y; b.z = p1.z;
      if (b.life <= 0) b.alive = false;
    }
    s.bolts = s.bolts.filter((b) => b.alive);
  }

  hitRobot(r: Robot, x: number, y: number, z: number) {
    const s = this.s;
    const res = applyDamage(r, TUNING.damage);
    if (res === 'none') return;
    s.hits++;
    r.flash = 0.12;
    this.emit({ type: 'hit', id: r.id, x, y, z });
    if (res === 'defeat') {
      r.state = 'defeated';
      s.score += 90;
      this.emit({ type: 'defeat', id: r.id, x: r.x, y: r.y + 0.7, z: r.z, value: 90, kind: r.type });
      this.dropLoot(r);
    } else if (r.type !== 'shield' && r.state !== 'hop' && r.state !== 'windup' && r.staggerCd <= 0) {
      // brief flinch, then a cooldown so sustained fire can't pin a robot in place
      r.state = 'stagger'; r.t = 0.18; r.staggerCd = 0.9;
    }
  }

  private dropLoot(r: Robot) {
    if (r.dropped) return; // separate hit events from final defeat: drop exactly once
    r.dropped = true;
    const kinds: Loot['kind'][] = r.type === 'shield' ? ['orange', 'blue'] : ['blue'];
    if (r.type !== 'shield' || r.car >= 4) kinds.push('cell');
    const b = robotBounds(r.car);
    const inCover = (x: number, z: number) => this.s.solids.some((o) => o.kind === 'cover' && o.active && x > o.min.x - 0.35 && x < o.max.x + 0.35 && z > o.min.z - 0.35 && z < o.max.z + 0.35);
    kinds.forEach((k, i) => {
      // drops always land on open, reachable roof (never inside vents/cover)
      let x = r.x, z = r.z;
      for (let tries = 0; tries < 16; tries++) {
        const a = (i / kinds.length) * Math.PI * 2 + (r.seed % 7) + tries * 0.9, d = 0.55 + tries * 0.12;
        const cx = Math.min(b.x1, Math.max(b.x0, r.x + Math.cos(a) * d)), cz = Math.min(b.z1, Math.max(b.z0, r.z + Math.sin(a) * d));
        if (!inCover(cx, cz)) { x = cx; z = cz; break; }
      }
      this.s.loot.push({ id: `${r.id}-loot-${i}`, kind: k, x, y: ROOF_Y + 0.55, z, collected: false, age: 0 });
    });
  }

  hurtPlayer(dmg: number, src: string) {
    const p = this.s.player;
    p.health = Math.max(0, p.health - dmg); p.hurt = 0.35;
    this.emit({ type: 'hurt', value: dmg, id: src });
    if (p.health <= 0 && this.s.phase === 'playing') { this.s.phase = 'dead'; this.emit({ type: 'dead' }); }
  }

  private stepLoot() {
    const s = this.s, p = s.player;
    for (const l of s.loot) l.age += DT;
    for (const l of collectNear(s.loot, s.collectedIds, p.x, p.y + 0.6, p.z)) {
      if (l.kind === 'cell') { addReserve(s.weapon, CELL_AMMO); this.emit({ type: 'pickup', kind: 'cell', x: l.x, y: l.y, z: l.z, value: CELL_AMMO }); }
      else { s.score += LOOT_SCORE[l.kind]; s.crystals++; this.emit({ type: 'pickup', kind: l.kind, x: l.x, y: l.y, z: l.z, value: LOOT_SCORE[l.kind] }); }
    }
    s.loot = s.loot.filter((l) => !l.collected);
  }

  private stepProgress() {
    const s = this.s;
    CARS.forEach((car, i) => {
      if (s.cleared[i]) return;
      if (car.required.every((id) => s.robots.find((r) => r.id === id)?.defeated)) {
        s.cleared[i] = true;
        s.checkpoint = i;
        s.player.health = Math.min(TUNING.health, s.player.health + 25);
        addReserve(s.weapon, 12);
        this.syncGates();
        this.emit({ type: 'carClear', value: i, text: car.name });
        this.snapshot = this.takeSnapshot();
      }
    });
    const p = s.player;
    if (s.cleared[5] && Math.hypot(p.x - ENGINE_TRIGGER.x, p.z - ENGINE_TRIGGER.z) < ENGINE_TRIGGER_R && p.y >= ROOF_Y - 0.1) {
      s.phase = 'won'; this.emit({ type: 'win' });
    }
  }

  get accuracy() { return this.s.shots ? this.s.hits / this.s.shots : 0; }
  get finalScore() { const s = this.s; return s.score + Math.max(0, Math.round(600 - s.time * 2)) + Math.round(this.accuracy * 200); }
}

export function robotCenter(r: { x: number; y: number; z: number; type: EnemyType }): V3 {
  return v3(r.x, r.y + (r.type === 'shield' ? 0.78 : r.type === 'jumper' ? 0.74 : 0.74), r.z);
}
export function robotRadius(t: EnemyType) { return t === 'shield' ? 0.56 : t === 'jumper' ? 0.48 : 0.52; }
function turnToward(a: number, b: number, max: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + Math.max(-max, Math.min(max, d));
}
