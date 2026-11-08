// Jointed armored glove rig. Joint hierarchy: wrist → palm → 4 fingers (MCP, PIP, DIP) + thumb (CMC, MCP, IP).
// Local frame: fingers point -Z, back of hand +Y, forearm +Z. side = 1 right hand, -1 left hand.
// Poses are plain joint-angle data so actions can be blended continuously from gameplay state.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export const gloveMats = {
  rubber: new THREE.MeshPhysicalMaterial({ color: '#2d6fd0', roughness: 0.38, metalness: 0.0, clearcoat: 0.55, clearcoatRoughness: 0.28, sheen: 0.35, sheenColor: new THREE.Color('#8fc2ff') }),
  plate: new THREE.MeshPhysicalMaterial({ color: '#1d4fa6', roughness: 0.22, metalness: 0.15, clearcoat: 1.0, clearcoatRoughness: 0.12 }),
  knuckle: new THREE.MeshPhysicalMaterial({ color: '#173f86', roughness: 0.3, metalness: 0.2, clearcoat: 0.8 }),
  cuff: new THREE.MeshPhysicalMaterial({ color: '#23272f', roughness: 0.35, metalness: 0.45, clearcoat: 0.6 }),
  armor: new THREE.MeshPhysicalMaterial({ color: '#f2ece4', roughness: 0.26, metalness: 0.0, clearcoat: 0.9, clearcoatRoughness: 0.15 }),
  orange: new THREE.MeshPhysicalMaterial({ color: '#f26c1c', roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.2 }),
  palm: new THREE.MeshPhysicalMaterial({ color: '#25406e', roughness: 0.55, sheen: 0.5, sheenColor: new THREE.Color('#5f86c9') }),
};

export interface HandPose {
  /** per finger (index, middle, ring, pinky): [mcp, pip, dip] flexion in radians (positive curls toward palm) */
  f: [number, number, number][];
  spread: number;
  /** thumb: [cmcFlex, cmcSwing, mcp, ip] */
  t: [number, number, number, number];
  /** wrist: flex (x), deviation (y), roll (z) */
  w: [number, number, number];
}

const P = (f: number[][], spread: number, t: number[], w: number[] = [0, 0, 0]): HandPose => ({ f: f as HandPose['f'], spread, t: t as HandPose['t'], w: w as HandPose['w'] });
export const POSES = {
  relaxed: P([[0.35, 0.45, 0.25], [0.4, 0.5, 0.3], [0.45, 0.55, 0.3], [0.5, 0.6, 0.35]], 0.04, [0.2, 0.3, 0.2, 0.15]),
  /** right hand on the grip, index finger resting on the trigger guard */
  grip: P([[0.55, 0.85, 0.45], [1.35, 1.45, 0.9], [1.4, 1.45, 0.95], [1.45, 1.4, 0.95]], 0.0, [0.55, 0.75, 0.45, 0.35]),
  /** trigger squeezed */
  gripFire: P([[0.85, 1.25, 0.7], [1.38, 1.5, 0.92], [1.42, 1.5, 0.95], [1.47, 1.45, 0.95]], 0.0, [0.55, 0.75, 0.45, 0.35]),
  /** right thumb pushes the cell release */
  gripRelease: P([[0.55, 0.85, 0.45], [1.35, 1.45, 0.9], [1.4, 1.45, 0.95], [1.45, 1.4, 0.95]], 0.0, [-0.1, 0.2, 0.05, 0.0]),
  /** left hand cradling the fore-end from below */
  support: P([[0.95, 0.95, 0.55], [1.0, 1.0, 0.6], [1.05, 1.05, 0.6], [1.1, 1.05, 0.6]], 0.03, [0.35, 0.95, 0.3, 0.25]),
  /** left hand pinching a fresh energy cell */
  pinch: P([[0.75, 0.75, 0.35], [0.95, 1.2, 0.7], [1.2, 1.35, 0.8], [1.3, 1.4, 0.85]], 0.02, [0.55, 0.9, 0.35, 0.25]),
  /** flat palm used to slap the latch closed */
  slap: P([[0.1, 0.15, 0.08], [0.1, 0.15, 0.08], [0.12, 0.18, 0.1], [0.15, 0.2, 0.1]], 0.05, [0.1, 0.4, 0.1, 0.05]),
  /** open barrier palm, fingers splayed */
  shield: P([[-0.08, 0.05, 0.05], [-0.06, 0.04, 0.04], [-0.04, 0.06, 0.05], [0.0, 0.08, 0.06]], 0.2, [-0.15, -0.35, 0.05, 0.05], [-0.1, 0, 0]),
} satisfies Record<string, HandPose>;

