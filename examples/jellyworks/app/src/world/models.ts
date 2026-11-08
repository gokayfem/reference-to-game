import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { PAL, enamel, matte, metal, clearGlass, gummy, labelTexture, snowflakeTexture, slatTexture, slatNormalMap, type Quality } from './materials';
import { type PathPiece, linePiece, arcPiece, edgePoint, BELT_Y, HALF } from './paths';
import type { Dir } from '../game/ports';
import type { NodeDef } from '../game/levels';

// ---------- generic helpers ----------
export function rbox(w: number, h: number, d: number, r: number, mat: THREE.Material, seg = r >= 0.09 ? 3 : 2) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2)), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function cyl(rt: number, rb: number, h: number, mat: THREE.Material, seg = 32) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function lathe(points: [number, number][], mat: THREE.Material, seg = 40) {
  const m = new THREE.Mesh(new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), seg), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
export function starShape(outer: number, inner: number, round = 0) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer;
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  s.closePath();
  void round;
  return s;
}
function screw(x: number, y: number, z: number, axis: 'x' | 'z' = 'z') {
  const m = new THREE.Mesh(SCREW_GEO, metal('#b9b6b0', 0.3));
  m.position.set(x, y, z);
  if (axis === 'z') m.rotation.x = Math.PI / 2; else m.rotation.z = Math.PI / 2;
  return m;
}
const SCREW_GEO = new THREE.CylinderGeometry(0.028, 0.028, 0.02, 12);

