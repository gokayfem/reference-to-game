import * as THREE from 'three';
import { CELL, isTransport, type LevelDef, type NodeDef } from '../game/levels';
import { DV, type Dir } from '../game/ports';
import type { Simulation, NodeRT } from '../game/sim';
import { TRANSIT_SECONDS, STEP, EMIT_SECONDS } from '../game/sim';
import { PAL, enamel, matte, tileTexture, tileNormalMap, type Quality } from './materials';
import {
  beltRun, transportPieces, stubPieces, hubMesh, ROLLER_GEO, ROLLER_HUB_GEO, setBeltPhase, type RollerSpot,
  buildSource, buildMixer, buildStarPress, buildCooler, buildCubePress, buildBin, type MachineView,
  candyGeometry, candyMaterial, candyKind, type CandyKind,
} from './models';
import { JellyField, type JellyOpts } from './jelly';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { travelPieces, sampleChain, linePiece, edgePoint, BELT_Y, HALF } from './paths';

const MACHINE_SCALE = new THREE.Vector3(1.72, 1.9, 1.62);
const KIND_SCALE: Record<string, [number, number, number]> = {
  star_press: [1.75, 1.62, 1.6], cube_press: [1.72, 1.7, 1.6], bin: [1.6, 1.5, 1.6], cooler: [1.62, 1.8, 1.6],
};
const MACHINE_INSET: Record<string, number> = { source: 0.7, mixer: 0.7, star_press: 0.7, cooler: 0.7, cube_press: 0.7, bin: 0.7 };
const CANDY_SCALE = 2.15;
const CANDY_KINDS: CandyKind[] = ['red', 'yellow', 'orange', 'orange-star', 'blue', 'blue-cool', 'blue-cube'];

function roundedRect(w: number, h: number, r: number, cx = 0, cy = 0) {
  const s = new THREE.Shape();
  const x = cx - w / 2, y = cy - h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
function holePath(w: number, h: number, r: number) {
  const p = new THREE.Path();
  const x = -w / 2, y = -h / 2;
  p.moveTo(x + r, y); p.quadraticCurveTo(x, y, x, y + r); p.lineTo(x, y + h - r); p.quadraticCurveTo(x, y + h, x + r, y + h);
  p.lineTo(x + w - r, y + h); p.quadraticCurveTo(x + w, y + h, x + w, y + h - r); p.lineTo(x + w, y + r); p.quadraticCurveTo(x + w, y, x + w - r, y);
  p.closePath();
  return p;
}
function flatExtrude(shape: THREE.Shape, depth: number, bevel: number, mat: THREE.Material, y0: number) {
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 4, curveSegments: 14 });
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, mat);
  m.position.y = y0;
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

export class BoardView {
  root = new THREE.Group();
  private static_ = new THREE.Group();
  private transports = new THREE.Group();
  private machines = new Map<string, { view: MachineView; def: NodeDef; stubs: THREE.Group }>();
  private rollerMesh: THREE.InstancedMesh | null = null;
  private rollerHub: THREE.InstancedMesh | null = null;
  private candyMeshes = new Map<CandyKind, THREE.InstancedMesh>();
  private binFilled = new Map<string, number>();
  private badges = new THREE.Group();
  private chevrons = new THREE.Group();
  hoverGroup = new THREE.Group();
  ghostGroup = new THREE.Group();
  readonly W: number; readonly H: number;
  readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private tmp = new THREE.Vector3();
  private tan = new THREE.Vector3();
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  showChevrons = true;

  constructor(public level: LevelDef, public quality: Quality) {
    [this.W, this.H] = level.size;
    this.root.add(this.static_, this.transports, this.badges, this.chevrons, this.hoverGroup, this.ghostGroup);
    this.buildBoard();
    for (const k of CANDY_KINDS) {
      const im = new THREE.InstancedMesh(candyGeometry(k), candyMaterial(k, quality), 160);
      im.count = 0; im.castShadow = true; im.frustumCulled = false;
      this.candyMeshes.set(k, im);
      this.root.add(im);
    }
  }

