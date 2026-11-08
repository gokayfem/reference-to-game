import * as THREE from 'three';
import world from '../data/world.json';
import type { Tex } from '../core/assets';
import type { Input } from '../core/input';
import type { Audio, Sfx } from '../core/audio';
import { buildWorld, type WorldView, makeBlobShadow, spriteGeometry, spriteMaterial } from '../world/scene';
import { NavGrid, START, bridgeAt, walkable, surfaceHeight, groundHeight, HABITAT_ZONES, BOUNDS, type V2, rng, inWater } from '../world/layout';
import { Actor, makeCompanion, makeExplorer, wrap } from './actors';
import { Ambient } from '../world/ambient';
import {
  COMPANIONS, SPECIES, T, type CompanionId, type GameState, type RuleEvent, type SpeciesId, type PhotoCandidate,
  canBefriend, canOffer, choosePhotoSubject, collectFruit, commitBefriend, commitOffer, completeObserve, enterHabitat, fluteComplete, recordPhoto, photoValid,
} from './state';

export type ActionKind = 'observe' | 'offer' | 'photo' | 'befriend';
export interface Creature { eid: string; species: SpeciesId; name: string; actor: Actor; companion?: CompanionId; wild?: Wild }
interface Wild { home: V2; radius: number; target: V2 | null; wait: number; speed: number; kind: 'grazer' | 'finch'; fly?: { from: V2; to: V2; t: number; dur: number } }
type CompState = 'follow' | 'idle' | 'curious' | 'interact' | 'catchup' | 'gather';
interface Comp { wasWet?: boolean; idleT?: number; nextIdle?: number; id: CompanionId; actor: Actor; nav: NavGrid; state: CompState; path: V2[]; pathGoal: V2 | null; repath: number; stuck: number; lastPos: V2; slot: { back: number; side: number }; responded: boolean; respondT: number }
interface ActiveAction { kind: 'observe' | 'offer' | 'befriend' | 'flute'; t: number; dur: number; target?: Creature; committed: boolean }

export interface GameEvents {
  message(text: string, tone?: 'info' | 'good' | 'warn'): void;
  rule(ev: RuleEvent): void;
  photo(ok: boolean, info: string, thumb?: string): void;
  changed(): void;
}

// Fixed-azimuth trailing camera (turned slightly NNE so the river, bridge, camp and village compose like the reference).
export const CAM_YAW = -0.4;
const CAM_OFFSET = new THREE.Vector3(1.5, 2.55, 5.9).applyAxisAngle(new THREE.Vector3(0, 1, 0), CAM_YAW);
const CAM_LOOK = new THREE.Vector3(1.5, 0.19, -5.5).applyAxisAngle(new THREE.Vector3(0, 1, 0), CAM_YAW);

export class Game {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(41, 16 / 9, 0.1, 2000);
  worldView!: WorldView;
  explorer!: Actor;
  creatures: Creature[] = [];
  comps: Comp[] = [];
  fruits = new Map<string, THREE.Mesh>();
  navLand!: NavGrid; navBubble!: NavGrid;
  selected: Creature | null = null;
  manualSelect = false;
  action: ActiveAction | null = null;
  mode: 'explore' | 'photo' = 'explore';
  photoYaw = 0; photoPitch = 0; photoFov = 38;
  camYaw = 0;
  time = 0;
  paused = false;
  waypointMesh!: THREE.Group;
  private camPos = new THREE.Vector3(); private camLook = new THREE.Vector3(); private lookAhead = new THREE.Vector3();
  private stepAccum = 0;
  private habitatCheckT = 0;
  private saveT = 0;
  private particles: { m: THREE.Mesh; v: THREE.Vector3; life: number; max: number }[] = [];
  private particleTex: Record<string, THREE.Texture> = {};
  private fadedMats = new Map<THREE.Material, THREE.Material>();
  private fadedNow = new Set<THREE.Mesh>();
  observeProgress = 0;
  renderFrame: (() => void) | null = null;
  ambient!: Ambient;
  private fg: THREE.Mesh[] = [];

  constructor(private tex: Tex, public state: GameState, private input: Input, private audio: Audio, private ev: GameEvents) {}