// ---------- sweep along path pieces ----------
/** Sweep a 2D profile (lateral, up) along a chain of path pieces. */
export function sweep(pieces: PathPiece[], profile: [number, number][], segsPerMeter = 14, closed = true): THREE.BufferGeometry {
  const pos: number[] = [];
  const p = new THREE.Vector3(), t = new THREE.Vector3(), side = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const rings: THREE.Vector3[][] = [];
  for (const pc of pieces) {
    const n = Math.max(2, Math.ceil(pc.length * segsPerMeter));
    for (let i = 0; i <= n; i++) {
      if (rings.length && i === 0) continue;
      pc.at(i / n, p); pc.tangent(i / n, t);
      side.crossVectors(t, up).normalize();
      rings.push(profile.map(([lx, ly]) => p.clone().addScaledVector(side, lx).setY(p.y + ly)));
    }
  }
  const pl = profile.length;
  const idx: number[] = [];
  rings.forEach((ring) => ring.forEach((v) => pos.push(v.x, v.y, v.z)));
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < (closed ? pl : pl - 1); j++) {
      const a = i * pl + j, b = i * pl + ((j + 1) % pl), c = (i + 1) * pl + j, d = (i + 1) * pl + ((j + 1) % pl);
      idx.push(a, c, b, b, c, d);
    }
  }
  // end caps (fan) for closed profiles
  if (closed) {
    const capStart = pos.length / 3;
    const addCap = (ring: THREE.Vector3[], flip: boolean) => {
      const cx = ring.reduce((s, v) => s + v.x, 0) / pl, cy = ring.reduce((s, v) => s + v.y, 0) / pl, cz = ring.reduce((s, v) => s + v.z, 0) / pl;
      const base = pos.length / 3;
      pos.push(cx, cy, cz);
      ring.forEach((v) => pos.push(v.x, v.y, v.z));
      for (let j = 0; j < pl; j++) {
        const a = base + 1 + j, b = base + 1 + ((j + 1) % pl);
        if (flip) idx.push(base, b, a); else idx.push(base, a, b);
      }
    };
    void capStart;
    addCap(rings[0], false);
    addCap(rings[rings.length - 1], true);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Flat ribbon with u along travel (metres/CELL) and v across, used for the slatted belt surface. */
export function ribbon(pieces: PathPiece[], width: number, y: number, segsPerMeter = 16): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const p = new THREE.Vector3(), t = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  let dist = 0, rows = 0;
  for (const pc of pieces) {
    const n = Math.max(2, Math.ceil(pc.length * segsPerMeter));
    for (let i = 0; i <= n; i++) {
      if (rows && i === 0) continue;
      pc.at(i / n, p); pc.tangent(i / n, t);
      side.crossVectors(t, up).normalize();
      const d = dist + (pc.length * i) / n;
      for (const s of [-1, 1]) {
        pos.push(p.x + side.x * s * width / 2, y, p.z + side.z * s * width / 2);
        uv.push(d / 1.4, s < 0 ? 0 : 1);
      }
      rows++;
    }
    dist += pc.length;
  }
  for (let i = 0; i < rows - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // ensure normals face up
  const nrm = g.getAttribute('normal');
  for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
  return g;
}

function roundedProfile(w: number, h: number, r: number, y0: number, steps = 3): [number, number][] {
  const pts: [number, number][] = [];
  const corners: [number, number, number][] = [
    [w / 2 - r, y0 + h - r, 0], [-w / 2 + r, y0 + h - r, Math.PI / 2],
  ];
  pts.push([w / 2, y0]);
  for (const [cx, cy, a0] of corners) for (let i = 0; i <= steps; i++) {
    const a = a0 + (i / steps) * (Math.PI / 2);
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  pts.push([-w / 2, y0]);
  return pts.reverse();
}

// ---------- conveyor kit ----------
let SLAT: THREE.Texture | null = null;
let slatMat: THREE.MeshPhysicalMaterial | null = null;
let SLAT_N: THREE.Texture | null = null;
function getSlatMat() {
  if (!slatMat) {
    if (!SLAT) SLAT = slatTexture();
    if (!SLAT_N) SLAT_N = slatNormalMap();
    slatMat = new THREE.MeshPhysicalMaterial({ map: SLAT, normalMap: SLAT_N, normalScale: new THREE.Vector2(1, 1), roughness: 0.36, color: '#ffffff', clearcoat: 0.55, clearcoatRoughness: 0.22 });
  }
  return slatMat;
}
/** Advance belt slats; one shared texture so every belt animates in step with the simulation clock. */
export function setBeltPhase(phase: number) { if (SLAT) SLAT.offset.x = -phase; if (SLAT_N) SLAT_N.offset.x = -phase; }

const RAIL_PROFILE = roundedProfile(0.13, 0.18, 0.055, 0.11);
const BODY_PROFILE = roundedProfile(1.12, 0.12, 0.03, 0.05);
const FOOT_PROFILE = roundedProfile(1.34, 0.06, 0.025, 0.0);

export interface RollerSpot { pos: THREE.Vector3; rotY: number }

/** Build conveyor geometry for a chain of path pieces (one belt run). Adds roller positions to `rollers`. */
export function beltRun(pieces: PathPiece[], rollers: RollerSpot[], opts: { foot?: boolean } = {}): THREE.Group {
  const g = new THREE.Group();
  if (opts.foot !== false) {
    const foot = new THREE.Mesh(sweep(pieces, FOOT_PROFILE, 10), enamel(PAL.mint, 0.5, 0.3));
    foot.receiveShadow = true; g.add(foot);
  }
  const body = new THREE.Mesh(sweep(pieces, BODY_PROFILE, 10), enamel('#cfc6b8', 0.4, 0.3));
  body.receiveShadow = true; body.castShadow = true; g.add(body);
  const surf = new THREE.Mesh(ribbon(pieces, 0.94, BELT_Y - 0.02), getSlatMat());
  surf.receiveShadow = true; g.add(surf);
  for (const s of [-1, 1]) {
    const prof = RAIL_PROFILE.map(([x, y]) => [x + s * 0.52, y] as [number, number]);
    const rail = new THREE.Mesh(sweep(pieces, prof, 14), enamel(PAL.ivory, 0.22, 0.9));
    rail.castShadow = true; rail.receiveShadow = true; g.add(rail);
  }
  // rollers along the outside of both rails
  const p = new THREE.Vector3(), t = new THREE.Vector3(), side = new THREE.Vector3();
  for (const pc of pieces) {
    const n = Math.max(1, Math.round(pc.length / 0.46));
    for (let i = 0; i < n; i++) {
      const tt = (i + 0.5) / n;
      pc.at(tt, p); pc.tangent(tt, t);
      side.set(-t.z, 0, t.x);
      for (const s of [-1, 1]) {
        rollers.push({ pos: p.clone().addScaledVector(side, s * 0.61).setY(0.13), rotY: Math.atan2(-t.z, t.x) });
      }
    }
  }
  return g;
}

export const ROLLER_GEO = (() => {
  const g = new THREE.CylinderGeometry(0.085, 0.085, 0.05, 24);
  g.rotateX(Math.PI / 2); // axis along local Z (across the belt when rotY aligns X with travel)
  return g;
})();
export const ROLLER_HUB_GEO = (() => {
  const g = new THREE.CylinderGeometry(0.036, 0.036, 0.074, 14);
  g.rotateX(Math.PI / 2);
  return g;
})();

/** Visual pieces for a transport node (belt surface follows explicit ports). */
export function transportPieces(def: NodeDef): PathPiece[][] {
  const { kind, inputs, outputs } = def;
  if (kind === 'straight') return [[linePiece(edgePoint(inputs[0]), edgePoint(outputs[0]))]];
  if (kind === 'turn') return [[arcPiece(inputs[0], outputs[0])]];
  // split / merge: half runs from each port to the hub
  const c = new THREE.Vector3();
  return [...inputs.map((d) => [linePiece(edgePoint(d), c)]), ...outputs.map((d) => [linePiece(c, edgePoint(d))])];
}

/** Short belt stub from a machine housing out to its port edge. */
export function stubPieces(d: Dir, inset: number, isInput: boolean): PathPiece[] {
  const e = edgePoint(d), h = edgePoint(d, HALF - inset);
  return [isInput ? linePiece(e, h) : linePiece(h, e)];
}

export function hubMesh(kind: 'split' | 'merge') {
  const g = new THREE.Group();
  const base = cyl(0.5, 0.52, 0.12, enamel(PAL.mint, 0.5, 0.3)); base.position.y = 0.06; g.add(base);
  const ring = cyl(0.42, 0.44, 0.1, enamel(kind === 'split' ? PAL.coral : PAL.yellow, 0.4, 0.5)); ring.position.y = 0.16; g.add(ring);
  const top = cyl(0.33, 0.33, 0.04, getSlatMat()); top.position.y = BELT_Y + 0.0; g.add(top);
  const pin = cyl(0.08, 0.08, 0.06, enamel(PAL.ivory)); pin.position.y = BELT_Y + 0.04; g.add(pin);
  return g;
}

// ---------- machines ----------
export interface MachineView {
  group: THREE.Group;
  update(state: string, t: number, procFrac: number): void;
  setBlocked(on: boolean): void;
  bin?: { addCandy(mesh: THREE.Object3D): void; slots: THREE.Vector3[]; contents: THREE.Group };
}

const HOPPER_COLORS: Record<string, { body: string; funnel: string; inner: string; candy: string }> = {
  red: { body: '#eba2ab', funnel: '#e98d9a', inner: '#c7606f', candy: PAL.red },
  yellow: { body: '#f4e6c8', funnel: '#f3c03f', inner: '#d39a1f', candy: PAL.lemon },
  blue: { body: '#5c8fca', funnel: '#4f86c4', inner: '#2f5f99', candy: PAL.candyBlue },
};

function basePlate(w = 1.12, d = 1.12) {
  const g = new THREE.Group();
  const skirt = rbox(w + 0.06, 0.06, d + 0.06, 0.03, enamel(PAL.mint, 0.5, 0.5)); skirt.position.y = 0.03; g.add(skirt);
  const plinth = rbox(w, 0.07, d, 0.035, enamel('#e6ddd0', 0.45, 0.6)); plinth.position.y = 0.085; g.add(plinth);
  return g;
}

/** Slightly raised rounded panel used for the reference's inset enamel panels. */
function panel(w: number, h: number, color: string, x: number, y: number, z: number, ry = 0) {
  const m = rbox(w, h, 0.025, Math.min(w, h) * 0.18, enamel(color, 0.4, 0.8));
  m.position.set(x, y, z); m.rotation.y = ry;
  return m;
}

function gear(r = 0.13, color = '#bdb8b1') {
  const s = new THREE.Shape();
  const teeth = 8;
  for (let i = 0; i < teeth * 2; i++) {
    const a = (i / (teeth * 2)) * Math.PI * 2;
    const rr = i % 2 ? r * 0.78 : r;
    const a0 = a - Math.PI / (teeth * 2) * 0.6, a1 = a + Math.PI / (teeth * 2) * 0.6;
    if (i === 0) s.moveTo(Math.cos(a0) * rr, Math.sin(a0) * rr); else s.lineTo(Math.cos(a0) * rr, Math.sin(a0) * rr);
    s.lineTo(Math.cos(a1) * rr, Math.sin(a1) * rr);
  }
  const hole = new THREE.Path(); hole.absarc(0, 0, r * 0.32, 0, Math.PI * 2, true); s.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.01, bevelSegments: 2 });
  const m = new THREE.Mesh(geo, metal(color, 0.35));
  m.castShadow = true;
  return m;
}

