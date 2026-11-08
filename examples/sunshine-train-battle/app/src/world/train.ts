// Decorative train meshes. Collision lives in game/level.ts; this file only draws.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CARS, HALF_L, HALF_W, JUMP_GAP_AFTER, LOCO_END, LOCO_ROOF_END, LOCO_Z0, ROOF_Y, WALKWAY_X0, WALKWAY_X1, WALKWAY_Y, carEnd, carStart, ENGINE_TRIGGER } from '../game/level';
import { gateFieldTexture, landingTexture, Mats } from './materials';

class Batcher {
  private groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(geo: THREE.BufferGeometry, mat: THREE.Material, pos: THREE.Vector3Like, rot?: THREE.Euler, scale?: THREE.Vector3Like) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(pos.x, pos.y, pos.z), new THREE.Quaternion().setFromEuler(rot ?? new THREE.Euler()), new THREE.Vector3(scale?.x ?? 1, scale?.y ?? 1, scale?.z ?? 1));
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(m);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const list = this.groups.get(mat) ?? [];
    list.push(g); this.groups.set(mat, list);
  }
  build(parent: THREE.Object3D, shadows = true) {
    for (const [mat, list] of this.groups) {
      const merged = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = shadows; mesh.receiveShadow = true;
      parent.add(mesh);
    }
    this.groups.clear();
  }
}

const UHANDLE = (() => {
  const pts = [new THREE.Vector3(0, -0.05, 0), new THREE.Vector3(0, 0.36, 0), new THREE.Vector3(0.06, 0.47, 0), new THREE.Vector3(0.18, 0.5, 0),
    new THREE.Vector3(0.72, 0.5, 0), new THREE.Vector3(0.84, 0.47, 0), new THREE.Vector3(0.9, 0.36, 0), new THREE.Vector3(0.9, -0.05, 0)];
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.2), 40, 0.045, 10, false);
})();

export interface TrainView { root: THREE.Group; gates: Map<number, THREE.Object3D>; wheels: THREE.InstancedMesh; beacon: THREE.Group; update(dt: number, t: number, cleared: boolean[]): void }