  cellCenter(c: number, r: number, out = new THREE.Vector3()) {
    return out.set((c - (this.W - 1) / 2) * CELL, 0, (r - (this.H - 1) / 2) * CELL);
  }
  cellAt(p: THREE.Vector3): [number, number] {
    return [Math.round(p.x / CELL + (this.W - 1) / 2), Math.round(p.z / CELL + (this.H - 1) / 2)];
  }

  extent() {
    const w = this.W * CELL, h = this.H * CELL;
    return new THREE.Box3(new THREE.Vector3(-w / 2 - 1.0, -1.35, -h / 2 - 1.0), new THREE.Vector3(w / 2 + 1.0, 0.35, h / 2 + 1.0));
  }

  private buildBoard() {
    const w = this.W * CELL, h = this.H * CELL;
    const groove = 0.2, rimW = 0.72;
    const inW = w + groove * 2, inH = h + groove * 2;
    const outW = inW + rimW * 2, outH = inH + rimW * 2;
    // floor tiles: one tile per cell
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshPhysicalMaterial({ map: tileTexture(this.W, this.H), normalMap: tileNormalMap(this.W, this.H), normalScale: new THREE.Vector2(0.45, 0.45), roughness: 0.3, clearcoat: 0.55, clearcoatRoughness: 0.14 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    this.static_.add(floor);
    // mint groove around the tiled field
    const grooveMesh = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(inW, inH, 0.25)), matte('#a9d4ca', 0.7));
    grooveMesh.rotation.x = -Math.PI / 2; grooveMesh.position.y = -0.01; grooveMesh.receiveShadow = true;
    this.static_.add(grooveMesh);
    // raised cream rim (thick rounded bevel)
    const rimShape = roundedRect(outW - 0.16, outH - 0.16, 0.85);
    rimShape.holes.push(holePath(inW + 0.16, inH + 0.16, 0.35));
    this.static_.add(flatExtrude(rimShape, 0.24, 0.08, enamel('#efe5d6', 0.5, 0.35), -0.08));
    // thin mint inlay line on the rim top
    const inlay = roundedRect(inW + 0.62, inH + 0.62, 0.5);
    inlay.holes.push(holePath(inW + 0.5, inH + 0.5, 0.45));
    const inlayMesh = new THREE.Mesh(new THREE.ShapeGeometry(inlay), matte('#9fcfc4', 0.6));
    inlayMesh.rotation.x = -Math.PI / 2; inlayMesh.position.y = 0.245;
    this.static_.add(inlayMesh);
    // mint body band and cream foot
    this.static_.add(flatExtrude(roundedRect(outW - 0.1, outH - 0.1, 0.85), 0.9, 0.05, enamel('#93cbbf', 0.55, 0.25), -1.05));
    this.static_.add(flatExtrude(roundedRect(outW + 0.04, outH + 0.04, 0.9), 0.16, 0.06, enamel('#efe5d6', 0.5, 0.3), -1.3));
    // little brass latches on the front band like the reference
    for (const x of [-outW * 0.32, outW * 0.32]) {
      const latch = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.04, 20), enamel('#d9a06a', 0.35, 0.6));
      latch.rotation.x = Math.PI / 2; latch.position.set(x, -0.55, outH / 2 - 0.02);
      this.static_.add(latch);
    }
  }

  /** Rebuild conveyor visuals from the current layout. Fixed machines are built once. */
  setLayout(nodes: NodeDef[]) {
    // dispose old transport geometry (materials are shared)
    this.transports.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.userData.ownGeo) (o as THREE.Mesh).geometry.dispose(); });
    this.transports.clear();
    this.chevrons.clear();
    const rollers: RollerSpot[] = [];
    const present = new Set<string>();
    for (const def of nodes) {
      const center = this.cellCenter(def.cell[0], def.cell[1]);
      if (isTransport(def.kind)) {
        const g = new THREE.Group();
        g.position.copy(center);
        const local: RollerSpot[] = [];
        for (const pcs of transportPieces(def)) g.add(beltRun(pcs, local, { foot: true }));
        if (def.kind === 'split' || def.kind === 'merge') g.add(hubMesh(def.kind));
        local.forEach((r) => rollers.push({ pos: r.pos.clone().add(center), rotY: r.rotY }));
        g.traverse((o) => { o.userData.ownGeo = true; });
        g.userData.cell = def.cell;
        this.transports.add(g);
        this.addChevron(def, center);
      } else {
        present.add(def.id);
        if (!this.machines.has(def.id)) this.addMachine(def);
        const m = this.machines.get(def.id)!;
        // stubs contribute rollers each rebuild
        m.stubs.userData.rollers.forEach((r: RollerSpot) => rollers.push(r));
      }
    }
    for (const [id, m] of this.machines) if (!present.has(id)) { this.root.remove(m.view.group, m.stubs); this.machines.delete(id); }
    mergeStatic(this.transports);
    // instanced rollers: light grey discs with dark hubs (reference)
    if (this.rollerMesh) { this.root.remove(this.rollerMesh); this.rollerMesh.dispose(); }
    if (this.rollerHub) { this.root.remove(this.rollerHub); this.rollerHub.dispose(); }
    const n = Math.max(1, rollers.length);
    const rm = new THREE.InstancedMesh(ROLLER_GEO, new THREE.MeshPhysicalMaterial({ color: '#d6d1ca', roughness: 0.3, metalness: 0.35, clearcoat: 0.6 }), n);
    const hub = new THREE.InstancedMesh(ROLLER_HUB_GEO, new THREE.MeshStandardMaterial({ color: '#5b5650', roughness: 0.35, metalness: 0.6 }), n);
    rollers.forEach((r, i) => {
      this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.rotY);
      this.m4.compose(r.pos, this.q, this.s.set(1, 1, 1));
      rm.setMatrixAt(i, this.m4); hub.setMatrixAt(i, this.m4);
    });
    rm.count = hub.count = rollers.length; rm.castShadow = true;
    this.rollerMesh = rm; this.rollerHub = hub;
    this.root.add(rm, hub);
  }

  private addChevron(def: NodeDef, center: THREE.Vector3) {
    // faint painted arrow showing flow direction (readable ports at game scale)
    const out = def.outputs[0], inp = def.inputs[0];
    const pcs = travelPieces(inp, out, def.kind);
    const p = new THREE.Vector3(), t = new THREE.Vector3();
    sampleChain(pcs, 0.5, p, t);
    const shape = new THREE.Shape();
    shape.moveTo(-0.1, -0.13); shape.lineTo(0.08, 0); shape.lineTo(-0.1, 0.13); shape.lineTo(-0.04, 0); shape.closePath();
    const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: '#f2d2a6', transparent: true, opacity: 0.55, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.atan2(-t.z, t.x);
    m.position.copy(p).add(center).setY(BELT_Y + 0.005);
    this.chevrons.add(m);
  }

  private addMachine(def: NodeDef) {
    let view: MachineView;
    const q = this.quality;
    switch (def.kind) {
      case 'source': view = buildSource(def.color!, q); break;
      case 'mixer': view = buildMixer(q); break;
      case 'star_press': view = buildStarPress(q); break;
      case 'cooler': view = buildCooler(q); break;
      case 'cube_press': view = buildCubePress(q); break;
      default: {
        const a = def.accepts!;
        view = buildBin(a, a.shape === 'star' ? 'ORANGE\nSTARS' : 'BLUE\nCUBES');
      }
    }
    const center = this.cellCenter(def.cell[0], def.cell[1]);
    view.group.position.copy(center);
    if (KIND_SCALE[def.kind]) view.group.scale.set(...KIND_SCALE[def.kind]); else view.group.scale.copy(MACHINE_SCALE);
    const stubs = new THREE.Group();
    stubs.position.copy(center);
    const rollers: RollerSpot[] = [];
    const inset = MACHINE_INSET[def.kind] ?? 0.5;
    for (const d of def.inputs) stubs.add(beltRun(stubPieces(d, inset, true), rollers, { foot: true }));
    for (const d of def.outputs) stubs.add(beltRun(stubPieces(d, inset, false), rollers, { foot: true }));
    stubs.userData.rollers = rollers.map((r) => ({ pos: r.pos.clone().add(center), rotY: r.rotY }));
    mergeStatic(stubs);
    mergeStatic(view.group);
    this.root.add(stubs, view.group);
    this.machines.set(def.id, { view, def, stubs });
  }

  machineGroup(id: string) { return this.machines.get(id)?.view.group; }

  private jelly = new JellyField();
  private flyers: { id: number; kind: CandyKind; from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; arc: number; shrink: boolean; land?: () => void }[] = [];
  private seenProc = new Map<string, unknown>();
  private confetti: { id: number; kind: CandyKind; pos: THREE.Vector3; vel: THREE.Vector3; age: number; spin: number; spinV: number }[] = [];

  /** Burst of candy from every collection bin when the level is completed. */
  celebrate() {
    for (const m of this.machines.values()) {
      if (!m.view.bin) continue;
      const kind: CandyKind = m.def.accepts!.shape === 'star' ? 'orange-star' : 'blue-cube';
      const c = this.cellCenter(m.def.cell[0], m.def.cell[1]);
      const kinds: CandyKind[] = [kind, kind, 'red', 'yellow', kind];
      for (let i = 0; i < 26; i++) {
        const a = Math.random() * Math.PI * 2, sp = 1.2 + Math.random() * 2.2;
        this.confetti.push({
          id: this.flyerId--, kind: kinds[i % kinds.length], pos: c.clone().setY(0.9),
          vel: new THREE.Vector3(Math.cos(a) * sp, 5 + Math.random() * 3.5, Math.sin(a) * sp), age: -Math.random() * 0.25,
          spin: Math.random() * 6, spinV: (Math.random() - 0.5) * 10,
        });
      }
    }
  }
  private settling: { mesh: THREE.Object3D; s: number; sv: number; base: number }[] = [];
  private flyerId = -1;
  private lastT = 0;

  /** Per-frame visual sync from simulation state. `alpha` extrapolates in-flight candy smoothly between steps. */
  update(sim: Simulation | null, nodes: NodeDef[], alpha: number, t: number, running: boolean) {
    void nodes;
    const dt = this.lastT ? t - this.lastT : 1 / 60;
    this.lastT = t;
    this.jelly.begin(dt);
    setBeltPhase(running ? (sim?.time ?? 0) / TRANSIT_SECONDS : 0);
    const counts = new Map<CandyKind, number>();
    CANDY_KINDS.forEach((k) => counts.set(k, 0));
    const put = (kind: CandyKind, pos: THREE.Vector3, yaw: number, id: number, o: JellyOpts = {}) => {
      const im = this.candyMeshes.get(kind)!;
      const i = counts.get(kind)!;
      if (i >= 160) return;
      this.jelly.step(id, kind, pos, yaw + (kind === 'orange-star' ? id * 0.4 : 0), t, this.q, this.s, { ...o, scale: (o.scale ?? 1) * CANDY_SCALE });
      this.m4.compose(pos, this.q, this.s);
      im.setMatrixAt(i, this.m4);
      counts.set(kind, i + 1);
    };
    if (sim && running) {
      for (const n of sim.nodes.values()) {
        const center = this.cellCenter(n.def.cell[0], n.def.cell[1]);
        const blocked = n.blockedFor > 0.15;
        if (n.candy) {
          const exit = n.exit ?? n.def.outputs[0];
          const pcs = travelPieces(n.entry!, exit, n.def.kind);
          const prog = Math.min(1, n.progress + (n.progress < 1 ? alpha * STEP / TRANSIT_SECONDS : 0));
          sampleChain(pcs, prog, this.tmp, this.tan);
          this.tmp.add(center).setY(BELT_Y);
          put(candyKind(n.candy), this.tmp, Math.atan2(-this.tan.z, this.tan.x), n.candy.id, { blocked });
        }
        if (n.out) {
          const d = n.def.outputs[0];
          const inset = MACHINE_INSET[n.def.kind] ?? 0.5;
          const pc = linePiece(edgePoint(d, HALF - inset + 0.1), edgePoint(d));
          const prog = Math.min(1, n.outProgress + (n.outProgress < 1 ? alpha * STEP / EMIT_SECONDS : 0));
          pc.at(prog, this.tmp); this.tmp.add(center).setY(BELT_Y);
          // hoppers drop each gummy onto the belt with a little bounce
          if (n.def.kind === 'source') this.tmp.y += Math.max(0, 1 - prog * 1.6) ** 2 * 0.9;
          put(candyKind(n.out), this.tmp, Math.atan2(-DV[d][1], DV[d][0]), n.out.id, { blocked });
        }
        const m = this.machines.get(n.def.id);
        if (m) {
          const frac = n.processing ? n.processing.t / n.processing.dur : 0;
          m.view.update(n.state, t, frac);
          if (n.processing) this.showProcessing(n, m.view.group, center, frac, t, put);
          if (n.def.kind === 'mixer') {
            // ingredients waiting for their partner bounce inside the funnel
            for (const port of n.def.inputs) for (const c of n.buffers[port] ?? []) {
              this.ensureFunnelHop(c, port, center, m.view.group.scale.y);
              if (this.flyers.some((f) => f.id === c.id)) continue;
              const off = n.def.inputs.indexOf(port) ? 0.12 : -0.12;
              this.tmp.set(center.x + off, center.y + 1.5 * m.view.group.scale.y + Math.abs(Math.sin(t * 6 + c.id)) * 0.12, center.z);
              put(candyKind(c), this.tmp, t, c.id, { scale: 0.8 });
            }
          }
          if (m.view.bin) this.syncBin(n, m.view, center);
        }
      }
    } else {
      for (const m of this.machines.values()) m.view.update('idle', t, 0);
    }
    // candy flying along arcs (into mixer funnels and bins)
    for (let i = this.flyers.length - 1; i >= 0; i--) {
      const f = this.flyers[i];
      f.t += dt / f.dur;
      const k = Math.min(1, f.t);
      this.tmp.lerpVectors(f.from, f.to, k);
      this.tmp.y += Math.sin(k * Math.PI) * f.arc;
      put(f.kind, this.tmp, k * 4, f.id, { scale: f.shrink ? 1 - k * 0.55 : 1 });
      if (f.t >= 1) { f.land?.(); this.flyers.splice(i, 1); }
    }
    // settled bin candy squash on landing
    for (let i = this.settling.length - 1; i >= 0; i--) {
      const st = this.settling[i];
      st.sv += (200 * (0 - st.s) - 7 * st.sv) * Math.min(dt, 0.05);
      st.s += st.sv * Math.min(dt, 0.05);
      st.mesh.scale.set(st.base * (1 + st.s * 0.5), st.base * (1 - st.s), st.base * (1 + st.s * 0.5));
      if (Math.abs(st.s) < 0.002 && Math.abs(st.sv) < 0.02) { st.mesh.scale.setScalar(st.base); this.settling.splice(i, 1); }
    }
    // completion confetti: real candy pieces with gravity and floor bounces
    for (let i = this.confetti.length - 1; i >= 0; i--) {
      const c = this.confetti[i];
      c.age += dt;
      c.vel.y -= 14 * dt;
      c.pos.addScaledVector(c.vel, dt);
      if (c.pos.y < 0.05 && c.vel.y < 0) { c.pos.y = 0.05; c.vel.y *= -0.45; c.vel.x *= 0.7; c.vel.z *= 0.7; this.jelly.impulse(c.id, 2.5); }
      const fade = Math.max(0, 1 - Math.max(0, c.age - 2.2) / 0.8);
      if (fade <= 0) { this.confetti.splice(i, 1); continue; }
      put(c.kind, c.pos, c.spin + c.age * c.spinV, c.id, { scale: 0.7 * fade });
    }
    this.jelly.end();
    for (const [k, im] of this.candyMeshes) { im.count = counts.get(k)!; im.instanceMatrix.needsUpdate = true; }
    this.updateBadges(sim, running, t);
    this.chevrons.visible = this.showChevrons;
  }

  /** Candy visibly inside machines: swirling in the mixer, chilling in the cooler, squashed under presses. */
  private showProcessing(n: NodeRT, grp: THREE.Object3D, center: THREE.Vector3, frac: number, t: number,
    put: (kind: CandyKind, pos: THREE.Vector3, yaw: number, id: number, o?: JellyOpts) => void) {
    const proc = n.processing!;
    const first = this.seenProc.get(n.def.id) !== proc;
    this.seenProc.set(n.def.id, proc);
    const sy = grp.scale.y;
    if (n.def.kind === 'mixer') {
      void first;
      proc.inputs.forEach((c, i) => {
        this.ensureFunnelHop(c, n.def.inputs[i], center, sy);
        if (this.flyers.some((f) => f.id === c.id)) return;
        const drop = Math.min(1, frac / 0.25);
        const a = t * 7 + i * Math.PI;
        const r = 0.22 * grp.scale.x * drop;
        const y = THREE.MathUtils.lerp(1.5, 0.78 - frac * 0.12, drop);
        this.tmp.set(center.x + Math.cos(a) * r, center.y + y * sy, center.z + Math.sin(a) * r);
        put(candyKind(c), this.tmp, -a, c.id, { scale: 0.75 * (1 - Math.max(0, frac - 0.25) * 0.8), ext: drop >= 1 ? 0.15 * Math.sin(t * 20 + i) : 0 });
      });
    } else if (n.def.kind === 'cooler') {
      const c = proc.inputs[0];
      this.tmp.set(center.x, center.y + (0.62 + 0.18 * Math.min(1, frac * 3)) * sy, center.z);
      put(candyKind(c), this.tmp, t * 1.5, c.id, { scale: 0.85, ext: -0.1 * Math.sin(frac * Math.PI), noLean: true });
    } else if (n.def.kind === 'star_press' || n.def.kind === 'cube_press') {
      const c = proc.inputs[0];
      const press = Math.max(0, Math.sin(Math.min(1, frac) * Math.PI));
      this.tmp.copy(center).setY(BELT_Y);
      put(candyKind(c), this.tmp, 0, c.id, { ext: press * 0.5, noLean: true });
      if (frac > 0.92) this.jelly.impulse(c.id, -2.5);
    }
  }

  private hopped = new Set<number>();
  private ensureFunnelHop(c: { id: number; color: string; shape: string; temp: string }, port: Dir, center: THREE.Vector3, sy: number) {
    if (this.hopped.has(c.id)) return;
    this.hopped.add(c.id);
    const from = edgePoint(port, 0.05).add(center).setY(BELT_Y);
    const to = center.clone().setY(center.y + 1.5 * sy);
    this.flyers.push({ id: c.id, kind: candyKind(c), from, to, t: 0, dur: 0.34, arc: 0.7, shrink: false });
  }

  private syncBin(n: NodeRT, view: MachineView, center: THREE.Vector3) {
    const have = this.binFilled.get(n.def.id) ?? 0;
    if (n.count > have) {
      const kind: CandyKind = n.def.accepts!.shape === 'star' ? 'orange-star' : 'blue-cube';
      for (let i = have; i < n.count && i < view.bin!.slots.length; i++) {
        const slot = view.bin!.slots[i];
        const to = slot.clone().multiply(view.group.scale).add(center);
        const from = edgePoint(n.def.inputs[0], 0.02).add(center).setY(BELT_Y);
        const idx = i;
        this.flyers.push({
          id: this.flyerId--, kind, from, to, t: 0, dur: 0.42, arc: 0.9, shrink: false,
          land: () => {
            const mesh = new THREE.Mesh(this.candyMeshes.get(kind)!.geometry, this.candyMeshes.get(kind)!.material as THREE.Material);
            mesh.position.copy(slot);
            mesh.rotation.set((idx % 3) * 0.2, idx * 1.3, (idx % 2) * 0.25);
            mesh.castShadow = true;
            const base = 1.3;
            mesh.scale.setScalar(base);
            view.bin!.addCandy(mesh);
            this.settling.push({ mesh, s: 0.45, sv: 0, base });
          },
        });
      }
      this.binFilled.set(n.def.id, n.count);
    }
  }

  /** Clear bin contents and in-flight visuals (new attempt). */
  resetBins() {
    for (const m of this.machines.values()) {
      if (!m.view.bin) continue;
      m.view.bin.contents.clear();
    }
    this.binFilled.clear();
    this.flyers = [];
    this.settling = [];
    this.confetti = [];
    this.seenProc.clear();
    this.hopped.clear();
    this.jelly.clear();
  }

  private badgeMat = new THREE.SpriteMaterial({ map: badgeTexture(), depthTest: false, transparent: true });
  private updateBadges(sim: Simulation | null, running: boolean, t: number) {
    this.badges.clear();
    if (!sim || !running || sim.complete) return;
    for (const n of sim.nodes.values()) {
      if (n.blockedFor < 1.0 || !n.blockedReason || n.blockedReason.startsWith('Waiting')) continue;
      const s = new THREE.Sprite(this.badgeMat);
      const c = this.cellCenter(n.def.cell[0], n.def.cell[1]);
      s.position.set(c.x, 1.25 + Math.sin(t * 5) * 0.06, c.z);
      s.scale.setScalar(0.62);
      s.renderOrder = 10;
      this.badges.add(s);
    }
  }

  blockedNodes(sim: Simulation): NodeRT[] {
    if (sim.complete) return [];
    return [...sim.nodes.values()].filter((n) => n.blockedFor >= 1.0 && n.blockedReason && !n.blockedReason.startsWith('Waiting'));
  }

  // ---------- hover & ghost ----------
  private hoverTile: THREE.Mesh | null = null;
  showHover(cell: [number, number] | null, ok: boolean) {
    if (!this.hoverTile) {
      const shape = roundedRect(CELL - 0.08, CELL - 0.08, 0.16);
      shape.holes.push(holePath(CELL - 0.24, CELL - 0.24, 0.1));
      this.hoverTile = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: '#5cc6b2', transparent: true, opacity: 0.9, depthWrite: false }));
      this.hoverTile.rotation.x = -Math.PI / 2;
      this.hoverTile.renderOrder = 5;
      this.hoverGroup.add(this.hoverTile);
    }
    this.hoverTile.visible = !!cell;
    if (!cell) return;
    (this.hoverTile.material as THREE.MeshBasicMaterial).color.set(ok ? '#4fc2ad' : '#ec6f62');
    this.cellCenter(cell[0], cell[1], this.hoverTile.position).setY(0.02);
  }

  private hintRing: THREE.Mesh | null = null;
  /** Pulsing mint ring on the tile the last jam points at. */
  showHint(cell: [number, number] | null, t: number) {
    if (!this.hintRing) {
      const shape = roundedRect(CELL - 0.04, CELL - 0.04, 0.2);
      shape.holes.push(holePath(CELL - 0.22, CELL - 0.22, 0.12));
      this.hintRing = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: '#7fe3cf', transparent: true, depthWrite: false }));
      this.hintRing.rotation.x = -Math.PI / 2; this.hintRing.renderOrder = 4;
      this.hoverGroup.add(this.hintRing);
    }
    this.hintRing.visible = !!cell;
    if (!cell) return;
    this.cellCenter(cell[0], cell[1], this.hintRing.position).setY(0.03);
    const k = 1 + Math.sin(t * 4) * 0.04;
    this.hintRing.scale.set(k, k, 1);
    (this.hintRing.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(t * 4) * 0.3;
  }

  private ghostMat = new THREE.MeshBasicMaterial({ color: '#7fd8c7', transparent: true, opacity: 0.45, depthWrite: false });
  private ghostBad = new THREE.MeshBasicMaterial({ color: '#f07a6c', transparent: true, opacity: 0.4, depthWrite: false });
  setGhost(def: NodeDef | null, ok: boolean) {
    this.ghostGroup.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); });
    this.ghostGroup.clear();
    if (!def) return;
    const center = this.cellCenter(def.cell[0], def.cell[1]);
    const g = new THREE.Group();
    const dummy: RollerSpot[] = [];
    for (const pcs of transportPieces(def)) g.add(beltRun(pcs, dummy, { foot: false }));
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { (o as THREE.Mesh).material = ok ? this.ghostMat : this.ghostBad; (o as THREE.Mesh).castShadow = false; } });
    g.position.copy(center).setY(0.06);
    this.ghostGroup.add(g);
    // port arrows: inputs teal pointing in, outputs coral pointing out
    for (const d of def.inputs) this.ghostGroup.add(portArrow(center, d, true));
    for (const d of def.outputs) this.ghostGroup.add(portArrow(center, d, false));
  }
}