function candyPile(color: string, quality: Quality, n: number, r: number, y: number) {
  const g = new THREE.Group();
  const geo = new THREE.SphereGeometry(0.07, 14, 10);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + i, rr = (i % 3) * r * 0.33;
    const m = new THREE.Mesh(geo, gummy(color, quality));
    m.scale.set(1, 0.8, 1.25);
    m.position.set(Math.cos(a) * rr, y + (i % 2) * 0.04, Math.sin(a) * rr);
    m.rotation.y = a;
    g.add(m);
  }
  return g;
}

const HOPPER_STYLE: Record<string, { body: string; arch: string; panel: string; funnel: string; band: string; candy: string }> = {
  red: { body: '#eda3ab', arch: '#eda3ab', panel: '#f6c3c8', funnel: '#ea8f9b', band: '#d97a86', candy: PAL.red },
  yellow: { body: '#f2e3c6', arch: '#f4c64e', panel: '#fbefd6', funnel: '#f3c03f', band: '#9fd2c6', candy: PAL.lemon },
  blue: { body: '#5a8ecb', arch: '#5a8ecb', panel: '#7eaade', funnel: '#4d85c6', band: '#3f72ad', candy: PAL.candyBlue },
};

/** Hopper: tower with collar + funnel on the input side, arched tunnel the belt runs through (reference kit). */
export function buildSource(color: string, quality: Quality): MachineView {
  const c = HOPPER_STYLE[color];
  const g = new THREE.Group();
  g.add(basePlate(1.06, 1.0));
  const bodyMat = enamel(c.body, 0.4, 0.75);
  const tower = rbox(0.5, 0.74, 0.76, 0.12, bodyMat); tower.position.set(-0.24, 0.49, 0); g.add(tower);
  const band = rbox(0.54, 0.12, 0.8, 0.05, enamel(c.band, 0.42, 0.7)); band.position.set(-0.24, 0.18, 0); g.add(band);
  g.add(panel(0.34, 0.32, c.panel, -0.24, 0.52, 0.385));
  const arch = tunnelHousing(0.44, 0.62, 0.74, 0.26, enamel(c.arch, 0.4, 0.75), null);
  arch.position.set(0.2, 0.12, 0); g.add(arch);
  // collar + funnel
  const collar = cyl(0.2, 0.22, 0.1, enamel(c.band === '#9fd2c6' ? PAL.cream : c.band, 0.38, 0.8)); collar.position.set(-0.24, 0.9, 0); g.add(collar);
  const funnel = lathe([[0.1, 0], [0.13, 0.05], [0.37, 0.38], [0.42, 0.42], [0.4, 0.45], [0.35, 0.41], [0.11, 0.08]], enamel(c.funnel, 0.3, 0.85));
  funnel.position.set(-0.24, 0.93, 0); g.add(funnel);
  const inner = lathe([[0.0, 0.1], [0.3, 0.36], [0.0, 0.36]], matte(new THREE.Color(c.funnel).multiplyScalar(0.62).getStyle(), 0.6));
  inner.position.set(-0.24, 0.94, 0); g.add(inner);
  const pile = candyPile(c.candy, quality, 8, 0.27, 1.3); pile.position.x = -0.24; pile.userData.keep = true; g.add(pile);
  // gear on the tower front, screws on the arch
  const gr = gear(0.12); gr.position.set(-0.24, 0.52, 0.4); gr.userData.keep = true; g.add(gr);
  const hub = cyl(0.04, 0.04, 0.05, metal('#8d8780', 0.3)); hub.rotation.x = Math.PI / 2; hub.position.set(-0.24, 0.52, 0.43); g.add(hub);
  g.add(screw(0.0, 0.62, 0.395), screw(0.4, 0.62, 0.395), screw(-0.42, 0.78, 0.385), screw(-0.06, 0.78, 0.385));
  if (color === 'yellow') { const door = rbox(0.16, 0.2, 0.03, 0.04, enamel(PAL.mint, 0.4, 0.8)); door.position.set(0.2, 0.26, 0.385); g.add(door); }
  return {
    group: g,
    update(_s, t) {
      gr.rotation.z = -t * 1.6;
      pile.position.y = Math.sin(t * 3) * 0.012;
    },
    setBlocked() { /* handled by board badges */ },
  };
}