export function blendPose(a: HandPose, b: HandPose, k: number, out?: HandPose): HandPose {
  const l = (x: number, y: number) => x + (y - x) * k;
  const o = out ?? P([[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], 0, [0, 0, 0, 0]);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) o.f[i][j] = l(a.f[i][j], b.f[i][j]);
  o.spread = l(a.spread, b.spread);
  for (let j = 0; j < 4; j++) o.t[j] = l(a.t[j], b.t[j]);
  for (let j = 0; j < 3; j++) o.w[j] = l(a.w[j], b.w[j]);
  return o;
}

interface FingerJoints { mcp: THREE.Group; pip: THREE.Group; dip: THREE.Group; baseYaw: number }

const segGeo = (len: number, r: number) => { const g = new THREE.CapsuleGeometry(r, len, 4, 10); g.rotateX(Math.PI / 2); g.translate(0, 0, -len / 2); return g; };
const plateGeo = (len: number, w: number) => { const g = new RoundedBoxGeometry(w, 0.009, len, 2, 0.004); g.translate(0, 0, -len / 2); return g; };

export class HandRig {
  root = new THREE.Group();   // place/orient this (forearm)
  wrist = new THREE.Group();  // pose-driven wrist joint
  palm = new THREE.Group();
  fingers: FingerJoints[] = [];
  thumb: { cmc: THREE.Group; mcp: THREE.Group; ip: THREE.Group };
  /** attach held items here (between thumb and index) */
  holdSocket = new THREE.Object3D();
  private cur: HandPose = blendPose(POSES.relaxed, POSES.relaxed, 0);