export function buildTrain(m: Mats): TrainView {
  const root = new THREE.Group();
  let B = new Batcher();
  let target: THREE.Object3D = root;
  const panelGeo = new RoundedBoxGeometry(2.12, 0.16, 2.82, 3, 0.065);
  const boltGeo = new THREE.CylinderGeometry(0.05, 0.055, 0.035, 10);
  const roofSlab = new RoundedBoxGeometry(4.7, 0.22, 12.0, 3, 0.09);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const rbox = new RoundedBoxGeometry(1, 1, 1, 2, 0.06);
  const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
  const wheelPositions: THREE.Vector3[] = [];

  const addBody = (z0: number, z1: number, windows: boolean) => {
    const len = z1 - z0, zc = (z0 + z1) / 2;
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.75, len), [windows ? m.sideWin : m.sidePlain, windows ? m.sideWin : m.sidePlain, m.blue, m.dark, m.blueDark, m.blueDark]);
    body.position.set(0, 0.45, zc); body.castShadow = true; body.receiveShadow = true; target.add(body);
    B.add(box, m.dark, { x: 0, y: -1.2, z: zc }, undefined, { x: 3.4, y: 0.55, z: len - 1.2 });
    for (const bz of [z0 + 2.2, z1 - 2.2]) {
      B.add(rbox, m.dark, { x: 0, y: -1.45, z: bz }, undefined, { x: 3.2, y: 0.5, z: 2.6 });
      for (const sx of [-1.25, 1.25]) for (const dz of [-0.75, 0.75]) wheelPositions.push(new THREE.Vector3(sx, -1.48, bz + dz));
    }
  };

  const addRoof = (z0: number, z1: number, idx: number) => {
    const zc = (z0 + z1) / 2, len = z1 - z0;
    B.add(roofSlab, m.blueDark, { x: 0, y: ROOF_Y - 0.2, z: zc }, undefined, { x: 1, y: 1, z: len / 12 });
    const rows = Math.round(len / 3);
    const pl = len / rows;
    for (let r = 0; r < rows; r++) for (const px of [-1.1, 1.1]) {
      const pz = z0 + pl * (r + 0.5);
      B.add(panelGeo, m.panel, { x: px, y: ROOF_Y - 0.08, z: pz }, undefined, { x: 1, y: 1, z: (pl - 0.12) / 2.84 });
      for (const bx of [-0.92, 0.92]) for (const bz of [-pl / 2 + 0.2, pl / 2 - 0.2]) B.add(boltGeo, m.bolt, { x: px + bx, y: ROOF_Y + 0.005, z: pz + bz });
    }
    // hazard steps at both ends
    for (const ez of [z0 + 0.22, z1 - 0.22]) {
      B.add(box, m.hazard, { x: 0, y: ROOF_Y + 0.0, z: ez }, undefined, { x: 4.2, y: 0.07, z: 0.3 });
    }
    // hazard band along the top of the body sides near the ends (reference look)
    for (const sx of [-2.215, 2.215]) for (const ez of [z0 + 1.4, z1 - 1.4]) B.add(box, m.hazard, { x: sx, y: 1.6, z: ez }, new THREE.Euler(0, Math.PI / 2, 0), { x: 2.2, y: 0.22, z: 0.02 });
    // orange U handles on both sides (match low guard volumes)
    for (const sx of [-HALF_W + 0.08, HALF_W - 0.08]) for (const hz of [z0 + 1.0, zc, z1 - 1.9]) {
      if (idx >= 0 && CARS[idx]?.hasSideRoute && sx < 0 && (hz < z0 + 1.7 || hz > z1 - 2.0)) continue;
      B.add(UHANDLE, m.orange, { x: sx, y: ROOF_Y, z: hz }, new THREE.Euler(0, -Math.PI / 2, 0));
    }
    // side lamps
    for (const sx of [-2.21, 2.21]) for (const ez of [z0 + 0.6, z1 - 0.6]) B.add(box, m.lamp, { x: sx, y: 1.25, z: ez }, undefined, { x: 0.04, y: 0.12, z: 0.22 });
  };

  CARS.forEach((car, i) => {
    const z0 = carStart(i), z1 = carEnd(i);
    addBody(z0, z1, i !== 0);
    addRoof(z0, z1, i);
    // covers
    car.covers.forEach((c) => {
      const cz = car.z + c.z;
      if (c.style === 'block') {
        B.add(rbox, m.blue, { x: c.x, y: ROOF_Y + c.h / 2, z: cz }, undefined, { x: c.w, y: c.h, z: c.l });
        B.add(box, m.hazard, { x: c.x, y: ROOF_Y + c.h - 0.18, z: cz }, undefined, { x: c.w + 0.02, y: 0.14, z: c.l + 0.02 });
        B.add(UHANDLE, m.orange, { x: c.x - 0.45, y: ROOF_Y + c.h, z: cz }, undefined, { x: 1, y: 0.5, z: 1 });
      } else if (c.style === 'ribbed') {
        B.add(rbox, m.blueDark, { x: c.x, y: ROOF_Y + c.h * 0.4, z: cz }, undefined, { x: c.w, y: c.h * 0.8, z: c.l });
        const n = 7;
        for (let k = 0; k < n; k++) B.add(rbox, m.blue, { x: c.x, y: ROOF_Y + c.h * 0.8 + 0.04, z: cz - c.l / 2 + (k + 0.5) * (c.l / n) }, undefined, { x: c.w * 0.92, y: 0.1 + c.h * 0.2, z: c.l / n * 0.6 });
      } else {
        B.add(rbox, m.blue, { x: c.x, y: ROOF_Y + c.h / 2, z: cz }, undefined, { x: c.w, y: c.h, z: c.l });
        B.add(box, m.dark, { x: c.x, y: ROOF_Y + c.h + 0.005, z: cz }, undefined, { x: c.w * 0.72, y: 0.02, z: c.l * 0.7 });
        for (let k = 0; k < 6; k++) B.add(box, m.steel, { x: c.x, y: ROOF_Y + c.h + 0.03, z: cz - c.l * 0.3 + k * (c.l * 0.6 / 5) }, undefined, { x: c.w * 0.68, y: 0.04, z: 0.06 });
        B.add(box, m.orange, { x: c.x, y: ROOF_Y + c.h * 0.55, z: cz + c.l / 2 + 0.01 }, undefined, { x: c.w * 0.8, y: 0.07, z: 0.02 });
        B.add(box, m.lamp, { x: c.x + c.w * 0.3, y: ROOF_Y + c.h * 0.3, z: cz + c.l / 2 + 0.012 }, undefined, { x: 0.12, y: 0.08, z: 0.02 });
      }
    });
    // couplings, bridges, gaps
    if (i < CARS.length - 1) {
      B.add(box, m.dark, { x: 0, y: -0.75, z: z1 + 0.6 }, undefined, { x: 0.7, y: 0.45, z: 1.6 });
      B.add(cyl, m.steel, { x: 0, y: -0.75, z: z1 + 0.6 }, new THREE.Euler(Math.PI / 2, 0, 0), { x: 0.32, y: 1.2, z: 0.32 });
      B.add(box, m.dark, { x: 0, y: 0.4, z: z1 + 0.6 }, undefined, { x: 3.2, y: 2.4, z: 1.2 }); // bellows
      for (let k = 0; k < 5; k++) B.add(box, m.seam, { x: 0, y: 0.4, z: z1 + 0.1 + k * 0.25 }, undefined, { x: 3.3, y: 2.5, z: 0.05 });
      if (i !== JUMP_GAP_AFTER) {
        B.add(box, m.dark, { x: 0, y: ROOF_Y - 0.2, z: z1 + 0.6 }, undefined, { x: 4.2, y: 0.4, z: 1.24 });
        for (let k = 0; k < 9; k++) B.add(box, m.steel, { x: -1.9 + k * 0.475, y: ROOF_Y + 0.004, z: z1 + 0.6 }, undefined, { x: 0.08, y: 0.02, z: 1.1 });
        for (const sx of [-2.05, 2.05]) B.add(box, m.hazard, { x: sx, y: ROOF_Y + 0.01, z: z1 + 0.6 }, new THREE.Euler(0, Math.PI / 2, 0), { x: 1.2, y: 0.03, z: 0.12 });
      } else {
        // open jump gap: drop the bellows so the coupling below is visible
      }
    }
    // gates on combat cars
    // side walkway with ladders down from roof edge
    if (car.hasSideRoute) {
      const wx = (WALKWAY_X0 + WALKWAY_X1) / 2, ww = WALKWAY_X1 - WALKWAY_X0;
      B.add(box, m.dark, { x: wx, y: WALKWAY_Y - 0.12, z: car.z }, undefined, { x: ww, y: 0.24, z: 11.2 });
      for (let k = 0; k < 22; k++) B.add(box, m.steel, { x: wx, y: WALKWAY_Y + 0.002, z: car.z - 5.4 + k * 0.5 }, undefined, { x: ww * 0.9, y: 0.02, z: 0.06 });
      for (let k = 0; k <= 8; k++) B.add(cyl, m.orange, { x: WALKWAY_X0 - 0.07, y: WALKWAY_Y + 0.5, z: car.z - 5.4 + k * 1.35 }, undefined, { x: 0.08, y: 1.0, z: 0.08 });
      B.add(cyl, m.orange, { x: WALKWAY_X0 - 0.07, y: WALKWAY_Y + 1.0, z: car.z }, new THREE.Euler(Math.PI / 2, 0, 0), { x: 0.1, y: 10.9, z: 0.1 });
      B.add(cyl, m.orange, { x: WALKWAY_X0 - 0.07, y: WALKWAY_Y + 0.55, z: car.z }, new THREE.Euler(Math.PI / 2, 0, 0), { x: 0.07, y: 10.9, z: 0.07 });
      for (const zc of [z0 + 1.1, z1 - 1.1]) {
        B.add(rbox, m.blueDark, { x: -2.55, y: WALKWAY_Y + 0.175, z: zc }, undefined, { x: 0.5, y: 0.35, z: 1.0 });
        B.add(box, m.hazard, { x: -2.55, y: WALKWAY_Y + 0.355, z: zc }, undefined, { x: 0.5, y: 0.02, z: 1.0 });
      }
    }
    if (car.hasLadder) addLadder(B, m, i === 0 ? { x: 0.9, z: z0 - 0.08, rotY: 0 } : { x: -2.38, z: z0 + 3.0, rotY: Math.PI / 2 });
  });
  // jump landing marker on the jump car
  const land = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.6), new THREE.MeshStandardMaterial({ map: landingTexture(), transparent: true, roughness: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  land.rotation.x = -Math.PI / 2; land.position.set(0, ROOF_Y + 0.004, carStart(3) + 1.4); land.receiveShadow = true; root.add(land);

  // locomotive
  addBody(LOCO_Z0, LOCO_END, false);
  addRoof(LOCO_Z0, LOCO_ROOF_END, -1);
  B.add(rbox, m.blue, { x: 0, y: ROOF_Y + 0.75, z: (LOCO_ROOF_END + LOCO_END) / 2 }, undefined, { x: 4.5, y: 1.5, z: LOCO_END - LOCO_ROOF_END });
  B.add(box, m.glass, { x: 0, y: ROOF_Y + 0.95, z: LOCO_ROOF_END - 0.01 }, undefined, { x: 3.6, y: 0.75, z: 0.04 });
  B.add(box, m.orange, { x: 0, y: ROOF_Y + 1.5, z: (LOCO_ROOF_END + LOCO_END) / 2 }, undefined, { x: 4.52, y: 0.08, z: LOCO_END - LOCO_ROOF_END + 0.02 });
  B.add(rbox, m.blueDark, { x: 0, y: 0.1, z: LOCO_END + 0.6 }, new THREE.Euler(-0.35, 0, 0), { x: 4.2, y: 2.6, z: 1.4 });
  B.add(box, m.lamp, { x: 0, y: 1.0, z: LOCO_END + 1.15 }, undefined, { x: 0.8, y: 0.35, z: 0.1 });
  B.add(box, m.dark, { x: 0, y: -0.75, z: LOCO_Z0 - 0.6 }, undefined, { x: 0.7, y: 0.45, z: 1.6 });
  B.add(box, m.dark, { x: 0, y: ROOF_Y - 0.2, z: LOCO_Z0 - 0.6 }, undefined, { x: 4.2, y: 0.4, z: 1.24 });
  B.add(box, m.dark, { x: 0, y: 0.4, z: LOCO_Z0 - 0.6 }, undefined, { x: 3.2, y: 2.4, z: 1.2 });
  B.build(root);

  // decorative parallel support train on the right-hand track (no collision; a tall guard keeps players off)
  const wheelCount = wheelPositions.length;
  const side = new THREE.Group();
  B = new Batcher(); target = side;
  for (let k = 0; k < 10; k++) {
    const z0 = -34 + k * 14.4, z1 = z0 + 13;
    addBody(z0, z1, k % 3 !== 1);
    addRoof(z0, z1, -1);
    const vz = z0 + 3 + (k * 37 % 7);
    B.add(rbox, m.blue, { x: 0.9, y: ROOF_Y + 0.35, z: vz }, undefined, { x: 1.3, y: 0.7, z: 2.2 });
    for (let r = 0; r < 6; r++) B.add(box, m.steel, { x: 0.9, y: ROOF_Y + 0.71, z: vz - 0.8 + r * 0.32 }, undefined, { x: 1.0, y: 0.04, z: 0.07 });
    B.add(rbox, m.blueDark, { x: -1.3, y: ROOF_Y + 0.25, z: z0 + 8.5 }, undefined, { x: 0.8, y: 0.5, z: 3.2 });
    for (let r = 0; r < 8; r++) B.add(rbox, m.blue, { x: -1.3, y: ROOF_Y + 0.55, z: z0 + 7.1 + r * 0.4 }, undefined, { x: 0.74, y: 0.14, z: 0.22 });
    if (k < 9) { B.add(box, m.dark, { x: 0, y: 0.4, z: z1 + 0.7 }, undefined, { x: 3.2, y: 2.4, z: 1.4 }); B.add(box, m.dark, { x: 0, y: -0.75, z: z1 + 0.7 }, undefined, { x: 0.7, y: 0.45, z: 1.6 }); }
    if (k % 2 === 0) addLadder(B, m, { x: -2.38, z: z0 + 5.5, rotY: Math.PI / 2 });
  }
  B.build(side);
  wheelPositions.length = wheelCount;
  side.scale.setScalar(0.73);
  side.position.set(-7.4, -0.56, 0);
  root.add(side);

  // gates (animated, separate)
  const gates = new Map<number, THREE.Object3D>();
  const fieldTex = gateFieldTexture();
  const fieldMat = new THREE.MeshBasicMaterial({ map: fieldTex, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, color: '#6ff' });
  CARS.forEach((_, i) => {
    if (i === 0) return;
    const g = new THREE.Group();
    const z = carEnd(i) - 0.22;
    for (const sx of [-2.15, 2.15]) {
      const post = new THREE.Mesh(new RoundedBoxGeometry(0.28, 2.6, 0.28, 2, 0.05), m.orange); post.position.set(sx, ROOF_Y + 1.3, z); post.castShadow = true; g.add(post);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 0.3), m.hazard); stripe.position.set(sx, ROOF_Y + 0.4, z); g.add(stripe);
    }
    const beam = new THREE.Mesh(new RoundedBoxGeometry(4.6, 0.26, 0.3, 2, 0.05), m.orange); beam.position.set(0, ROOF_Y + 2.6, z); g.add(beam);
    const field = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 2.45), fieldMat); field.position.set(0, ROOF_Y + 1.25, z); field.name = 'field'; g.add(field);
    root.add(g); gates.set(i, g);
  });

  // wheels
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.18, 18); wheelGeo.rotateZ(Math.PI / 2);
  const wheels = new THREE.InstancedMesh(wheelGeo, m.dark, wheelPositions.length);
  wheelPositions.forEach((p, k) => wheels.setMatrixAt(k, new THREE.Matrix4().setPosition(p)));
  root.add(wheels);

  // engine checkpoint beacon
  const beacon = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.07, 10, 48), new THREE.MeshStandardMaterial({ color: '#f26c1c', emissive: '#ff6a10', emissiveIntensity: 0.8 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.06; beacon.add(ring);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.05, 40), new THREE.MeshBasicMaterial({ color: '#7ff7ff', transparent: true, opacity: 0.35, depthWrite: false }));
  disc.rotation.x = -Math.PI / 2; disc.position.y = 0.03; beacon.add(disc);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.05, 6, 32, 1, true), new THREE.MeshBasicMaterial({ color: '#8ff', transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  beam.position.y = 3; beam.name = 'beam'; beacon.add(beam);
  beacon.position.set(ENGINE_TRIGGER.x, ROOF_Y, ENGINE_TRIGGER.z);
  root.add(beacon);

  let wheelSpin = 0;
  const tmp = new THREE.Matrix4(), rot = new THREE.Matrix4();
  return {
    root, gates, wheels, beacon,
    update(dt, t, cleared) {
      fieldTex.offset.y = (t * 0.6) % 1;
      gates.forEach((g, i) => {
        const open = cleared[i];
        const f = g.getObjectByName('field')!;
        const target = open ? 0 : 1;
        f.scale.y += (target - f.scale.y) * Math.min(1, dt * 6);
        f.visible = f.scale.y > 0.02;
        f.position.y = ROOF_Y + 1.25 * f.scale.y;
      });
      beacon.visible = true;
      (beam.material as THREE.MeshBasicMaterial).opacity = cleared[5] ? 0.22 + Math.sin(t * 4) * 0.06 : 0.05;
      ring.rotation.z = t * 0.8;
      wheelSpin += dt * 16 / 0.42;
      wheelPositions.forEach((p, k) => { rot.makeRotationX(wheelSpin); tmp.copy(rot).setPosition(p); wheels.setMatrixAt(k, tmp); });
      wheels.instanceMatrix.needsUpdate = true;
    },
  };
}

function addLadder(B: Batcher, m: Mats, at: { x: number; z: number; rotY: number }) {
  const rail = new THREE.CylinderGeometry(0.04, 0.04, 1, 8);
  const h = 2.6, top = ROOF_Y + 0.5;
  const rotE = new THREE.Euler(0, at.rotY, 0);
  const off = (dx: number) => ({ x: at.x + Math.cos(at.rotY) * dx, z: at.z - Math.sin(at.rotY) * dx });
  for (const dx of [-0.28, 0.28]) { const o = off(dx); B.add(rail, m.orange, { x: o.x, y: top - h / 2, z: o.z }, rotE, { x: 1, y: h, z: 1 }); }
  for (let k = 0; k < 8; k++) { const o = off(0); B.add(rail, m.orange, { x: o.x, y: top - 0.25 - k * 0.32, z: o.z }, new THREE.Euler(0, at.rotY, Math.PI / 2), { x: 0.8, y: 0.56, z: 0.8 }); }
}

export { HALF_L };