export function buildMixer(quality: Quality): MachineView {
  const g = new THREE.Group();
  g.add(basePlate(1.12, 1.12));
  const lower = rbox(0.9, 0.42, 0.9, 0.14, enamel(PAL.cream, 0.42, 0.6)); lower.position.y = 0.3; g.add(lower);
  const band = cyl(0.47, 0.47, 0.07, enamel(PAL.orange, 0.38, 0.6)); band.position.y = 0.53; g.add(band);
  // badge
  const badgeRing = cyl(0.19, 0.19, 0.05, enamel(PAL.orange, 0.38)); badgeRing.rotation.x = Math.PI / 2; badgeRing.position.set(0, 0.28, 0.46); g.add(badgeRing);
  const label = new THREE.Mesh(new THREE.CircleGeometry(0.155, 32), new THREE.MeshStandardMaterial({ map: labelTexture('ORANGE', { w: 256, h: 256, bg: '#f9ecdb', fg: '#e8762a', size: 54, round: 128 }), roughness: 0.5 }));
  label.position.set(0, 0.28, 0.488); g.add(label);
  // clear glass chamber: thin reflective shell + two vertical glints, orange jelly inside
  const glass = cyl(0.36, 0.36, 0.5, new THREE.MeshPhysicalMaterial({
    color: '#ffffff', roughness: 0.02, metalness: 0, transparent: true, opacity: 0.16, clearcoat: 1, clearcoatRoughness: 0.02,
    envMapIntensity: 2.2, depthWrite: false, side: THREE.DoubleSide,
  }), 48);
  glass.position.y = 0.82; glass.castShadow = false; glass.renderOrder = 2; glass.userData.keep = true; g.add(glass);
  const glintMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
  for (const [a, w] of [[-0.55, 0.05], [-0.35, 0.025]] as [number, number][]) {
    const glint = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.42), glintMat);
    glint.position.set(Math.sin(a) * 0.365, 0.83, Math.cos(a) * 0.365); glint.rotation.y = a; glint.renderOrder = 3; glint.userData.keep = true; g.add(glint);
  }
  const liquid = cyl(0.31, 0.31, 0.3, new THREE.MeshPhysicalMaterial({
    color: '#ff8424', roughness: 0.15, transparent: true, opacity: 0.88, clearcoat: 1, emissive: new THREE.Color('#ff6a00'), emissiveIntensity: 0.35,
  }), 40);
  liquid.position.y = 0.7; liquid.renderOrder = 1; liquid.userData.keep = true; g.add(liquid);
  void quality;
  const paddle = new THREE.Group();
  const shaft = cyl(0.03, 0.03, 0.46, enamel(PAL.ivory)); shaft.position.y = 0.0; paddle.add(shaft);
  for (let i = 0; i < 3; i++) { const b = rbox(0.5, 0.05, 0.08, 0.02, enamel(PAL.ivory)); b.rotation.y = (i * Math.PI) / 3; b.position.y = -0.12; paddle.add(b); }
  paddle.position.y = 0.82; paddle.userData.keep = true; g.add(paddle);
  const rimLow = cyl(0.4, 0.42, 0.06, enamel(PAL.ivory)); rimLow.position.y = 0.58; g.add(rimLow);
  const cap = cyl(0.4, 0.4, 0.1, enamel(PAL.cream, 0.4)); cap.position.y = 1.1; g.add(cap);
  const funnel = lathe([[0.1, 0], [0.13, 0.05], [0.36, 0.34], [0.4, 0.38], [0.38, 0.4], [0.33, 0.37], [0.11, 0.08]], enamel(PAL.orange, 0.35, 0.7));
  funnel.position.y = 1.14; funnel.userData.keep = true; g.add(funnel);
  // side crank
  const knob = cyl(0.09, 0.09, 0.1, enamel(PAL.orange)); knob.rotation.z = Math.PI / 2; knob.position.set(0.47, 0.9, 0); g.add(knob);
  const knobHub = cyl(0.05, 0.05, 0.08, enamel(PAL.ivory)); knobHub.rotation.z = Math.PI / 2; knobHub.position.set(0.42, 0.9, 0); g.add(knobHub);
  g.add(screw(-0.35, 0.42, 0.455), screw(0.35, 0.42, 0.455));
  let spin = 0;
  return {
    group: g,
    update(state, _t, frac) {
      if (state === 'processing') spin += 0.22;
      paddle.rotation.y = spin;
      const level = state === 'processing' ? 0.55 + 0.45 * Math.sin(frac * Math.PI) : state === 'awaiting' ? 0.4 : 0.3;
      liquid.scale.y = level; liquid.position.y = 0.6 + 0.15 * level;
      liquid.rotation.y = spin * 0.3;
      funnel.rotation.y = state === 'processing' ? Math.sin(spin * 0.5) * 0.04 : 0;
    },
    setBlocked() {},
  };
}