  constructor(public side: 1 | -1) {
    const M = gloveMats;
    // forearm gauntlet (extends +Z toward the elbow, mostly off-screen)
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.056, 0.36, 20), M.rubber); arm.rotation.x = Math.PI / 2; arm.position.z = 0.24; this.root.add(arm);
    const gaunt = new THREE.Mesh(new RoundedBoxGeometry(0.094, 0.06, 0.22, 3, 0.024), M.armor); gaunt.position.set(0, 0.03, 0.25); this.root.add(gaunt);
    const stripe = new THREE.Mesh(new RoundedBoxGeometry(0.097, 0.062, 0.02, 2, 0.008), M.orange); stripe.position.set(0, 0.03, 0.17); this.root.add(stripe);
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.066, 20, 14), M.armor); elbow.position.set(0, 0.01, 0.43); this.root.add(elbow);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.05, 0.045, 20), M.cuff); cuff.rotation.x = Math.PI / 2; cuff.position.z = 0.055; this.root.add(cuff);
    const cuffRing = new THREE.Mesh(new THREE.TorusGeometry(0.048, 0.006, 8, 24), M.orange); cuffRing.position.z = 0.035; this.root.add(cuffRing);
    this.root.add(this.wrist);
    this.wrist.add(this.palm);
    // palm block: padded back, darker grip pad underneath
    const palmBody = new THREE.Mesh(new RoundedBoxGeometry(0.088, 0.042, 0.096, 3, 0.017), M.rubber); palmBody.position.z = -0.045; this.palm.add(palmBody);
    const pad = new THREE.Mesh(new RoundedBoxGeometry(0.078, 0.012, 0.08, 2, 0.005), M.palm); pad.position.set(0, -0.021, -0.045); this.palm.add(pad);
    const back = new THREE.Mesh(new RoundedBoxGeometry(0.078, 0.014, 0.07, 2, 0.006), M.plate); back.position.set(0, 0.024, -0.05); back.rotation.x = 0.06; this.palm.add(back);
    const backStripe = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.004, 0.012, 1, 0.002), M.orange); backStripe.position.set(0, 0.032, -0.03); this.palm.add(backStripe);
    const knuckleBar = new THREE.Mesh(new RoundedBoxGeometry(0.086, 0.018, 0.02, 2, 0.008), M.knuckle); knuckleBar.position.set(0, 0.016, -0.09); this.palm.add(knuckleBar);
    // fingers: index..pinky from the thumb side outward
    const lens = [[0.03, 0.022, 0.018], [0.033, 0.024, 0.019], [0.031, 0.022, 0.018], [0.025, 0.018, 0.015]];
    const rad = [0.0115, 0.012, 0.0112, 0.0098];
    for (let i = 0; i < 4; i++) {
      const x = -side * (0.03 - i * 0.02);
      const mcp = new THREE.Group(); mcp.position.set(x, 0.003, -0.094 + Math.abs(i - 1.4) * 0.003);
      const baseYaw = side * (i - 1.5) * -0.04;
      mcp.rotation.y = baseYaw;
      const pip = new THREE.Group(); pip.position.z = -lens[i][0];
      const dip = new THREE.Group(); dip.position.z = -lens[i][1];
      mcp.add(new THREE.Mesh(segGeo(lens[i][0], rad[i]), M.rubber), pip);
      pip.add(new THREE.Mesh(segGeo(lens[i][1], rad[i] * 0.95), M.rubber), dip);
      const tip = new THREE.Mesh(segGeo(lens[i][2], rad[i] * 0.9), M.rubber); dip.add(tip);
      // armor plates on the back of each phalanx
      [[mcp, lens[i][0]], [pip, lens[i][1]], [dip, lens[i][2]]].forEach(([g, len], k) => {
        const pl = new THREE.Mesh(plateGeo((len as number) * 0.8, rad[i] * 1.55), k === 0 ? M.knuckle : M.plate);
        pl.position.set(0, rad[i] * 0.95, -(len as number) * 0.1); (g as THREE.Group).add(pl);
      });
      this.palm.add(mcp);
      this.fingers.push({ mcp, pip, dip, baseYaw });
    }
    // thumb from the palm side
    const cmc = new THREE.Group(); cmc.rotation.order = 'YXZ'; cmc.position.set(-side * 0.04, -0.008, -0.03);
    const tmcp = new THREE.Group(); tmcp.position.z = -0.03;
    const tip = new THREE.Group(); tip.position.z = -0.024;
    cmc.add(new THREE.Mesh(segGeo(0.03, 0.0145), M.rubber), tmcp);
    tmcp.add(new THREE.Mesh(segGeo(0.024, 0.0132), M.rubber), tip);
    tip.add(new THREE.Mesh(segGeo(0.02, 0.012), M.rubber));
    const tplate = new THREE.Mesh(plateGeo(0.02, 0.019), M.plate); tplate.position.set(0, 0.012, -0.002); tmcp.add(tplate);
    this.palm.add(cmc);
    this.thumb = { cmc, mcp: tmcp, ip: tip };
    this.holdSocket.position.set(-side * 0.03, -0.03, -0.1);
    this.palm.add(this.holdSocket);
    this.root.traverse((o) => { (o as THREE.Mesh).castShadow = false; });
  }

  /** Smoothly approach a target pose (critically damped-ish per frame). */
  drive(target: HandPose, dt: number, rate = 18) {
    const k = 1 - Math.exp(-rate * dt);
    blendPose(this.cur, target, k, this.cur);
    this.apply(this.cur);
  }

  apply(p: HandPose) {
    const s = this.side;
    this.fingers.forEach((f, i) => {
      // positive flexion curls toward the palm (-Y), i.e. a negative rotation about local X
      f.mcp.rotation.x = -p.f[i][0];
      f.pip.rotation.x = -p.f[i][1];
      f.dip.rotation.x = -p.f[i][2];
      f.mcp.rotation.y = f.baseYaw + s * (i - 1.5) * -p.spread;
    });
    // thumb: swing across the palm (y), flex down (x)
    this.thumb.cmc.rotation.set(-(0.3 + p.t[0]), s * (0.8 - p.t[1]), s * -0.45);
    this.thumb.mcp.rotation.x = -p.t[2];
    this.thumb.ip.rotation.x = -p.t[3];
    this.wrist.rotation.set(p.w[0], s * p.w[1], s * p.w[2]);
  }
}

