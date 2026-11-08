import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { Course } from '../game/courseProgress';
import { frameAt } from './river';
import { PAL } from './palette';
import { rng } from '../core/rng';

/** Unit chamfered block centred on x/z, base at y=0, height 1. */
export function chamferBlock(c = 0.09) {
  const pts: THREE.Vector3[] = [];
  for (const x of [-0.5, 0.5]) for (const y of [0, 1]) for (const z of [-0.5, 0.5]) {
    const sx = Math.sign(x), sy = y === 0 ? -1 : 1, sz = Math.sign(z);
    pts.push(new THREE.Vector3(x - sx * c, y, z - sz * c));
    pts.push(new THREE.Vector3(x, y - sy * c, z - sz * c));
    pts.push(new THREE.Vector3(x - sx * c, y - sy * c, z));
  }
  const g = new ConvexGeometry(pts);
  return g;
}

/** Sandstone material: warm strata bands by world height, lit coral tops, deep red shadowed faces. */
export function sandstoneMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.92, metalness: 0, flatShading: true });
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNorm;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 wpp = vec4(transformed,1.0);
        #ifdef USE_INSTANCING
          wpp = instanceMatrix * wpp;
        #endif
        wpp = modelMatrix * wpp; vWPos = wpp.xyz;
        vec3 wn = objectNormal;
        #ifdef USE_INSTANCING
          wn = mat3(instanceMatrix) * wn;
        #endif
        vWNorm = normalize(mat3(modelMatrix) * wn);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vWNorm;
        float h1(float n){ return fract(sin(n)*43758.5453); }
        float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
          float a=h1(dot(i,vec2(1.,57.))), b=h1(dot(i+vec2(1,0),vec2(1.,57.))), c=h1(dot(i+vec2(0,1),vec2(1.,57.))), d=h1(dot(i+vec2(1,1),vec2(1.,57.)));
          return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float y = vWPos.y;
          float band = floor(y / 1.15);
          float bandVar = h1(band * 3.17);
          vec3 red = vec3(${hex(PAL.cliffRed)});
          vec3 warm = vec3(${hex(PAL.cliffWarm)});
          vec3 lit = vec3(${hex(PAL.cliffLit)});
          vec3 base = mix(red, warm, 0.35 + 0.6*bandVar);
          float along = (vWPos.x + vWPos.z);
          // strata: dark seam with a sunlit lip just above it
          float fy = fract(y / 1.15 + n2(vec2(along*0.08, band))*0.25);
          float seam = 1.0 - smoothstep(0.0, 0.07, fy) * smoothstep(1.0, 0.93, fy);
          base *= 1.0 - seam * 0.38;
          base = mix(base, lit, smoothstep(0.07, 0.12, fy) * (1.0 - smoothstep(0.12, 0.2, fy)) * 0.35);
          // broad mottling + fine grain
          float m = n2(vec2(along*0.12, y*0.25));
          base *= 0.82 + 0.3*m;
          base *= 0.94 + 0.12*n2(vec2(along*1.3, y*1.7));
          // vertical joints / cracks
          float crack = smoothstep(0.9, 0.97, n2(vec2((vWPos.x-vWPos.z)*0.9, floor(y/3.5))));
          base *= 1.0 - crack*0.45;
          // lit ledges and sun-facing faces
          float top = smoothstep(0.55, 0.9, vWNorm.y);
          base = mix(base, lit*1.08, top*0.8);
          float sunFace = max(dot(vWNorm, normalize(vec3(0.45,0.78,0.42))), 0.0);
          base = mix(base, lit, sunFace*0.22);
          // cooler, darker foot near the waterline
          base *= mix(0.72, 1.0, smoothstep(-2.5, 3.5, y));
          diffuseColor.rgb *= base;
        }`);
  };
  return mat;
}

function hex(h: string) {
  const c = new THREE.Color(h); // linear working space
  return `${c.r.toFixed(4)},${c.g.toFixed(4)},${c.b.toFixed(4)}`;
}

export interface CliffPlacement { s: number; side: number; topY: number; lat: number; faceLat: number; baseY: number }

/** Terraced canyon walls along both banks, plus distant mesas. Returns ledge tops for vegetation. */
/**
 * fal sandstone kit piece, unit-normalised (1x1x1, base y=0). Its eroded/stepped FRONT faces local +X.
 * native = [depth(X), height(Y), along(Z)] proportions of the source mesh, used to pick a piece whose shape fits.
 */
export interface CliffModule { name: string; geometry: THREE.BufferGeometry; lod?: THREE.BufferGeometry; material: THREE.Material; native: [number, number, number]; weight: number }
export function buildCanyon(course: Course, quality: 'high' | 'low', kit: CliffModule[] = [], seed = 1) {
  const r = rng(seed * 13 + 1234);
  const module = kit.length > 0;
  const group = new THREE.Group();
  const geo = chamferBlock();
  const mat = sandstoneMaterial();
  // instances bucketed into ~120 m chunks so each InstancedMesh can be frustum-culled
  type Bucket = { mats: THREE.Matrix4[]; colors: THREE.Color[] };
  const boxes = new Map<number, Bucket>();
  const mods = kit.map(() => new Map<number, Bucket>());
  const bucket = (map: Map<number, Bucket>, k: number) => { let b = map.get(k); if (!b) { b = { mats: [], colors: [] }; map.set(k, b); } return b; };
  let curChunk = 0;
  const ledges: CliffPlacement[] = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const add = (x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number, tint = 1) => {
    e.set((r() - 0.5) * 0.04, yaw, (r() - 0.5) * 0.04); q.setFromEuler(e);
    m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
    const b = bucket(boxes, curChunk); b.mats.push(m.clone()); b.colors.push(new THREE.Color(tint, tint * (0.97 + r() * 0.06), tint));
  };
  /** choose a kit piece whose native height/along ratio is close to the wanted box, with weighted randomness */
  const choose = (along: number, h: number, exclude = -1) => {
    const want = h / Math.max(0.1, along);
    let tot = 0; const ws = kit.map((k, i) => { const w = i === exclude ? 0 : k.weight * Math.exp(-1.6 * Math.abs(Math.log(want / (k.native[1] / k.native[2])))); tot += w; return w; });
    let x = r() * tot; for (let i = 0; i < ws.length; i++) { x -= ws[i]; if (x <= 0) return i; }
    return 0;
  };
  /** place an eroded fal sandstone piece; outward = unit vector from the river toward the bank (front faces -outward) */
  const addModule = (x: number, y: number, z: number, along: number, h: number, depth: number, ox: number, oz: number, tint = 1, prev = -1) => {
    const ki = choose(along, h, prev);
    // local +X -> toward the river (-outward): yaw so that (cos, -sin) = (-ox, -oz)
    const yaw = Math.atan2(oz, -ox) + (r() - 0.5) * 0.35;
    e.set((r() - 0.5) * 0.03, yaw, (r() - 0.5) * 0.03); q.setFromEuler(e);
    m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(depth, h, along * (r() < 0.5 ? -1 : 1)));
    const b = bucket(mods[ki], curChunk); b.mats.push(m.clone());
    b.colors.push(new THREE.Color(tint, tint * (0.93 + r() * 0.1), tint * (0.92 + r() * 0.12)));
    return ki;
  };
  const step = quality === 'high' ? 11 : 15;
  const j = course.jump;
  for (const side of [-1, 1]) {
    for (let s = -40; s < course.length + 40; s += step * (0.75 + r() * 0.5)) {
      curChunk = Math.floor(s / 120);
      const fr = frameAt(course, s);
      const yaw = Math.atan2(fr.tx, fr.tz) + (r() - 0.5) * 0.35;
      // the finish lagoon and start pool open up a bit
      const open = (s > course.length * 0.8 ? 6 : 0) + (s < 30 ? 2 : 0);
      // alternate which bank opens up so the view keeps a generous sky and a near feature wall
      const o = 0.5 + 0.5 * Math.sin(s * 0.011 + side * 1.9 + Math.sin(s * 0.004) * 2);
      let lat = side * (fr.hw + 4.5 + open + o * o * 22 + r() * 2.5);
      let y = fr.y + 0.6 + o * 1.2;
      const hScale = 0.42 + (1 - o) * 0.72;
      const tiers = 3 + Math.floor(r() * 3);
      let last = { lat, y };
      for (let t = 0; t < tiers; t++) {
        const w = 14 + r() * 12, d = 7 + r() * 5;
        const h = (t === 0 ? 3 + r() * 4 : 3.5 + r() * 6.5) * hScale * (s > j.rampEndS - 40 && s < j.rampEndS + 40 ? 1.35 : 1);
        const x = fr.x + fr.rx * (lat + side * d * 0.5), z = fr.z + fr.rz * (lat + side * d * 0.5);
        if (module) {
          // a row of eroded pieces along the bank, each piece sized to its own random shape
          let off = -w / 2, prev = -1;
          while (off < w / 2 - 1) {
            const pw = Math.min(w / 2 - off, (h + 0.6) * (0.7 + r() * 1.1) + 2);
            const hh = (h + 0.6) * (0.82 + r() * 0.36);
            const c = off + pw / 2;
            prev = addModule(x + fr.tx * c, y - 0.6, z + fr.tz * c, pw * 1.18, hh, d * (0.9 + r() * 0.3), fr.rx * side, fr.rz * side, 0.88 + r() * 0.2, prev);
            off += pw;
          }
        } else add(x, y - 0.6, z, d * 1.0, h + 0.6, w, yaw + Math.PI / 2, 0.92 + r() * 0.16);
        // chunky offset sub-blocks for stepped silhouettes
        if (r() < 0.7 && !module) {
          const o = (r() - 0.5) * w * 0.6;
          add(x + fr.tx * o + fr.rx * side * (-d * 0.18), y + h - 0.4, z + fr.tz * o + fr.rz * side * (-d * 0.18),
            d * 0.75, 1.2 + r() * 2.2, w * (0.45 + r() * 0.3), yaw + Math.PI / 2 + (r() - 0.5) * 0.3, 0.95 + r() * 0.1);
        }
        last = { lat: lat + side * d * 0.5, y: y + h };
        ledges.push({ s, side, topY: y + h, lat: lat + side * d * 0.3, faceLat: lat, baseY: y });
        y += h;
        lat += side * (1.5 + r() * 3.5);
      }
      void last;
    }
  }
  // closing walls behind the start pool
  curChunk = -1;
  for (let k = -3; k <= 3; k++) {
    const fr = frameAt(course, -42);
    const lat = k * 9;
    if (module) addModule(fr.x + fr.rx * lat - fr.tx * 4, fr.y - 0.5, fr.z + fr.rz * lat - fr.tz * 4, 10, 12 + r() * 8, 9, -fr.tx, -fr.tz, 0.95 + r() * 0.1);
    else add(fr.x + fr.rx * lat - fr.tx * 4, fr.y - 0.5, fr.z + fr.rz * lat - fr.tz * 4, 9, 14 + r() * 10, 8, Math.atan2(fr.tx, fr.tz), 1);
  }
  // distant mesas
  curChunk = 9999;
  for (let i = 0; i < 40; i++) {
    const s = r() * course.length;
    const fr = frameAt(course, s);
    const side = r() < 0.5 ? -1 : 1;
    const lat = side * (60 + r() * 120);
    const sz = 25 + r() * 35;
    if (module) addModule(fr.x + fr.rx * lat, fr.y - 2, fr.z + fr.rz * lat, sz, sz * (0.5 + r() * 0.5), sz * (0.8 + r() * 0.4), fr.rx * side, fr.rz * side, 1.05);
    else add(fr.x + fr.rx * lat, fr.y - 2, fr.z + fr.rz * lat, 25 + r() * 40, 18 + r() * 26, 25 + r() * 40, r() * 3, 1.05);
  }
  // per-chunk high/low detail swap (fal pieces: ~1500 tris near, ~350 tris far)
  const chunks = new Map<number, { center: THREE.Vector3; hi: THREE.Object3D[]; lo: THREE.Object3D[] }>();
  const chunkOf = (k: number) => {
    let c = chunks.get(k);
    if (!c) {
      const fr = frameAt(course, k === -1 ? -40 : k === 9999 ? course.length / 2 : (k + 0.5) * 120);
      c = { center: new THREE.Vector3(fr.x, fr.y, fr.z), hi: [], lo: [] }; chunks.set(k, c);
    }
    return c;
  };
  const emit = (map: Map<number, Bucket>, g: THREE.BufferGeometry, mt: THREE.Material, lod?: THREE.BufferGeometry) => {
    for (const [k, b] of map) {
      const mk = (geom: THREE.BufferGeometry, shadow: boolean) => {
        const inst = new THREE.InstancedMesh(geom, mt, b.mats.length);
        b.mats.forEach((mm, i) => { inst.setMatrixAt(i, mm); inst.setColorAt(i, b.colors[i]); });
        inst.castShadow = shadow && quality === 'high'; inst.receiveShadow = true; // low quality drops cliff shadow casting first
        inst.computeBoundingSphere();
        group.add(inst);
        return inst;
      };
      if (k === 9999) { mk(g, false); continue; }              // distant mesas: few, huge, always full detail (low-poly reads as shards at that scale)
      const hi = mk(g, true);
      if (lod) { const lo = mk(lod, false); lo.visible = false; const c = chunkOf(k); c.hi.push(hi); c.lo.push(lo); }
    }
  };
  emit(boxes, geo, mat);
  kit.forEach((k, i) => emit(mods[i], k.geometry, k.material, k.lod));
  const lodDist = quality === 'high' ? 170 : 110;
  /** call per frame with the camera position */
  const updateLod = (cam: THREE.Vector3) => {
    for (const c of chunks.values()) {
      const near = c.center.distanceTo(cam) < lodDist;
      for (const o of c.hi) o.visible = near;
      for (const o of c.lo) o.visible = !near;
    }
  };
  return { group, ledges, material: mat, geometry: geo, updateLod };
}

/** Low-poly grey river boulders (shared geometry); used for shores, slalom rocks and the leap funnel. */
export function boulderGeometry(seed: number) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const r = rng(seed);
  const p = g.attributes.position as THREE.BufferAttribute;
  const cache = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let f = cache.get(k); if (f === undefined) { f = 0.82 + r() * 0.3; cache.set(k, f); }
    p.setXYZ(i, p.getX(i) * f * 1.1, Math.max(-0.35, p.getY(i)) * f * 0.78, p.getZ(i) * f);
  }
  g.computeVertexNormals();
  return g;
}

export function boulderMaterial() {
  return new THREE.MeshStandardMaterial({ color: '#7a7882', roughness: 0.82, emissive: new THREE.Color('#26262e'), flatShading: true });
}