function archShape(w: number, h: number, r: number) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, h - r);
  s.quadraticCurveTo(w / 2, h, w / 2 - r, h); s.lineTo(-w / 2 + r, h);
  s.quadraticCurveTo(-w / 2, h, -w / 2, h - r); s.closePath();
  return s;
}

function tunnelHousing(w: number, h: number, depth: number, roundTop: number, mat: THREE.Material, capMat: THREE.Material | null) {
  // profile in X-Y with a belt tunnel along X: build as Z-Y profile extruded along X with a tunnel hole
  const g = new THREE.Group();
  const prof = archShape(depth, h, roundTop);
  const hole = new THREE.Path();
  const th = 0.36, tw = 0.62;
  hole.moveTo(-tw / 2, 0.08); hole.lineTo(-tw / 2, th - 0.08); hole.quadraticCurveTo(-tw / 2, th, -tw / 2 + 0.08, th);
  hole.lineTo(tw / 2 - 0.08, th); hole.quadraticCurveTo(tw / 2, th, tw / 2, th - 0.08); hole.lineTo(tw / 2, 0.08); hole.lineTo(-tw / 2, 0.08);
  prof.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(prof, { depth: w, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 3, curveSegments: 10 });
  geo.translate(0, 0, -w / 2);
  geo.rotateY(Math.PI / 2); // profile now lies in Z-Y, extruded along X
  const body = new THREE.Mesh(geo, mat); body.castShadow = true; body.receiveShadow = true; g.add(body);
  if (capMat) {
    for (const s of [-1, 1]) {
      const capProf = archShape(depth + 0.1, h + 0.06, roundTop + 0.04);
      capProf.holes.push(hole);
      const cg = new THREE.ExtrudeGeometry(capProf, { depth: 0.07, bevelEnabled: true, bevelSize: 0.025, bevelThickness: 0.025, bevelSegments: 3, curveSegments: 10 });
      cg.translate(0, 0, -0.035); cg.rotateY(Math.PI / 2);
      const cap = new THREE.Mesh(cg, capMat); cap.castShadow = true; cap.position.x = s * (w / 2 + 0.02); g.add(cap);
    }
  }
  const dark = rbox(w + 0.04, 0.24, 0.58, 0.05, matte('#3d302b', 0.95)); dark.position.y = 0.25; g.add(dark);
  return g;
}