/** Collapse all meshes under `root` into one mesh per material (static conveyor geometry). */
function mergeStatic(root: THREE.Group) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const noShadow = new Set<THREE.Material>();
  const order = new Map<THREE.Material, number>();
  const old: THREE.Mesh[] = [];
  const kept = new Set<THREE.Object3D>();
  root.traverse((o) => { if (o.userData.keep) o.traverse((c) => kept.add(c)); });
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material) || kept.has(m) || !m.visible) return;
    let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    const mat = m.material as THREE.MeshStandardMaterial;
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && !(name === 'uv' && mat.map)) g.deleteAttribute(name);
    if (mat.map && !g.attributes.uv) { g.dispose(); g = null as unknown as THREE.BufferGeometry; return; }
    const list = buckets.get(m.material) ?? [];
    list.push(g); buckets.set(m.material, list);
    if (!m.castShadow) noShadow.add(m.material);
    if (m.renderOrder) order.set(m.material, m.renderOrder);
    old.push(m);
  });
  for (const m of old) { m.geometry.dispose(); m.removeFromParent(); }
  root.children.slice().forEach((c) => { if (c.children.length === 0 && !(c as THREE.Mesh).isMesh && !c.userData.keep) c.removeFromParent(); });
  for (const [mat, list] of buckets) {
    const merged = mergeGeometries(list, false);
    list.forEach((g) => g.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = !noShadow.has(mat); mesh.receiveShadow = true;
    mesh.renderOrder = order.get(mat) ?? 0;
    mesh.userData.ownGeo = true;
    root.add(mesh);
  }
}

const ARROW_GEO = (() => {
  const s = new THREE.Shape();
  s.moveTo(-0.16, -0.15); s.lineTo(0.14, 0); s.lineTo(-0.16, 0.15); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  return g;
})();
function portArrow(center: THREE.Vector3, d: Dir, inward: boolean) {
  const m = new THREE.Mesh(ARROW_GEO, new THREE.MeshBasicMaterial({ color: inward ? '#2fa892' : '#ee7d5f', depthTest: false, transparent: true }));
  const e = edgePoint(d, inward ? -0.12 : -0.12);
  m.position.copy(center).add(e).setY(0.5);
  const ang = Math.atan2(-DV[d][1], DV[d][0]);
  m.rotation.y = inward ? ang + Math.PI : ang;
  m.renderOrder = 20;
  return m;
}

function badgeTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff'; g.beginPath(); g.arc(64, 64, 58, 0, 7); g.fill();
  g.fillStyle = '#ec6f5a'; g.beginPath(); g.arc(64, 64, 50, 0, 7); g.fill();
  g.fillStyle = '#ffffff'; g.font = '700 78px Fredoka, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('!', 64, 68);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export { PAL };
