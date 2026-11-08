import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Course } from '../game/courseProgress';
import { frameAt } from './river';
import { CliffPlacement, boulderGeometry, boulderMaterial } from './canyon';
import { PAL } from './palette';
import { rng } from '../core/rng';
import { FoliageCardBuilder, PLANT_LAYOUT, TREE_LAYOUT, PlantKind, TreeKind } from './foliageCards';

/** One broad tropical leaf: folded along its midrib, curving outward, vertex-coloured base->tip. */
function leafGeometry(len: number, wid: number, bend: number, segs = 6) {
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const base = new THREE.Color(PAL.foliageDark), tip = new THREE.Color(PAL.foliageLight), mid = new THREE.Color(PAL.foliage);
  const c = new THREE.Color();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const w = Math.sin(Math.PI * Math.min(1, t * 1.05)) * wid * (1 - t * 0.25);
    const y = Math.sin(t * Math.PI * 0.5) * len * 0.55 - bend * t * t * len;
    const z = t * len;
    c.copy(base).lerp(mid, Math.min(1, t * 1.6)).lerp(tip, Math.max(0, t - 0.5) * 1.2);
    // midrib, left, right (fold up at edges)
    pos.push(0, y, z, -w, y + w * 0.25, z, w, y + w * 0.25, z);
    const edge = c.clone().multiplyScalar(1.08);
    col.push(c.r * 0.9, c.g * 0.9, c.b * 0.9, edge.r, edge.g, edge.b, edge.r * 0.93, edge.g * 0.93, edge.b * 0.93);
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 3, b = (i + 1) * 3;
    idx.push(a, b, a + 1, a + 1, b, b + 1, a, a + 2, b, a + 2, b + 2, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g.toNonIndexed();
}

export function plantGeometry(seed: number, leaves: number, len: number, wid: number, bend: number) {
  const r = rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < leaves; i++) {
    const g = leafGeometry(len * (0.75 + r() * 0.4), wid * (0.8 + r() * 0.4), bend * (0.7 + r() * 0.6));
    g.rotateX(-0.25 - r() * 0.5);
    g.rotateY((i / leaves) * Math.PI * 2 + r() * 0.4);
    parts.push(g);
  }
  return mergeGeometries(parts)!;
}