export function buildStarPress(quality: Quality): MachineView {
  const g = new THREE.Group();
  g.add(basePlate(1.16, 1.06));
  // wide cream arch with butter-yellow side frames (reference silhouette)
  const housing = tunnelHousing(0.9, 0.98, 0.9, 0.42, enamel(PAL.cream, 0.42, 0.6), enamel(PAL.yellow, 0.38, 0.6));
  housing.position.y = 0.1; g.add(housing);
  // star window on the front face (+Z)
  const frame = new THREE.Mesh(new THREE.ExtrudeGeometry(starShape(0.33, 0.17), { depth: 0.04, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.02, bevelSegments: 3 }), enamel(PAL.yellow, 0.35, 0.7));
  frame.position.set(0, 0.62, 0.47); g.add(frame);
  const win = new THREE.Mesh(new THREE.ExtrudeGeometry(starShape(0.27, 0.135), { depth: 0.05, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 2 }), new THREE.MeshPhysicalMaterial({
    color: '#f5a034', roughness: 0.15, clearcoat: 1, emissive: new THREE.Color('#f08a1a'), emissiveIntensity: 0.45,
  }));
  win.position.set(0, 0.62, 0.48); g.add(win);
  // top press: pedestal + cream button; a rigid ram drops inside the tunnel while processing
  const pedestal = rbox(0.46, 0.1, 0.42, 0.04, enamel(PAL.yellow, 0.4)); pedestal.position.y = 1.12; g.add(pedestal);
  const pedTop = rbox(0.36, 0.08, 0.34, 0.03, enamel('#d9d4cb', 0.4)); pedTop.position.y = 1.2; g.add(pedTop);
  const button = cyl(0.15, 0.16, 0.18, enamel(PAL.ivory, 0.35, 0.7)); button.position.y = 1.31; button.userData.keep = true; g.add(button);
  const ram = rbox(0.5, 0.06, 0.4, 0.02, metal('#cfcac2', 0.3)); ram.position.y = 0.44; ram.userData.keep = true; g.add(ram);
  g.add(screw(-0.36, 0.2, 0.47), screw(0.36, 0.2, 0.47), screw(-0.3, 0.98, 0.42), screw(0.3, 0.98, 0.42));
  return {
    group: g,
    update(state, _t, frac) {
      const press = state === 'processing' ? Math.max(0, Math.sin(Math.min(1, frac) * Math.PI)) : 0;
      button.position.y = 1.31 - press * 0.1;
      ram.position.y = 0.44 - press * 0.14;
      (win.material as THREE.MeshPhysicalMaterial).emissiveIntensity = 0.45 + press * 0.9 + (state === 'completed' ? 0.6 : 0);
    },
    setBlocked() {},
  };
}

let FROST: THREE.Texture | null = null;
/** Icy colour map: blue body with white frost streaks, cracks and a bright rim near the top. */
function frostTexture() {
  if (FROST) return FROST;
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#e9f6fd'); grd.addColorStop(0.18, '#a9d6f2'); grd.addColorStop(1, '#6eaee0');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.globalAlpha = 0.5; g.strokeStyle = '#ffffff';
  for (let i = 0; i < 22; i++) {
    g.lineWidth = 0.8 + rnd() * 2.2; g.beginPath();
    let x = rnd() * 256, y = rnd() * 256; g.moveTo(x, y);
    for (let k = 0; k < 4; k++) { x += (rnd() - 0.5) * 70; y += rnd() * 50; g.lineTo(x, y); }
    g.stroke();
  }
  g.globalAlpha = 0.35; g.fillStyle = '#ffffff';
  for (let i = 0; i < 60; i++) { g.beginPath(); g.arc(rnd() * 256, rnd() * 256, 1 + rnd() * 5, 0, 7); g.fill(); }
  FROST = new THREE.CanvasTexture(c); FROST.colorSpace = THREE.SRGBColorSpace;
  return FROST;
}

export function buildCooler(quality: Quality): MachineView {
  const g = new THREE.Group();
  g.add(basePlate(1.12, 1.08));
  const base = rbox(0.92, 0.48, 0.92, 0.12, enamel('#5b8fca', 0.42, 0.6)); base.position.y = 0.32; g.add(base);
  const trim = rbox(0.96, 0.08, 0.96, 0.04, enamel('#3f73b0', 0.4)); trim.position.y = 0.58; g.add(trim);
  g.add(panel(0.2, 0.3, '#78a7dc', -0.3, 0.33, 0.47), panel(0.2, 0.3, '#78a7dc', 0.3, 0.33, 0.47));
  const plate = rbox(0.3, 0.3, 0.03, 0.05, enamel('#5bb1c8', 0.4, 0.8)); plate.position.set(0, 0.33, 0.47); g.add(plate);
  const flake = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), new THREE.MeshStandardMaterial({ map: snowflakeTexture(), transparent: true, roughness: 0.5 }));
  flake.position.set(0, 0.33, 0.488); g.add(flake);
  const collar = cyl(0.46, 0.46, 0.1, enamel('#3f73b0', 0.35, 0.8), 6); collar.rotation.y = Math.PI / 6; collar.position.y = 0.67; g.add(collar);
  for (const sx of [-1, 1]) { const fin = rbox(0.07, 0.42, 0.16, 0.03, enamel('#5a8ecb', 0.38, 0.8)); fin.position.set(sx * 0.43, 0.95, 0); g.add(fin); }
  // icy hexagonal chamber
  const ice = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.62, 6), new THREE.MeshPhysicalMaterial({
    map: frostTexture(), color: '#ffffff', roughness: 0.18, transmission: quality === 'high' ? 0.35 : 0, transparent: quality !== 'high', opacity: 0.92,
    thickness: 0.8, clearcoat: 1, clearcoatRoughness: 0.15, emissive: new THREE.Color('#7fb8e0'), emissiveIntensity: 0.12,
    attenuationColor: new THREE.Color('#6fb0e0'), attenuationDistance: 0.6,
  }));
  ice.position.y = 0.95; ice.rotation.y = Math.PI / 6; ice.castShadow = true; g.add(ice);
  const iceTop = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.4, 0.06, 6), new THREE.MeshStandardMaterial({ color: '#c4e2f4', roughness: 0.4 }));
  iceTop.position.y = 1.28; iceTop.rotation.y = Math.PI / 6; g.add(iceTop);
  const flake2 = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), new THREE.MeshBasicMaterial({ map: snowflakeTexture('#ffffff'), transparent: true, opacity: 0.85, depthWrite: false }));
  flake2.position.set(0, 0.95, 0.35); g.add(flake2);
  const inner = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), gummy(PAL.candyBlue, quality));
  inner.position.y = 0.9; inner.visible = false; inner.userData.keep = true; g.add(inner);
  // frost puffs
  const puffs: THREE.Mesh[] = [];
  const puffMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.0, depthWrite: false });
  for (let i = 0; i < 5; i++) { const p = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), puffMat); p.userData.keep = true; g.add(p); puffs.push(p); }
  return {
    group: g,
    update(state, t, frac) {
      const on = state === 'processing';
      inner.visible = on;
      puffMat.opacity = on ? 0.5 : 0;
      puffs.forEach((p, i) => {
        const k = (t * 0.7 + i / 5) % 1;
        p.position.set(Math.cos(i * 2.3) * 0.3, 1.3 + k * 0.35, Math.sin(i * 2.3) * 0.3);
        p.scale.setScalar(0.6 + k);
      });
      (ice.material as THREE.MeshPhysicalMaterial).emissiveIntensity = on ? 0.2 + 0.2 * Math.sin(frac * Math.PI) : 0.12;
    },
    setBlocked() {},
  };
}