  build() {
    this.worldView = buildWorld(this.tex, this.scene);
    this.ambient = new Ambient(this.scene);
    // camera-framing foreground foliage (like the painting's big corner plants); purely visual
    this.scene.add(this.camera);
    for (const [k, tint] of [['fg-left', 0.78], ['fg-right', 0.95]] as const) {
      const t = this.tex[k];
      const m = new THREE.Mesh(spriteGeometry(t), new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.08, depthTest: false, depthWrite: false, fog: false, color: new THREE.Color(tint, tint, tint * 0.96) }));
      m.renderOrder = 20; m.frustumCulled = false; m.userData.side = k === 'fg-left' ? -1 : 1;
      this.camera.add(m); this.fg.push(m);
    }
    this.navLand = new NavGrid('land', 0.25);
    this.navBubble = new NavGrid('bubble', 0.2);
    this.explorer = makeExplorer(this.tex);
    this.scene.add(this.explorer.group, this.explorer.shadow);
    // party: exactly three persistent companions
    const slots = { 'leaflet-01': { back: -0.1, side: -1.45 }, 'peach-01': { back: -0.7, side: 1.35 }, 'bubble-01': { back: 0.45, side: 0.95 } } as const;
    for (const c of COMPANIONS) {
      const a = makeCompanion(c.id, c.species, this.tex);
      this.scene.add(a.group, a.shadow);
      const comp: Comp = { id: c.id, actor: a, nav: c.species === 'bubble' ? this.navBubble : this.navLand, state: 'follow', path: [], pathGoal: null, repath: 0, stuck: 0, lastPos: [0, 0], slot: slots[c.id], responded: false, respondT: 0 };
      this.comps.push(comp);
      this.creatures.push({ eid: c.id, species: c.species, name: c.name, actor: a, companion: c.id });
    }
    // wildlife (entity IDs distinct from species IDs)
    const extra = [
      { id: 'finch-03', speciesId: 'meadow-finch', positionXZ: [-27, 6] }, { id: 'finch-04', speciesId: 'meadow-finch', positionXZ: [-24, 8] },
      { id: 'finch-05', speciesId: 'meadow-finch', positionXZ: [-29, 9] }, { id: 'finch-06', speciesId: 'meadow-finch', positionXZ: [-22, 3] },
      { id: 'finch-07', speciesId: 'meadow-finch', positionXZ: [16, 14] }, { id: 'grazer-03', speciesId: 'flower-grazer', positionXZ: [-12, 26] },
    ];
    for (const w of [...world.wildlife, ...extra]) {
      const sp = w.speciesId as SpeciesId;
      const isG = sp === 'flower-grazer';
      const a = new Actor(w.id, sp, isG ? 1.05 : 0.3, isG ? 'grazer' : 'finch', 'quad', this.tex, isG ? { 'grazer-graze': 0.9 } : {}, false, isG ? 0.9 : 0.22);
      a.pose = isG ? 'grazer-34' : 'finch';
      a.facing = Math.random() * 6.28;
      a.place(w.positionXZ[0], w.positionXZ[1]);
      this.scene.add(a.group, a.shadow);
      this.creatures.push({ eid: w.id, species: sp, name: SPECIES[sp].name, actor: a, wild: { home: w.positionXZ as V2, radius: isG ? 5 : 3.5, target: null, wait: Math.random() * 3, speed: isG ? 0.7 : 1.6, kind: isG ? 'grazer' : 'finch' } });
    }
    // fruit pickups
    const ft = this.tex['icon-orange'];
    for (const f of world.fruit) {
      const m = new THREE.Mesh(spriteGeometry(ft), spriteMaterial(ft));
      m.scale.setScalar(0.42); m.position.set(f.positionXZ[0], groundHeight(f.positionXZ[0], f.positionXZ[1]) + 0.05, f.positionXZ[1]);
      m.userData.fruitId = f.id; m.renderOrder = 4;
      const sh = makeBlobShadow(0.5, 0.25); sh.position.set(m.position.x, m.position.y, m.position.z); m.userData.shadow = sh;
      this.scene.add(m, sh); this.fruits.set(f.id, m);
      this.worldView.billboards.push(m);
    }
    // waypoint marker
    this.waypointMesh = new THREE.Group();
    const pt = this.tex['icon-pin'];
    const pin = new THREE.Mesh(spriteGeometry(pt), spriteMaterial(pt)); pin.scale.setScalar(1.3); pin.renderOrder = 6;
    this.waypointMesh.add(pin); this.worldView.billboards.push(pin);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.95, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#5f9ad6', transparent: true, opacity: 0.6, depthWrite: false }));
    ring.position.y = 0.06; this.waypointMesh.add(ring);
    this.scene.add(this.waypointMesh);
    // particle textures
    this.particleTex.heart = canvasTex((g) => { g.fillStyle = '#f0839d'; g.beginPath(); g.moveTo(32, 54); g.bezierCurveTo(4, 34, 8, 8, 32, 20); g.bezierCurveTo(56, 8, 60, 34, 32, 54); g.fill(); });
    this.particleTex.bubble = canvasTex((g) => { const gr = g.createRadialGradient(26, 24, 2, 32, 32, 28); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.5, 'rgba(190,230,250,0.35)'); gr.addColorStop(0.95, 'rgba(120,190,230,0.6)'); gr.addColorStop(1, 'rgba(120,190,230,0)'); g.fillStyle = gr; g.beginPath(); g.arc(32, 32, 30, 0, 7); g.fill(); });
    this.particleTex.note = canvasTex((g) => { g.fillStyle = '#8a5a3a'; g.beginPath(); g.ellipse(24, 46, 10, 8, -0.4, 0, 7); g.fill(); g.fillRect(31, 10, 4, 36); g.fillRect(31, 10, 16, 6); });
    this.particleTex.leaf = canvasTex((g) => { g.fillStyle = '#8fc35a'; g.beginPath(); g.ellipse(32, 32, 10, 22, 0.7, 0, 7); g.fill(); });
    this.resetPositions();
  }

  resetPositions() {
    const [px, pz] = this.state.player;
    const start = walkable(px, pz, 'explorer') ? [px, pz] : START;
    this.explorer.place(start[0], start[1]);
    this.explorer.facing = Math.PI + CAM_YAW - 0.75; // 3/4 back view, like the reference
    for (const c of this.comps) {
      const s = this.slotFor(c);
      const p = c.nav.nearestOpen(s[0], s[1]) ?? [start[0], start[1] + 1];
      c.actor.place(p[0], p[1]); c.actor.facing = Math.PI + CAM_YAW; c.state = 'follow'; c.path = []; c.stuck = 0;
    }
    for (const [id, m] of this.fruits) { const got = this.state.collectedFruit.includes(id); m.visible = !got; (m.userData.shadow as THREE.Mesh).visible = !got; }
    this.action = null; this.selected = null; this.mode = 'explore';
    this.snapCamera();
  }

  slotFor(c: Comp): V2 {
    const e = this.explorer, f = e.facing;
    const fx = Math.sin(f), fz = Math.cos(f), rx = -Math.cos(f), rz = Math.sin(f); // actor's right-hand side
    return [e.pos.x - fx * c.slot.back + rx * c.slot.side, e.pos.z - fz * c.slot.back + rz * c.slot.side];
  }

  // ---------------------------------------------------------------- simulation
  step(dt: number) {
    if (this.paused) return;
    this.time += dt;
    for (const a of [this.explorer, ...this.creatures.map(c => c.actor)]) a.prev.copy(a.pos);
    if (this.mode === 'photo') this.stepPhoto(dt); else this.stepExplorer(dt);
    this.stepCompanions(dt);
    this.stepWildlife(dt);
    this.stepAction(dt);
    this.stepParticles(dt);
    this.autoSelect();
    this.habitatCheckT -= dt;
    if (this.habitatCheckT <= 0) {
      this.habitatCheckT = 0.25;
      for (const h of HABITAT_ZONES) if (Math.hypot(this.explorer.pos.x - h.c[0], this.explorer.pos.z - h.c[1]) < h.r) this.emit(enterHabitat(this.state, h.id));
    }
    this.saveT += dt;
    if (this.saveT > 8) { this.saveT = 0; this.state.player = [this.explorer.pos.x, this.explorer.pos.z]; this.ev.changed(); }
  }

  private stepExplorer(dt: number) {
    const e = this.explorer;
    const [ax, az] = this.input.axis();
    const busy = !!this.action && this.action.kind !== 'flute';
    let mx = ax, mz = az;
    if (busy && (mx || mz)) { if (this.action!.kind === 'observe') { this.ev.message('Observation interrupted.', 'warn'); this.cancelAction(); } else { mx = 0; mz = 0; } }
    if (this.action?.kind === 'flute') { mx = 0; mz = 0; }
    const len = Math.hypot(mx, mz);
    const run = this.input.down('ShiftLeft') || this.input.down('ShiftRight');
    const maxSpeed = run ? 4.6 : 3.1;
    // camera-relative: camera yaw rotates the input
    const cy = Math.cos(this.camYaw), sy = Math.sin(this.camYaw);
    let dx = 0, dz = 0;
    if (len > 0) { const nx = mx / len, nz = mz / len; dx = nx * cy + nz * sy; dz = -nx * sy + nz * cy; }
    const targetV = new THREE.Vector3(dx * maxSpeed, 0, dz * maxSpeed);
    e.vel.lerp(targetV, Math.min(1, dt * (len > 0 ? 9 : 12)));
    e.speed = Math.hypot(e.vel.x, e.vel.z);
    if (e.speed > 0.05) {
      const nx = e.pos.x + e.vel.x * dt, nz = e.pos.z + e.vel.z * dt;
      if (walkable(nx, nz, 'explorer')) { e.pos.x = nx; e.pos.z = nz; }
      else {
        // slide around round obstacles: try progressively rotated directions, then the axes
        let moved = false;
        for (const ang of [0.5, -0.5, 1.0, -1.0, 1.4, -1.4]) {
          const c = Math.cos(ang), sn = Math.sin(ang);
          const rx = (e.vel.x * c - e.vel.z * sn) * dt * 0.85, rz = (e.vel.x * sn + e.vel.z * c) * dt * 0.85;
          if (walkable(e.pos.x + rx, e.pos.z + rz, 'explorer')) { e.pos.x += rx; e.pos.z += rz; moved = true; break; }
        }
        if (!moved) {
          if (walkable(nx, e.pos.z, 'explorer')) { e.pos.x = nx; e.vel.z *= 0.5; }
          else if (walkable(e.pos.x, nz, 'explorer')) { e.pos.z = nz; e.vel.x *= 0.5; }
          else e.vel.multiplyScalar(0.2);
        }
      }
      if (len > 0) e.facing = lerpAngle(e.facing, Math.atan2(dx, dz), Math.min(1, dt * 12));
      e.walkPhase += dt * e.speed * 3.1;
      if (Math.floor(e.walkPhase / Math.PI) !== Math.floor((e.walkPhase - dt * e.speed * 3.1) / Math.PI) && e.speed > 0.8) this.sfx(bridgeAt(e.pos.x, e.pos.z) ? 'step-wood' : 'footstep', 0.2 + Math.random() * 0.06, 0.9 + Math.random() * 0.2);
    }
    e.pos.y = surfaceHeight(e.pos.x, e.pos.z);
    if (!this.action) e.pose = null;
    // fruit pickup proximity is via E (interact) – see interact()
  }

  private stepPhoto(dt: number) {
    const e = this.explorer; e.speed = 0; e.vel.set(0, 0, 0);
    if (!this.input.uiBlocking) {
      const turn = (this.input.down('KeyA') || this.input.down('ArrowLeft') ? 1 : 0) - (this.input.down('KeyD') || this.input.down('ArrowRight') ? 1 : 0);
      const tilt = (this.input.down('KeyW') || this.input.down('ArrowUp') ? 1 : 0) - (this.input.down('KeyS') || this.input.down('ArrowDown') ? 1 : 0);
      this.photoYaw += turn * dt * 1.4; this.photoPitch = clamp(this.photoPitch + tilt * dt * 0.8, -0.6, 0.5);
      if (this.input.down('KeyQ')) this.photoFov = clamp(this.photoFov + dt * 25, 16, 55);
      if (this.input.down('KeyE')) this.photoFov = clamp(this.photoFov - dt * 25, 16, 55);
    }
    e.facing = this.photoYaw + Math.PI;
  }

  private stepCompanions(dt: number) {
    const e = this.explorer;
    const onScreen = (x: number, z: number) => { const v = new THREE.Vector3(x, surfaceHeight(x, z) + 0.3, z).project(this.camera); return v.z < 1 && Math.abs(v.x) < 1.15 && Math.abs(v.y) < 1.15; };
    this.comps.forEach((c, idx) => {
      const a = c.actor;
      let goal: V2 = this.slotFor(c);
      if (this.action?.kind === 'flute' || c.state === 'gather') {
        const ang = e.facing + Math.PI + (idx - 1) * 0.9;
        goal = [e.pos.x + Math.sin(ang) * 1.5, e.pos.z + Math.cos(ang) * 1.5];
      }
      const inter = this.action && (this.action.kind === 'offer' || this.action.kind === 'befriend') && this.action.target?.companion === c.id;
      if (inter) {
        c.state = 'interact'; a.speed = 0; a.vel.set(0, 0, 0);
        a.facing = Math.atan2(e.pos.x - a.pos.x, e.pos.z - a.pos.z);
        return;
      }
      if (this.mode === 'photo' && c.state !== 'gather') { a.speed = 0; a.walkPhase = 0; this.idleBehaviour(c, dt); return; }
      // goal must be valid for this companion's terrain
      if (!c.nav.okWorld(goal[0], goal[1])) goal = c.nav.nearestOpen(goal[0], goal[1], 8) ?? goal;
      const d = Math.hypot(goal[0] - a.pos.x, goal[1] - a.pos.z);
      const distToPlayer = Math.hypot(e.pos.x - a.pos.x, e.pos.z - a.pos.z);
      // catch-up: only reposition when both the companion and its destination are off camera
      if ((distToPlayer > 24 || c.stuck > 4) && !onScreen(a.pos.x, a.pos.z)) {
        const behind: V2 = [e.pos.x - Math.sin(e.facing) * 5 + (idx - 1) * 1.2, e.pos.z - Math.cos(e.facing) * 5];
        const spot = c.nav.nearestOpen(behind[0], behind[1], 10);
        if (spot && !onScreen(spot[0], spot[1])) { a.place(spot[0], spot[1]); c.path = []; c.stuck = 0; c.state = 'catchup'; return; }
      }
      if (d < 0.35 && c.state !== 'gather') { a.speed = Math.max(0, a.speed - dt * 8); this.idleBehaviour(c, dt); c.stuck = 0; return; }
      // path planning
      c.repath -= dt;
      let target: V2 = goal;
      if (!c.nav.lineClear(a.pos.x, a.pos.z, goal[0], goal[1])) {
        const goalMoved = !c.pathGoal || Math.hypot(c.pathGoal[0] - goal[0], c.pathGoal[1] - goal[1]) > 2;
        if ((c.path.length === 0 || goalMoved) && c.repath <= 0) {
          c.path = c.nav.findPath(a.pos.x, a.pos.z, goal[0], goal[1]) ?? []; c.pathGoal = goal; c.repath = 0.5;
        }
        while (c.path.length && Math.hypot(c.path[0][0] - a.pos.x, c.path[0][1] - a.pos.z) < 0.45) c.path.shift();
        if (c.path.length) target = c.path[0];
      } else { c.path = []; }
      const tx = target[0] - a.pos.x, tz = target[1] - a.pos.z, tl = Math.hypot(tx, tz) || 1;
      const want = clamp(1.8 + d * 0.55, 1.8, distToPlayer > 10 ? 6.5 : 5.0);
      let vx = tx / tl * want, vz = tz / tl * want;
      // separation from party members and the explorer
      for (const o of [e, ...this.comps.map(k => k.actor)]) {
        if (o === a) continue; const sx = a.pos.x - o.pos.x, sz = a.pos.z - o.pos.z, sd = Math.hypot(sx, sz);
        if (sd < 0.8 && sd > 0.001) { vx += sx / sd * (0.8 - sd) * 4; vz += sz / sd * (0.8 - sd) * 4; }
      }
      a.vel.lerp(new THREE.Vector3(vx, 0, vz), Math.min(1, dt * 6));
      const nx = a.pos.x + a.vel.x * dt, nz = a.pos.z + a.vel.z * dt;
      if (c.nav.okWorld(nx, nz)) { a.pos.x = nx; a.pos.z = nz; }
      else if (c.nav.okWorld(nx, a.pos.z)) a.pos.x = nx;
      else if (c.nav.okWorld(a.pos.x, nz)) a.pos.z = nz;
      else { c.path = []; c.repath = 0; }
      a.speed = Math.hypot(a.vel.x, a.vel.z);
      if (a.speed > 0.2) a.facing = lerpAngle(a.facing, Math.atan2(a.vel.x, a.vel.z), Math.min(1, dt * 10));
      a.walkPhase += dt * a.speed * (c.id === 'bubble-01' ? 4.5 : 5.2);
      a.pos.y = surfaceHeight(a.pos.x, a.pos.z);
      if (a.swims) { const wet = inWater(a.pos.x, a.pos.z); if (wet && !c.wasWet) { this.sfx('splash', 0.5); this.burst(a, 'bubble', 3); } c.wasWet = wet; }
      // stuck detection
      const moved = Math.hypot(a.pos.x - c.lastPos[0], a.pos.z - c.lastPos[1]);
      if (d > 1.5 && moved < dt * 0.3) c.stuck += dt; else c.stuck = Math.max(0, c.stuck - dt * 2);
      c.lastPos = [a.pos.x, a.pos.z];
      if (c.state !== 'gather') c.state = 'follow';
      c.idleT = 0;
    });
  }

  private idleBehaviour(c: Comp, dt: number) {
    const a = c.actor;
    if (c.state === 'gather') {
      c.respondT += dt;
      if (!c.responded) {
        c.responded = true;
        if (c.id === 'leaflet-01') { a.spin = 0.001; this.burst(a, 'leaf', 6); this.sfx('leaflet-chirp'); }
        if (c.id === 'peach-01') { a.hop = 0.001; this.burst(a, 'heart', 3); this.sfx('peach-chirp'); }
        if (c.id === 'bubble-01') { a.hop = 0.001; this.burst(a, 'bubble', 8); this.sfx('bubble-chirp'); }
      }
      a.facing = Math.atan2(this.explorer.pos.x - a.pos.x, this.explorer.pos.z - a.pos.z);
      return;
    }
    // curious about nearby wildlife
    const wild = this.creatures.find(k => k.wild && k.actor.pos.distanceTo(a.pos) < 5);
    if (wild) { c.state = 'curious'; a.facing = lerpAngle(a.facing, Math.atan2(wild.actor.pos.x - a.pos.x, wild.actor.pos.z - a.pos.z), dt * 3); }
    else {
      // idle: turn three-quarters toward the camera, looking toward the explorer (reads like the reference)
      c.state = 'idle';
      c.idleT = (c.idleT ?? 0) + dt; c.nextIdle ??= 5 + Math.random() * 6;
      const toP = new THREE.Vector3(this.explorer.pos.x - a.pos.x, 0, this.explorer.pos.z - a.pos.z);
      const camRight = new THREE.Vector3(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw));
      const side = Math.sign(toP.dot(camRight)) || 1;
      // Peach settles down and sits facing you after a while (her painted front view is a sitting pose)
      const settle = c.id === 'peach-01' && c.idleT > 4;
      a.facing = lerpAngle(a.facing, this.camYaw + Math.PI - side * (settle ? 3.1 : 2.35), dt * 2.5);
      if (c.idleT > c.nextIdle && this.mode === 'explore') {
        c.nextIdle = c.idleT + 7 + Math.random() * 8;
        if (c.id === 'leaflet-01') { a.spin = 0.001; this.burst(a, 'leaf', 2); }
        if (c.id === 'peach-01') { a.hop = 0.001; }
        if (c.id === 'bubble-01') { this.burst(a, 'bubble', 4); a.hop = 0.001; }
      }
    }
  }

  private stepWildlife(dt: number) {
    const r = Math.random;
    for (const c of this.creatures) {
      const w = c.wild; if (!w) continue;
      const a = c.actor;
      const near = Math.hypot(this.explorer.pos.x - a.pos.x, this.explorer.pos.z - a.pos.z);
      // finches take flight when the explorer hurries past, then land a little way off
      if (w.fly) {
        w.fly.t += dt; const k = Math.min(1, w.fly.t / w.fly.dur);
        a.pos.x = w.fly.from[0] + (w.fly.to[0] - w.fly.from[0]) * k; a.pos.z = w.fly.from[1] + (w.fly.to[1] - w.fly.from[1]) * k;
        a.pos.y = surfaceHeight(a.pos.x, a.pos.z); a.air = Math.sin(k * Math.PI) * 2.6;
        a.facing = Math.atan2(w.fly.to[0] - w.fly.from[0], w.fly.to[1] - w.fly.from[1]); a.speed = 2; a.walkPhase += dt * 30; a.pose = 'finch';
        if (k >= 1) { w.fly = undefined; a.air = 0; w.wait = 1 + r() * 2; }
        continue;
      }
      if (w.kind === 'finch' && near < 2.4 && this.explorer.speed > 3.6) {
        const ang = Math.atan2(a.pos.x - this.explorer.pos.x, a.pos.z - this.explorer.pos.z) + (r() - 0.5) * 0.8;
        for (let k = 0; k < 5; k++) {
          const d = 6 + r() * 5, to: V2 = [a.pos.x + Math.sin(ang) * d, a.pos.z + Math.cos(ang) * d];
          if (this.navLand.okWorld(to[0], to[1]) && Math.hypot(to[0] - w.home[0], to[1] - w.home[1]) < 14) { w.fly = { from: [a.pos.x, a.pos.z], to, t: 0, dur: 1.1 + r() * 0.5 }; this.sfx('finch-chirp', 0.5, 0.9 + r() * 0.3); break; }
        }
        if (w.fly) continue;
      }
      if (w.kind === 'finch' && near < 1.6 && !w.target) { // hop away a little
        const ang = Math.atan2(a.pos.x - this.explorer.pos.x, a.pos.z - this.explorer.pos.z) + (r() - 0.5);
        w.target = [a.pos.x + Math.sin(ang) * 2.5, a.pos.z + Math.cos(ang) * 2.5];
      }
      if (w.kind === 'grazer' && near < 4.5 && !w.target) { // looks up at the explorer
        a.speed = 0; a.pose = 'grazer-34'; a.facing = lerpAngle(a.facing, Math.atan2(this.explorer.pos.x - a.pos.x, this.explorer.pos.z - a.pos.z), dt * 2); continue;
      }
      if (!w.target) {
        w.wait -= dt;
        a.speed = 0;
        a.pose = w.kind === 'grazer' ? (Math.sin(this.time * 0.4 + a.bobOffset) > -0.2 ? 'grazer-graze' : 'grazer-34') : (Math.sin(this.time * 1.3 + a.bobOffset) > 0.3 ? 'finch-peck' : 'finch');
        if (w.wait <= 0) {
          const ang = r() * 6.28, rad = r() * w.radius;
          const t: V2 = [w.home[0] + Math.sin(ang) * rad, w.home[1] + Math.cos(ang) * rad];
          if (this.navLand.okWorld(t[0], t[1])) w.target = t;
          w.wait = w.kind === 'grazer' ? 3 + r() * 5 : 0.8 + r() * 2.5;
        }
        continue;
      }
      const tx = w.target[0] - a.pos.x, tz = w.target[1] - a.pos.z, tl = Math.hypot(tx, tz);
      if (tl < 0.2) { w.target = null; continue; }
      const sp = w.speed * (w.kind === 'finch' && near < 2 ? 2.2 : 1);
      const nx = a.pos.x + tx / tl * sp * dt, nz = a.pos.z + tz / tl * sp * dt;
      if (this.navLand.okWorld(nx, nz)) { a.pos.x = nx; a.pos.z = nz; } else w.target = null;
      a.facing = Math.atan2(tx, tz); a.speed = sp; a.walkPhase += dt * sp * (w.kind === 'finch' ? 14 : 4);
      a.pose = w.kind === 'grazer' ? 'grazer-34' : 'finch';
      a.pos.y = surfaceHeight(a.pos.x, a.pos.z);
    }
  }

  // ---------------------------------------------------------------- interaction
  /** Creatures within range sorted by distance. */
  nearbyCreatures(range = 10) {
    return this.creatures.map(c => ({ c, d: Math.hypot(c.actor.pos.x - this.explorer.pos.x, c.actor.pos.z - this.explorer.pos.z) }))
      .filter(x => x.d <= range).sort((a, b) => a.d - b.d);
  }
  nearestFruit(range = 1.9): string | null {
    let best: string | null = null, bd = range;
    for (const [id, m] of this.fruits) {
      if (!m.visible) continue;
      const d = Math.hypot(m.position.x - this.explorer.pos.x, m.position.z - this.explorer.pos.z);
      if (d < bd) { bd = d; best = id; }
    }
    return best;
  }
  distTo(c: Creature) { return Math.hypot(c.actor.pos.x - this.explorer.pos.x, c.actor.pos.z - this.explorer.pos.z); }

  private autoSelect() {
    if (this.mode === 'photo') return;
    if (this.selected && (this.distTo(this.selected) > 12)) { this.selected = null; this.manualSelect = false; }
    if (this.manualSelect && this.selected) return;
    const n = this.nearbyCreatures(6.5);
    // prefer wildlife / unfinished companions in front of the explorer
    const pick = n.find(x => x.c.wild) ?? n.find(x => x.c.companion && !this.state.companions[x.c.companion].befriended) ?? n[0];
    const next = pick?.c ?? null;
    if (next !== this.selected && !this.action) { this.selected = next; this.ev.changed(); }
  }
  cycleTarget() {
    const n = this.nearbyCreatures(10);
    if (!n.length) { this.ev.message('No creatures nearby — try the sunflowers or the river.', 'info'); return; }
    const i = n.findIndex(x => x.c === this.selected);
    this.selected = n[(i + 1) % n.length].c; this.manualSelect = true; this.sfx('ui-click', 0.6); this.ev.changed();
  }

  /** E: interact with nearest valid target (fruit first, then default action for selected creature). */
  interact() {
    if (this.mode === 'photo') { this.shutter(); return; }
    const f = this.nearestFruit();
    if (f) { this.pickFruit(f); return; }
    const s = this.selected;
    if (!s) { this.ev.message('Nothing to interact with here.', 'info'); return; }
    const d = this.distTo(s);
    if (s.companion) {
      const cs = this.state.companions[s.companion];
      if (!cs.observed) return this.doAction('observe');
      if (!cs.fed) return this.doAction('offer');
      if (!cs.befriended && canBefriend(this.state, s.companion) === null) return this.doAction('befriend');
      if (!cs.befriended) return this.doAction('offer');
      if (!this.state.photographedSpecies.includes(s.species)) return this.doAction('photo');
      // a friendly pat: harmless response, no rewards
      if (d < 3) { s.actor.hop = 0.001; this.burst(s.actor, 'heart', 2); this.sfx(chirpFor(s.species)); this.ev.message(`${s.name} is happy to see you!`, 'good'); }
      return;
    }
    if (!this.state.observedSpecies.includes(s.species) && d <= T.observeRange + 2) return this.doAction('observe');
    return this.doAction('photo');
  }

  pickFruit(id: string) {
    const evs = collectFruit(this.state, id);
    if (evs[0]?.kind === 'fruitCollected') {
      const m = this.fruits.get(id)!; m.visible = false; (m.userData.shadow as THREE.Mesh).visible = false;
      this.sfx('pickup', 2.2); this.burstAt(m.position.clone().add(new THREE.Vector3(0, 0.3, 0)), 'leaf', 4);
    }
    this.emit(evs);
  }

  actionAvailability(kind: ActionKind): string | null {
    const s = this.selected;
    if (!s) return 'Select a creature first.';
    const d = this.distTo(s);
    if (kind === 'observe') return d <= T.observeRange ? null : `Get within ${T.observeRange} m to observe.`;
    if (kind === 'photo') return null;
    if (!s.companion) return kind === 'offer' ? 'Wild creatures prefer to be watched.' : 'Wild creatures stay wild — photograph them instead!';
    if (kind === 'offer') return canOffer(this.state, s.companion, d);
    return canBefriend(this.state, s.companion);
  }

  doAction(kind: ActionKind) {
    if (this.action) { this.ev.message('One thing at a time…', 'info'); return; }
    const s = this.selected;
    if (kind === 'photo') { this.enterPhoto(); return; }
    if (!s) { this.ev.message('Select a creature first (Tab).', 'info'); return; }
    const why = this.actionAvailability(kind);
    if (why) { this.ev.message(why, 'warn'); this.sfx('ui-click', 0.5, 0.7); return; }
    this.faceTarget(s);
    if (kind === 'observe') { this.action = { kind, t: 0, dur: 1.6, target: s, committed: false }; this.explorer.pose = 'explorer-point'; this.ev.message(`Observing ${s.name}… stay close.`, 'info'); }
    if (kind === 'offer') { this.action = { kind, t: 0, dur: 1.5, target: s, committed: false }; this.explorer.pose = 'explorer-offer'; }
    if (kind === 'befriend') { this.action = { kind, t: 0, dur: 1.8, target: s, committed: false }; this.explorer.pose = 'explorer-offer'; }
    this.ev.changed();
  }
  private faceTarget(s: Creature) { this.explorer.facing = Math.atan2(s.actor.pos.x - this.explorer.pos.x, s.actor.pos.z - this.explorer.pos.z); }

  cancelAction() { this.action = null; this.explorer.pose = null; this.observeProgress = 0; this.ev.changed(); }

  playFlute() {
    if (this.mode === 'photo') return;
    if (this.action) { this.ev.message('One thing at a time…', 'info'); return; }
    this.action = { kind: 'flute', t: 0, dur: 6, committed: false };
    this.explorer.pose = 'explorer-flute'; this.explorer.vel.set(0, 0, 0);
    for (const c of this.comps) { c.state = 'gather'; c.responded = false; c.respondT = 0; c.path = []; }
    this.sfx('flute', 0.9); this.audio.duck(3);
    this.ev.message('♪ You play a gentle tune on the flute…', 'info');
    this.ev.changed();
  }

  private stepAction(dt: number) {
    const a = this.action; if (!a) { this.observeProgress = 0; return; }
    a.t += dt;
    const tgt = a.target;
    if (a.kind === 'observe' && tgt) {
      this.faceTarget(tgt);
      if (this.distTo(tgt) > T.observeRange + 0.25) { this.ev.message(`${tgt.name} wandered off — observation interrupted.`, 'warn'); this.cancelAction(); return; }
      this.observeProgress = a.t / a.dur;
      if (a.t >= a.dur) {
        const evs = completeObserve(this.state, tgt.species, tgt.companion ?? null);
        this.sfx(chirpFor(tgt.species)); this.burst(tgt.actor, 'note', 2);
        this.ev.message(`You observed ${tgt.name}. ${SPECIES[tgt.species].note}`, 'good');
        this.emit(evs); this.cancelAction();
      }
      return;
    }
    if (a.kind === 'offer' && tgt?.companion) {
      this.faceTarget(tgt);
      if (!a.committed && a.t >= 1.0) {
        a.committed = true; // commits exactly once
        const evs = commitOffer(this.state, tgt.companion, this.distTo(tgt));
        if (evs[0].kind === 'fruitOffered') { this.sfx('munch'); this.burst(tgt.actor, 'heart', 3); tgt.actor.hop = 0.001; this.ev.message(`${tgt.name} munches the fruit happily!`, 'good'); }
        this.emit(evs);
      }
      if (a.t >= a.dur) this.cancelAction();
      return;
    }
    if (a.kind === 'befriend' && tgt?.companion) {
      this.faceTarget(tgt);
      if (!a.committed && a.t >= 1.2) {
        a.committed = true;
        const evs = commitBefriend(this.state, tgt.companion);
        if (evs[0].kind === 'befriended') { this.sfx('befriend'); this.audio.duck(2); this.burst(tgt.actor, 'heart', 10); tgt.actor.hop = 0.001; this.sfx(chirpFor(tgt.species)); }
        this.emit(evs);
      }
      if (a.t >= a.dur) this.cancelAction();
      return;
    }
    if (a.kind === 'flute') {
      const arrived = this.comps.filter(c => Math.hypot(c.actor.pos.x - this.explorer.pos.x, c.actor.pos.z - this.explorer.pos.z) < 2.4);
      if (Math.floor(a.t * 3) !== Math.floor((a.t - dt) * 3)) this.burstAt(this.explorer.center().add(new THREE.Vector3(0.3, 0.5, 0)), 'note', 1);
      if (a.t > 3.2 && (arrived.length === this.comps.length || a.t >= a.dur)) {
        if (!a.committed) {
          a.committed = true;
          const evs = fluteComplete(this.state, arrived.map(c => c.id));
          this.ev.message(arrived.length === 3 ? 'All three pals gathered around you!' : `${arrived.length} pals gathered around you.`, 'good');
          this.emit(evs);
        }
        if (a.t >= 4.2 || a.t >= a.dur) { for (const c of this.comps) c.state = 'follow'; this.cancelAction(); }
      }
    }
  }

  private emit(evs: RuleEvent[]) {
    for (const e of evs) {
      if (e.kind === 'rejected') { this.ev.message(e.reason, 'warn'); continue; }
      if (e.kind === 'habitat' || e.kind === 'speciesObserved' || (e.kind === 'photo' && e.firstTime)) this.sfx('discover');
      if (e.kind === 'complete') { this.sfx('befriend'); this.audio.duck(3); }
      this.ev.rule(e);
    }
    if (evs.length) this.ev.changed();
  }

  // ---------------------------------------------------------------- photo mode
  enterPhoto() {
    if (this.action) { this.ev.message('One thing at a time…', 'info'); return; }
    this.mode = 'photo';
    const s = this.selected;
    this.photoYaw = s ? Math.atan2(-(s.actor.pos.x - this.explorer.pos.x), -(s.actor.pos.z - this.explorer.pos.z)) : this.explorer.facing + Math.PI;
    this.photoPitch = s ? -Math.atan2(1.2 - s.actor.height * 0.5, Math.max(1, this.distTo(s))) : -0.08;
    this.photoFov = 38;
    this.explorer.hidden = true;
    this.ev.changed();
  }
  exitPhoto() { this.mode = 'explore'; this.explorer.hidden = false; this.explorer.pose = null; this.ev.changed(); }

  /** Evaluate every creature against the current photo camera. */
  photoCandidates(): (PhotoCandidate & { c: Creature })[] {
    const cam = this.camera; cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    const out: (PhotoCandidate & { c: Creature })[] = [];
    const v = new THREE.Vector3();
    for (const c of this.creatures) {
      const a = c.actor;
      const ctr = a.center(new THREE.Vector3());
      const top = new THREE.Vector3(a.pos.x, a.pos.y + a.height, a.pos.z).project(cam);
      const bot = new THREE.Vector3(a.pos.x, a.pos.y, a.pos.z).project(cam);
      v.copy(ctr).project(cam);
      const inFrustum = v.z < 1 && v.z > -1 && Math.abs(v.x) <= 0.92 && Math.abs(v.y) <= 0.92;
      const distance = cam.position.distanceTo(ctr);
      const screenFraction = Math.abs(top.y - bot.y) / 2;
      const occluded = this.occluded(cam.position, ctr);
      out.push({ c, species: c.species, inFrustum, distance, screenFraction, occluded, centerOffset: Math.hypot(v.x, v.y) });
    }
    return out;
  }
  private occluded(from: THREE.Vector3, to: THREE.Vector3) {
    const L = from.distanceTo(to);
    // terrain sampling
    for (let k = 1; k < 24; k++) {
      const t = k / 24, x = from.x + (to.x - from.x) * t, y = from.y + (to.y - from.y) * t, z = from.z + (to.z - from.z) * t;
      if (y < groundHeight(x, z) - 0.05) return true;
    }
    // tree canopies / rocks / buildings as vertical cylinders
    for (const o of this.worldView.occluders) {
      const dx = to.x - from.x, dz = to.z - from.z, len2 = dx * dx + dz * dz;
      let t = ((o.x - from.x) * dx + (o.z - from.z) * dz) / len2; if (t <= 0.02 || t >= 0.98) continue;
      const px = from.x + dx * t - o.x, pz = from.z + dz * t - o.z;
      if (px * px + pz * pz < o.r * o.r) {
        const y = from.y + (to.y - from.y) * t;
        if (y < surfaceHeight(o.x, o.z) + o.h * 0.95) return true;
      }
    }
    void L; return false;
  }

  /** Shutter: validate subject, capture a thumbnail of the actual rendered frame. */
  shutter(renderer?: THREE.WebGLRenderer) {
    if (this.mode !== 'photo') return;
    this.sfx('shutter');
    const cands = this.photoCandidates();
    const best = choosePhotoSubject(cands);
    let thumb: string | undefined;
    if (renderer) {
      if (this.renderFrame) this.renderFrame(); else renderer.render(this.scene, this.camera); // capture on the render frame
      const src = renderer.domElement;
      const c = document.createElement('canvas'); c.width = 240; c.height = 135;
      const g = c.getContext('2d')!;
      const sw = src.width, sh = src.height, ar = 16 / 9;
      const cw = Math.min(sw, sh * ar), ch = cw / ar;
      g.drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, 240, 135);
      thumb = c.toDataURL('image/jpeg', 0.72);
    }
    if (!best) {
      const near = cands.filter(x => x.inFrustum).sort((a, b) => a.centerOffset - b.centerOffset)[0];
      const why = near ? photoValid(near) : 'not in view';
      const msg = why === 'too far' ? 'Too far away — get within 12 m.' : why === 'blocked' ? 'Something is blocking the shot.' : why === 'too small' ? 'Subject is too small — move closer or zoom (E).' : 'No creature in frame.';
      this.ev.photo(false, msg, thumb);
      return;
    }
    const score = best.screenFraction * (1 - best.centerOffset * 0.5);
    const evs = recordPhoto(this.state, best.species, thumb ?? '', score);
    this.ev.photo(true, `${SPECIES[best.species].name} photographed!`, thumb);
    this.emit(evs);
  }

  /** Suggested next goal derived purely from game state (drives the HUD tracker; never changes rules). */
  nextObjective(): { text: string; target: V2 | null } {
    const st = this.state, p = this.explorer.pos;
    const nearest = (sp: SpeciesId) => this.creatures.filter(c => c.species === sp).sort((a, b) => a.actor.pos.distanceToSquared(p) - b.actor.pos.distanceToSquared(p))[0];
    if (st.waypoint) return { text: 'Waypoint', target: st.waypoint };
    for (const c of COMPANIONS) {
      const cs = st.companions[c.id], a = this.creatures.find(k => k.eid === c.id)!.actor;
      if (cs.befriended) continue;
      if (!cs.observed) return { text: `Observe ${c.name}`, target: [a.pos.x, a.pos.z] };
      if (!cs.fed && st.fruit === 0) { const f = [...this.fruits.values()].find(m => m.visible); return { text: 'Pick fruit in the orchard', target: f ? [f.position.x, f.position.z] : [-28, -30] }; }
      if (!cs.fed) return { text: `Offer ${c.name} fruit`, target: [a.pos.x, a.pos.z] };
      if (cs.trust < T.befriendThreshold) return { text: `Bond with ${c.name} (flute or fruit)`, target: [a.pos.x, a.pos.z] };
      return { text: `Befriend ${c.name}`, target: [a.pos.x, a.pos.z] };
    }
    for (const sp of ['flower-grazer', 'meadow-finch', 'leaflet', 'bloomble', 'bubble'] as SpeciesId[]) {
      if (!st.photographedSpecies.includes(sp)) { const c = nearest(sp); return { text: `Photograph a ${SPECIES[sp].name}`, target: c ? [c.actor.pos.x, c.actor.pos.z] : null }; }
    }
    const left = HABITAT_ZONES.filter(h => !st.habitats.includes(h.id)).sort((a, b) => Math.hypot(a.c[0] - p.x, a.c[1] - p.z) - Math.hypot(b.c[0] - p.x, b.c[1] - p.z));
    if (left.length) return { text: `Visit ${({ sunflowers: 'the Sunflower Meadow', riverbank: 'the Riverbank', orchard: 'the Orchard', lookout: 'Lookout Hill' } as const)[left[0].id]}`, target: left[0].c };
    return { text: 'Explore the meadow freely', target: null };
  }

  setWaypoint(x: number, z: number) {
    if (x < BOUNDS.minX - 2 || x > BOUNDS.maxX + 2 || z < BOUNDS.minZ - 2 || z > BOUNDS.maxZ + 2) return;
    this.state.waypoint = [x, z]; this.ev.changed();
  }
  clearWaypoint() { this.state.waypoint = null; this.ev.changed(); }

  // ---------------------------------------------------------------- particles
  private burst(a: Actor, kind: string, n: number) { this.burstAt(a.center().add(new THREE.Vector3(0, a.height * 0.5, 0)), kind, n); }
  private burstAt(p: THREE.Vector3, kind: string, n: number) {
    const t = this.particleTex[kind];
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
      m.position.copy(p).add(new THREE.Vector3((Math.random() - 0.5) * 0.4, Math.random() * 0.2, (Math.random() - 0.5) * 0.4));
      m.scale.setScalar(kind === 'bubble' ? 0.15 + Math.random() * 0.15 : 0.22); m.renderOrder = 8;
      this.scene.add(m);
      this.particles.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.8 + Math.random() * 0.7, (Math.random() - 0.5) * 0.5), life: 0, max: 1.2 + Math.random() * 0.6 });
    }
  }
  private stepParticles(dt: number) {
    for (const a of [this.explorer, ...this.creatures.map(c => c.actor)]) {
      if (a.hop > 0) { a.hop += dt * 2.2; if (a.hop >= 1) a.hop = 0; }
      if (a.spin > 0) { a.spin += dt * 1.6; if (a.spin >= 1) a.spin = 0; }
    }
    this.particles = this.particles.filter(p => {
      p.life += dt; p.m.position.addScaledVector(p.v, dt); p.v.y -= dt * 0.3;
      const mat = p.m.material as THREE.MeshBasicMaterial; mat.opacity = 1 - p.life / p.max;
      if (p.life >= p.max) { this.scene.remove(p.m); mat.dispose(); return false; }
      return true;
    });
  }
  clearParticles() { for (const p of this.particles) { this.scene.remove(p.m); (p.m.material as THREE.Material).dispose(); } this.particles = []; }

  // ---------------------------------------------------------------- camera + render
  snapCamera() { this.updateCamera(1, true); }
  updateCamera(alpha: number, snap = false) {
    const e = this.explorer;
    const ex = e.prev.x + (e.pos.x - e.prev.x) * alpha, ez = e.prev.z + (e.pos.z - e.prev.z) * alpha;
    const ey = surfaceHeight(ex, ez);
    if (this.mode === 'photo') {
      this.camYaw = this.photoYaw;
      this.camera.fov = this.photoFov;
      this.camera.position.set(ex, ey + 1.25, ez);
      const dir = new THREE.Vector3(-Math.sin(this.photoYaw) * Math.cos(this.photoPitch), Math.sin(this.photoPitch), -Math.cos(this.photoYaw) * Math.cos(this.photoPitch));
      this.camera.lookAt(this.camera.position.clone().add(dir));
      this.camera.updateProjectionMatrix();
      return;
    }
    this.camYaw = CAM_YAW;
    this.camera.fov = 38;
    // gentle look-ahead in the direction of travel keeps the explorer framed (esp. walking toward the camera)
    this.lookAhead.lerp(new THREE.Vector3(e.vel.x, 0, e.vel.z).multiplyScalar(0.45), 0.04);
    const tp = new THREE.Vector3(ex, ey, ez).add(CAM_OFFSET).add(this.lookAhead);
    const tl = new THREE.Vector3(ex, ey, ez).add(CAM_LOOK).add(this.lookAhead);
    // keep the camera above terrain
    tp.y = Math.max(tp.y, groundHeight(tp.x, tp.z) + 1.6);
    if (snap) { this.camPos.copy(tp); this.camLook.copy(tl); }
    else { this.camPos.lerp(tp, 0.12); this.camLook.lerp(tl, 0.12); }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.camera.updateProjectionMatrix();
  }

  private lastRenderT = performance.now();
  render(alpha: number) {
    const nowT = performance.now(); const fdt = Math.min(0.05, (nowT - this.lastRenderT) / 1000); this.lastRenderT = nowT;
    this.updateCamera(alpha);
    const yaw = this.camYaw;
    this.worldView.update(this.time, this.camera, yaw, this.mode === 'explore' ? this.explorer.group.position : this.camera.position);
    this.explorer.render(alpha, this.time, yaw, fdt);
    for (const c of this.creatures) c.actor.render(alpha, this.time, yaw, fdt);
    for (const m of this.fruits.values()) if (m.visible) m.position.y = groundHeight(m.position.x, m.position.z) + 0.05 + Math.sin(this.time * 2 + m.position.x) * 0.03;
    for (const p of this.particles) p.m.rotation.y = yaw;
    const wp = this.state.waypoint;
    this.waypointMesh.visible = !!wp && this.mode === 'explore';
    if (wp) { this.waypointMesh.position.set(wp[0], surfaceHeight(wp[0], wp[1]), wp[1]); this.waypointMesh.children[0].position.y = 0.6 + Math.sin(this.time * 2.5) * 0.15; }
    this.ambient.update(this.time, fdt, this.explorer.pos, yaw, true);
    // place the foreground clumps in the bottom corners of the current view
    const d = 1.2, hh = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * d, hw = hh * this.camera.aspect;
    for (const m of this.fg) {
      const sd = m.userData.side as number, img = (m.material as THREE.MeshBasicMaterial).map!.image as { width: number; height: number };
      const H = hh * (sd < 0 ? 0.82 : 0.74), W = H * img.width / img.height;
      m.scale.set(H, H, 1);
      m.position.set(sd * (hw - W * 0.4), -hh - H * 0.12, -d);
      m.rotation.z = Math.sin(this.time * 0.9 + sd) * 0.015 - sd * 0.02;
      m.visible = this.mode === 'explore' && !document.body.classList.contains('no-fg');
    }
    this.fadeOccluders();
  }

  /** Fade scenery sprites that hide the explorer. */
  private fadeOccluders() {
    for (const m of this.fadedNow) { const orig = m.userData.origMat as THREE.Material; if (orig) m.material = orig; }
    this.fadedNow.clear();
    if (this.mode !== 'explore') return;
    const cam = this.camera.position, e = this.explorer.center();
    for (const b of this.worldView.billboards) {
      const m = b as THREE.Mesh; if (m.scale.x < 2) continue;
      // camera-space test: in front of the camera, nearer than the explorer, overlapping the explorer horizontally — or simply very close to the lens
      const toB = m.position.clone().sub(cam), toE = e.clone().sub(cam);
      const fwd = new THREE.Vector3(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw));
      const right = new THREE.Vector3(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw));
      const depthB = toB.dot(fwd), depthE = toE.dot(fwd);
      if (depthB < 0.5) continue;
      const half = m.scale.x * ((m.geometry as THREE.PlaneGeometry).parameters.width) / 2;
      const blocks = depthB < depthE && Math.abs(toB.dot(right) - toE.dot(right)) < half * 0.9;
      const tooClose = depthB < 7 && Math.abs(toB.dot(right)) < depthB * 0.8 + half;
      if (blocks || tooClose) {
        const mat = m.material as THREE.MeshBasicMaterial;
        let f = this.fadedMats.get(mat);
        if (!f) { const c = mat.clone(); c.transparent = true; c.opacity = 0.35; c.depthWrite = false; f = c; this.fadedMats.set(mat, f); }
        m.userData.origMat = mat; m.material = f; this.fadedNow.add(m);
      }
    }
  }

  private sfx(n: Sfx, vol = 1, rate = 1) { this.audio.play(n, { vol, rate }); }
}

const planeGeo = new THREE.PlaneGeometry(1, 1);
function canvasTex(draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas'); c.width = c.height = 64; draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function chirpFor(s: SpeciesId): Sfx {
  return s === 'leaflet' ? 'leaflet-chirp' : s === 'bloomble' ? 'peach-chirp' : s === 'bubble' ? 'bubble-chirp' : s === 'flower-grazer' ? 'grazer-call' : 'finch-chirp';
}
export function lerpAngle(a: number, b: number, t: number) { return a + wrap(b - a) * t; }
function clamp(v: number, a: number, b: number) { return Math.max(a, Math.min(b, v)); }
void rng; void inWater;