export function flowerGeometry() {
  const shape = new THREE.Shape();
  const petals = 5;
  for (let i = 0; i <= petals * 2; i++) {
    const a = (i / (petals * 2)) * Math.PI * 2;
    const rr = i % 2 === 0 ? 0.24 : 0.09;
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
    if (i === 0) shape.moveTo(x, y); else shape.quadraticCurveTo(Math.cos(a - 0.3) * rr * 1.1, Math.sin(a - 0.3) * rr * 1.1, x, y);
  }
  const g = new THREE.ShapeGeometry(shape, 2);
  g.rotateX(-Math.PI / 2 + 0.5);
  const col: number[] = [];
  const pink = new THREE.Color(PAL.flower), center = new THREE.Color(PAL.flowerCenter);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const d = Math.hypot(p.getX(i), p.getZ(i), p.getY(i));
    const c = d < 0.07 ? center : pink.clone().lerp(new THREE.Color('#ff9ccb'), Math.min(1, d * 3));
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

export function treeGeometry(seed: number) {
  const r = rng(seed);
  const trunk = new THREE.CylinderGeometry(0.18, 0.32, 5, 6); trunk.translate(0, 2.5, 0);
  const tc = new THREE.Color('#6b4a2e');
  const parts: THREE.BufferGeometry[] = [];
  const colorize = (g: THREE.BufferGeometry, c: THREE.Color, vary = 0) => {
    const n = g.attributes.position.count; const a: number[] = [];
    for (let i = 0; i < n; i++) { const y = g.attributes.position.getY(i); const k = 1 + vary * (y - 5) * 0.06; a.push(c.r * k, c.g * k, c.b * k); }
    g.setAttribute('color', new THREE.Float32BufferAttribute(a, 3));
    return g;
  };
  parts.push(colorize(trunk.toNonIndexed(), tc));
  const greens = [new THREE.Color(PAL.foliage), new THREE.Color(PAL.foliageDark), new THREE.Color('#86ad3e')];
  for (let i = 0; i < 5; i++) {
    const b = new THREE.IcosahedronGeometry(1.4 + r() * 0.9, 0);
    b.scale(1.2, 0.75, 1.2);
    b.translate((r() - 0.5) * 2.6, 5 + r() * 1.6, (r() - 0.5) * 2.6);
    parts.push(colorize(b.index ? b.toNonIndexed() : b, greens[i % 3], 1));
  }
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  return g;
}

export interface MeshKit { geometry: THREE.BufferGeometry; material: THREE.Material }

/** Weighted random pick. */
function pick<T extends string>(r: () => number, w: Partial<Record<T, number>>): T {
  let tot = 0; for (const k in w) tot += w[k]!;
  let x = r() * tot;
  for (const k in w) { x -= w[k]!; if (x <= 0) return k; }
  return Object.keys(w)[0] as T;
}

/**
 * Bank biomes drift along the river (low-frequency noise on s), so variety comes in coherent patches instead of
 * uniform confetti: lush tropical, flowering, reedy shallows and drier agave stretches.
 */
const BIOMES: Partial<Record<PlantKind, number>>[] = [
  { broadleaf: 4, elephantear: 3, fern: 3, palmlet: 2, flowerbush: 1, hibiscus: 1 },           // lush tropical
  { flowerbush: 3, hibiscus: 3, bougainvillea: 3, fernflower: 2, broadleaf: 1, fern: 1 },       // flowering
  { reeds: 5, fern: 2, fernflower: 2, broadleaf: 1, elephantear: 1 },                           // reedy shallows
  { agave: 3, fernflower: 2, palmlet: 2, bougainvillea: 2, fern: 1 },                           // drier sunny
];
const PLANT_H: Partial<Record<PlantKind, number>> = { broadleaf: 1.4, fern: 1.3, flowerbush: 1.0, reeds: 1.8, palmlet: 1.5, bougainvillea: 1.4,
  elephantear: 1.7, hibiscus: 1.2, fernflower: 0.8, agave: 1.3 };
const TREE_W: Partial<Record<TreeKind, number>> = { acacia: 3, roundtree: 3, palm: 2, jungletree: 2, gnarled: 1.5 };
const TREE_H: Partial<Record<TreeKind, number>> = { acacia: 5, roundtree: 4.5, palm: 7, jungletree: 8, gnarled: 3.5 };

/** Bank foliage, cliff-ledge plants and trees, hanging vines (fal painted cards) and shoreline boulders (fal meshes). */
export function buildVegetation(course: Course, ledges: CliffPlacement[], quality: 'high' | 'low', avoid: (s: number) => boolean,
  plantTex: THREE.Texture, treeTex: THREE.Texture, seed: number, rockKit: MeshKit[] = []) {
  const r = rng(seed * 7 + 4321);
  const group = new THREE.Group();
  const density = quality === 'high' ? 1 : 0.55;
  const cards = new FoliageCardBuilder(PLANT_LAYOUT);
  const trees = new FoliageCardBuilder(TREE_LAYOUT);
  const rockLists: THREE.Matrix4[][] = rockKit.length ? rockKit.map(() => []) : [[]];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const put = (list: THREE.Matrix4[], x: number, y: number, z: number, sc: THREE.Vector3, yaw = r() * 6.28, tilt = 0) => {
    q.setFromAxisAngle(up, yaw);
    if (tilt) q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt * (r() - 0.5), 0, tilt * (r() - 0.5))));
    m.compose(new THREE.Vector3(x, y, z), q, sc); list.push(m.clone());
  };
  const phase = r() * 100, phase2 = r() * 100;
  const biomeAt = (s: number, side: number) => {
    const v = Math.sin(s * 0.012 + phase + side * 1.3) + 0.6 * Math.sin(s * 0.031 + phase2 - side);
    return BIOMES[Math.floor(((v + 1.6) / 3.2) * BIOMES.length * 0.999 + BIOMES.length) % BIOMES.length];
  };
  const tint = () => 0.84 + r() * 0.24;
  const plant = (kind: PlantKind, x: number, y: number, z: number, scale: number, tintMul = 1) =>
    cards.add(kind, x, y, z, (PLANT_H[kind] ?? 1.2) * scale, null, tint() * tintMul, r() < 0.5);
  // lush water-edge band + scattered plants up the bank, in clumps of 1-4
  for (const side of [-1, 1]) {
    for (let s = -30; s < course.length + 30; s += (1.0 + r() * 1.2) / density) {
      if (avoid(s)) continue;
      if (r() < 0.1) continue;
      const fr = frameAt(course, s);
      const w = biomeAt(s, side);
      const edge = r() < 0.6;
      const baseLat = fr.hw + (edge ? 0.3 + r() * 1.6 : 2 + r() * 7);
      const n = 1 + Math.floor(r() * r() * 4);
      const kind = pick(r, w);
      for (let k = 0; k < n; k++) {
        const kk = k === 0 || r() < 0.6 ? kind : pick(r, w);
        const lat = side * (baseLat + (r() - 0.3) * 1.2);
        const ds = (r() - 0.5) * 1.6;
        const x = fr.x + fr.rx * lat + fr.tx * ds, z = fr.z + fr.rz * lat + fr.tz * ds;
        const y = fr.y + 0.05 + Math.max(0, Math.abs(lat) - fr.hw) * 0.17;
        plant(kk, x, y, z, (0.7 + r() * 0.8) * (k ? 0.75 : 1));
      }
      if (r() < 0.3) {
        const rl = side * (fr.hw + 0.1 + r() * 1.4);
        const sc = 0.5 + r() * 1.1;
        const li = Math.floor(r() * rockLists.length);
        put(rockLists[li], fr.x + fr.rx * rl, fr.y - 0.25 * sc, fr.z + fr.rz * rl, new THREE.Vector3(sc * (0.8 + r() * 0.5), sc * (0.7 + r() * 0.5), sc * (0.8 + r() * 0.5)), r() * 6.28, 0.25);
      }
    }
  }
  for (const L of ledges) {
    const fr = frameAt(course, L.s);
    const w = biomeAt(L.s, L.side);
    const n = 2 + Math.floor(r() * 4 * density);
    for (let k = 0; k < n; k++) {
      const along = (r() - 0.5) * 11;
      const lat = L.lat + L.side * (r() * 3.5 - 2.2);
      const x = fr.x + fr.rx * lat + fr.tx * along, z = fr.z + fr.rz * lat + fr.tz * along;
      if (r() < 0.2) {
        const tk = pick(r, TREE_W);
        trees.add(tk, x, L.topY - 0.3, z, (TREE_H[tk] ?? 5) * (0.75 + r() * 0.6), null, 0.88 + r() * 0.18, r() < 0.5);
      } else plant(pick(r, w), x, L.topY - 0.05, z, 1.0 + r() * 1.1, 0.96);
    }
    // vines / flowering curtains spilling over the river-facing edge of near tiers
    if (Math.abs(L.faceLat) < fr.hw + 30 && r() < 0.55 * density + 0.1) {
      const nv = 1 + Math.floor(r() * 3);
      for (let k = 0; k < nv; k++) {
        const along = (r() - 0.5) * 9;
        const lat = L.faceLat - L.side * 0.25;
        const x = fr.x + fr.rx * lat + fr.tx * along, z = fr.z + fr.rz * lat + fr.tz * along;
        const len = Math.min(L.topY - L.baseY + 0.5, 2.5 + r() * 5);
        cards.add(r() < 0.3 ? 'vinecurtain' : 'vine', x, L.topY + 0.25, z, len, Math.atan2(-fr.tz, fr.tx) + (r() - 0.5) * 0.25, tint(), r() < 0.5);
      }
    }
  }
  const mk = (geo: THREE.BufferGeometry, list: THREE.Matrix4[], mat: THREE.Material, shadow = true) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((mm, i) => im.setMatrixAt(i, mm));
    im.castShadow = shadow; im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
  };
  if (rockKit.length) rockKit.forEach((kt, i) => mk(kt.geometry, rockLists[i], kt.material));
  else mk(boulderGeometry(3), rockLists[0], boulderMaterial());
  const cardMesh = cards.build(plantTex);
  group.add(cardMesh);
  const treeMesh = trees.build(treeTex);
  group.add(treeMesh);
  const cu = cardMesh.userData.uniforms as Record<string, THREE.IUniform>;
  // trees share the foliage card time uniform so wind sway stays in sync
  (treeMesh.material as THREE.ShaderMaterial).uniforms.uTime = cu.uTime;
  return { group, cardUniforms: cu, cards: cards.count + trees.count };
}