export function buildCubePress(quality: Quality): MachineView {
  const g = new THREE.Group();
  g.add(basePlate(1.12, 1.06));
  const housing = tunnelHousing(0.92, 0.9, 0.84, 0.32, enamel(PAL.cream, 0.4, 0.75), null);
  housing.position.y = 0.12; g.add(housing);
  const frame = rbox(0.62, 0.56, 0.07, 0.1, enamel(PAL.navy, 0.35, 0.8)); frame.position.set(0, 0.6, 0.45); g.add(frame);
  const recess = rbox(0.44, 0.38, 0.04, 0.06, matte('#13365f', 0.6)); recess.position.set(0, 0.6, 0.48); g.add(recess);
  const cube = rbox(0.24, 0.24, 0.24, 0.05, gummy('#2f86e0', quality)); cube.position.set(0, 0.6, 0.52); cube.rotation.set(0.5, 0.55, 0.12); cube.userData.keep = true; g.add(cube);
  for (const sx of [-1, 1]) { const tab = rbox(0.06, 0.2, 0.18, 0.025, enamel('#3f7fc4', 0.38, 0.8)); tab.position.set(sx * 0.49, 0.62, 0); g.add(tab); }
  const collar = rbox(0.38, 0.08, 0.38, 0.035, enamel(PAL.navy, 0.35, 0.8)); collar.position.y = 1.05; g.add(collar);
  const button = rbox(0.27, 0.2, 0.27, 0.07, gummy('#3f8fe6', quality)); button.position.y = 1.17; button.userData.keep = true; g.add(button);
  g.add(screw(-0.36, 0.22, 0.43), screw(0.36, 0.22, 0.43));
  return {
    group: g,
    update(state, t, frac) {
      const press = state === 'processing' ? Math.max(0, Math.sin(Math.min(1, frac) * Math.PI)) : 0;
      button.position.y = 1.17 - press * 0.09;
      cube.rotation.y = 0.55 + Math.sin(t * 1.2) * 0.2;
    },
    setBlocked() {},
  };
}