// ---------------------------------------------------------------------------------------------
// Sculpted hands: one fal-generated mesh per pose (glove + armored forearm), aligned into the same
// local frame as HandRig (fingers -Z, back of hand +Y, forearm +Z, wrist at the origin).
// Poses swap with a short squash so changes read as quick hand motions rather than pops.

export interface HandAlign { pos: number[]; quat: number[]; scale: number; mirror?: boolean; stub?: number; fix?: number[] }

export class MeshHand {
  root = new THREE.Group();
  holdSocket = new THREE.Object3D();
  private poses = new Map<string, THREE.Group>();
  private current = '';
  private pulse = 0;

  constructor(defs: Record<string, { scene: THREE.Object3D; align: HandAlign }>) {
    for (const [name, d] of Object.entries(defs)) {
      const g = new THREE.Group();
      const inner = new THREE.Group();
      // mirror happens in mesh space (x -> -x) before the rotation, matching the analyzer
      const mirrorWrap = new THREE.Group(); mirrorWrap.add(d.scene); mirrorWrap.scale.set(d.align.mirror ? -1 : 1, 1, 1);
      inner.add(mirrorWrap);
      inner.quaternion.fromArray(d.align.quat);
      inner.scale.setScalar(d.align.scale);
      inner.position.fromArray(d.align.pos);
      const fixG = new THREE.Group(); fixG.add(inner);
      if (d.align.fix) fixG.rotation.set(d.align.fix[0], d.align.fix[1], d.align.fix[2]);
      g.add(fixG);
      // armored sleeve continuing past the generated forearm stub so arms leave the frame cleanly
      const stub = d.align.stub ?? 0.1;
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.064, 0.42, 24, 1, true), gloveMats.armor); sleeve.rotation.x = Math.PI / 2; sleeve.position.z = stub + 0.2; g.add(sleeve);
      const under = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.058, 0.44, 20), gloveMats.rubber); under.rotation.x = Math.PI / 2; under.position.set(0, -0.006, stub + 0.21); g.add(under);
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.059, 0.006, 8, 28), gloveMats.orange); band.position.z = stub + 0.08; g.add(band);
      const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.07, 20, 14), gloveMats.armor); elbow.position.z = stub + 0.42; g.add(elbow);
      d.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const src = m.material as THREE.MeshStandardMaterial;
        const mat = new THREE.MeshPhysicalMaterial({ map: src.map, roughness: 0.36, metalness: 0.02, clearcoat: 0.65, clearcoatRoughness: 0.2, sheen: 0.25, sheenColor: new THREE.Color('#9cc6ff') });
        if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
        m.material = mat; src.dispose();
        m.castShadow = false;
      });
      g.visible = false;
      this.root.add(g);
      this.poses.set(name, g);
    }
    this.root.add(this.holdSocket);
  }

  setPose(name: string) {
    if (name === this.current || !this.poses.has(name)) return;
    if (this.current) this.poses.get(this.current)!.visible = false;
    this.poses.get(name)!.visible = true;
    if (this.current) this.pulse = 1;
    this.current = name;
  }

  update(dt: number, squeeze = 0) {
    this.pulse = Math.max(0, this.pulse - dt * 9);
    const s = 1 - this.pulse * 0.07;
    for (const g of this.poses.values()) { g.scale.setScalar(s); g.rotation.x = -squeeze * 0.06; }
  }
}