export function buildBin(accepts: { color: string; shape: string }, label: string): MachineView {
  const g = new THREE.Group();
  const isBlue = accepts.color === 'blue';
  const col = isBlue ? '#4a86d0' : '#f08a3c';
  const rim = isBlue ? '#7fb0e6' : '#f9b27a';
  g.add(basePlate(1.12, 1.1));
  const W = 0.98, D = 0.9, H = 0.5, T = 0.07;
  const mat = enamel(col, 0.4, 0.6);
  const floor = rbox(W, 0.08, D, 0.03, mat); floor.position.y = 0.14; g.add(floor);
  const walls: [number, number, number, number, number][] = [
    [0, 0, D / 2 - T / 2, W, T], [0, 0, -D / 2 + T / 2, W, T],
  ];
  for (const [x, , z, w, d] of walls) { const m = rbox(w, H, d, 0.03, mat); m.position.set(x, 0.1 + H / 2, z); g.add(m); }
  for (const s of [-1, 1]) { const m = rbox(T, H, D, 0.03, mat); m.position.set(s * (W / 2 - T / 2), 0.1 + H / 2, 0); g.add(m); }
  const lip = new THREE.Mesh(new THREE.TorusGeometry(1, 0.03, 8, 4), enamel(rim)); void lip;
  for (const s of [-1, 1]) {
    const a = rbox(W + 0.02, 0.05, T + 0.03, 0.02, enamel(rim, 0.4)); a.position.set(0, 0.1 + H, s * (D / 2 - T / 2)); g.add(a);
    const b = rbox(T + 0.03, 0.05, D + 0.02, 0.02, enamel(rim, 0.4)); b.position.set(s * (W / 2 - T / 2), 0.1 + H, 0); g.add(b);
  }
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.24), new THREE.MeshStandardMaterial({
    map: labelTexture(label, { w: 512, h: 170, bg: isBlue ? '#3a74bd' : '#e8792e', fg: '#ffffff', size: label.includes('\n') ? 56 : 62, round: 24, border: rim }), roughness: 0.5,
  }));
  plate.position.set(0, 0.32, D / 2 + 0.005); g.add(plate);
  const slots: THREE.Vector3[] = [];
  for (let layer = 0; layer < 3; layer++) for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
    slots.push(new THREE.Vector3(-0.3 + i * 0.2 + (layer % 2) * 0.08, 0.28 + layer * 0.13, -0.22 + j * 0.22 + (layer % 2) * 0.06));
  }
  if (!isBlue) {
    // reference hood: cream arch with a coral roof and a star emblem behind the star bin
    const back = rbox(1.0, 0.62, 0.3, 0.1, enamel(PAL.cream, 0.42, 0.6)); back.position.set(0, 0.86, -0.36); g.add(back);
    const roof = rbox(1.1, 0.18, 0.5, 0.08, enamel(PAL.coral, 0.4, 0.7)); roof.position.set(0, 1.22, -0.3); g.add(roof);
    const emb = new THREE.Mesh(new THREE.ExtrudeGeometry(starShape(0.17, 0.085), { depth: 0.04, bevelEnabled: true, bevelSize: 0.025, bevelThickness: 0.02, bevelSegments: 3 }), enamel(PAL.yellow, 0.3, 0.8));
    emb.rotation.x = -Math.PI / 2; emb.position.set(0, 1.32, -0.28); g.add(emb);
    for (const sx of [-1, 1]) g.add(screw(sx * 0.4, 0.75, -0.205));
  }
  const contents = new THREE.Group(); contents.userData.keep = true; g.add(contents);
  let bounce = 0;
  return {
    group: g,
    update(_s, _t) { bounce = Math.max(0, bounce - 0.05); contents.scale.setScalar(1 + bounce * 0.06); },
    setBlocked() {},
    bin: {
      slots,
      contents,
      addCandy(m) { contents.add(m); bounce = 1; },
    },
  };
}

// ---------- candy ----------
export type CandyKind = 'red' | 'yellow' | 'orange' | 'orange-star' | 'blue' | 'blue-cool' | 'blue-cube';
export function candyKind(c: { color: string; shape: string; temp: string }): CandyKind {
  if (c.shape === 'star') return 'orange-star';
  if (c.shape === 'cube') return 'blue-cube';
  if (c.color === 'blue') return c.temp === 'cooled' ? 'blue-cool' : 'blue';
  return c.color as CandyKind;
}

export function candyGeometry(kind: CandyKind): THREE.BufferGeometry {
  switch (kind) {
    case 'red':
    case 'orange': {
      const g = new THREE.CapsuleGeometry(0.115, 0.17, 6, 14);
      g.rotateZ(Math.PI / 2); g.scale(1, 0.85, 1); g.translate(0, 0.1, 0);
      return g;
    }
    case 'yellow':
    case 'blue':
    case 'blue-cool': {
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i <= 12; i++) {
        const a = (i / 12) * Math.PI / 2;
        pts.push(new THREE.Vector2(Math.cos(a) * 0.16, Math.sin(a) * 0.2 + 0.04));
      }
      pts.unshift(new THREE.Vector2(0.15, 0.0), new THREE.Vector2(0.165, 0.03));
      pts.unshift(new THREE.Vector2(0, 0));
      const g = new THREE.LatheGeometry(pts, 24);
      return g;
    }
    case 'orange-star': {
      const g = new THREE.ExtrudeGeometry(starShape(0.21, 0.1), { depth: 0.07, bevelEnabled: true, bevelSize: 0.045, bevelThickness: 0.05, bevelSegments: 4 });
      g.rotateX(-Math.PI / 2); g.translate(0, 0.05, 0);
      return g;
    }
    case 'blue-cube': {
      const g = new RoundedBoxGeometry(0.28, 0.26, 0.28, 3, 0.06);
      g.translate(0, 0.13, 0);
      return g;
    }
  }
}

export function candyMaterial(kind: CandyKind, q: Quality) {
  switch (kind) {
    case 'red': return gummy(PAL.red, q);
    case 'yellow': return gummy(PAL.lemon, q);
    case 'orange': return gummy('#ff6f0a', q);
    case 'orange-star': return gummy('#ff6a05', q);
    case 'blue': return gummy(PAL.candyBlue, q);
    case 'blue-cool': return gummy('#5aa8f0', q, { frost: true });
    case 'blue-cube': return gummy('#2a84e6', q);
  }
}
