import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Tex } from '../core/assets';
import { BRIDGES, PLACEMENTS, RIVER, baseHeight, groundHeight, pathStrength, riverHalfAt, riverInfo, rng, surfaceHeight, waterLevel, inShallows, walkable } from './layout';

/** Painted flower-field stripes on the mid-distance slopes (like the reference's lavender/yellow/coral bands). */
export const FIELD_COLORS = ['#b9a3df', '#efd978', '#ec8f70', '#f2efe0', '#c2a6e3', '#f1c45b'];
export function fieldStripe(x: number, z: number): { idx: number; k: number } | null {
  let k = 0;
  if (x > 18 && x < 60 && z > -46 && z < -6) k = Math.min(1, Math.min(x - 18, -6 - z) / 6);
  else if (x < -36 && z < -4 && z > -56) k = Math.min(1, Math.min(-36 - x, -4 - z) / 6);
  else if (z < -42 && x > -56 && x < 26) k = Math.min(1, (-42 - z) / 6);
  if (k <= 0) return null;
  const band = x * 0.06 + z * 0.11 + Math.sin(x * 0.05) * 1.2;
  const edge = Math.abs(band - Math.floor(band) - 0.5) * 2;
  if (edge > 0.72) return null; // green gaps between rows
  const idx = ((Math.floor(band) % FIELD_COLORS.length) + FIELD_COLORS.length) % FIELD_COLORS.length;
  return { idx, k };
}
export const PALETTE = {
  fog: new THREE.Color('#e2eeea'),
  skyTop: new THREE.Color('#4f97d8'),
  skyHorizon: new THREE.Color('#e4f0f0'),
};

const CLOUDS = `
  uniform float uCloudT;
  float ch(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
  float cn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(ch(i),ch(i+vec2(1,0)),f.x), mix(ch(i+vec2(0,1)),ch(i+vec2(1,1)),f.x), f.y); }
  float cloudShade(vec2 w){ vec2 p = w * 0.018 + vec2(uCloudT * 0.012, uCloudT * 0.006); float n = cn(p) * 0.6 + cn(p * 2.3 + 4.1) * 0.4; return 1.0 - 0.16 * smoothstep(0.52, 0.72, n); }
`;
export const cloudUniform = { value: 0 };
const fogChunksV = `
#include <fog_pars_vertex>
`;
const fogChunksF = `
#include <fog_pars_fragment>
`;

// ---------- shared sprite helpers ----------
const geoCache = new Map<string, THREE.PlaneGeometry>();
export function spriteGeometry(tex: THREE.Texture, flip = false): THREE.PlaneGeometry {
  const img = tex.image as { width: number; height: number };
  const key = `${tex.uuid}:${flip}`;
  let g = geoCache.get(key);
  if (!g) {
    const aspect = img.width / img.height;
    g = new THREE.PlaneGeometry(aspect, 1);
    g.translate(0, 0.5, 0);
    if (flip) { const uv = g.attributes.uv as THREE.BufferAttribute; for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i)); }
    geoCache.set(key, g);
  }
  return g;
}
const matCache = new Map<string, THREE.MeshBasicMaterial>();
export function spriteMaterial(tex: THREE.Texture, soft = false): THREE.MeshBasicMaterial {
  const key = `${tex.uuid}:${soft}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ map: tex, transparent: soft, alphaTest: soft ? 0.04 : 0.42, depthWrite: true, fog: true, side: THREE.DoubleSide });
    matCache.set(key, m);
  }
  return m;
}

let shadowTex: THREE.Texture | null = null;
export function blobShadowTexture() {
  if (shadowTex) return shadowTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!; const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  gr.addColorStop(0, 'rgba(70,80,30,0.55)'); gr.addColorStop(0.55, 'rgba(70,80,30,0.28)'); gr.addColorStop(1, 'rgba(70,80,30,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  shadowTex = new THREE.CanvasTexture(c); shadowTex.colorSpace = THREE.SRGBColorSpace;
  return shadowTex;
}
const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
let shadowMat: THREE.MeshBasicMaterial | null = null;
export function makeBlobShadow(w: number, d: number) {
  shadowMat ??= new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, depthWrite: false, fog: true, polygonOffset: true, polygonOffsetFactor: -2 });
  const m = new THREE.Mesh(shadowGeo, shadowMat); m.scale.set(w, 1, d); m.renderOrder = 1; return m;
}

let treeShadow: THREE.MeshBasicMaterial | null = null;
function treeShadowMat() {
  treeShadow ??= new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, opacity: 1, depthWrite: false, fog: true, color: new THREE.Color(0.55, 0.62, 0.42), polygonOffset: true, polygonOffsetFactor: -2 });
  return treeShadow;
}

export interface WorldView {
  root: THREE.Group;
  billboards: THREE.Object3D[];
  skyline: THREE.Mesh;
  sky: THREE.Mesh;
  flowers: THREE.InstancedMesh;
  flowerTotal: number;
  water: THREE.ShaderMaterial;
  flowerMat: THREE.ShaderMaterial;
  windmillSails?: THREE.Object3D;
  update(time: number, camera: THREE.PerspectiveCamera, yaw: number, focus?: THREE.Vector3): void;
  setQuality(q: number): void;
  occluders: { x: number; z: number; r: number; h: number }[];
}

export function buildWorld(tex: Tex, scene: THREE.Scene): WorldView {
  const root = new THREE.Group(); scene.add(root);
  const billboards: THREE.Object3D[] = [];
  scene.fog = new THREE.Fog(PALETTE.fog, 95, 540);

  // ---------- lights (only used by the few Lambert meshes: bridges, stones) ----------
  const hemi = new THREE.HemisphereLight('#f4f8ff', '#9fbf6a', 2.1); scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff3dc', 1.6); sun.position.set(-30, 60, 20); scene.add(sun);

  // ---------- sky dome ----------
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: PALETTE.skyTop }, hor: { value: PALETTE.skyHorizon } },
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 hor; varying vec3 vP; void main(){ float t = smoothstep(-0.02, 0.45, vP.y); gl_FragColor = vec4(mix(hor, top, t), 1.);
#include <colorspace_fragment>
}`,
  }));
  sky.renderOrder = -10; scene.add(sky);

  // ---------- painted skyline: 360° cylinder with mirrored repeats ----------
  const st = tex['skyline']; st.wrapS = THREE.MirroredRepeatWrapping; st.repeat.set(4, 1); st.offset.set(0.5 - 0.125 * 0, 0);
  const R = 520, H = 120;
  const skylineGeo = new THREE.CylinderGeometry(R, R, H, 96, 1, true);
  const skyline = new THREE.Mesh(skylineGeo, new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, depthWrite: false, fog: false,
    uniforms: { map: { value: st }, hor: { value: PALETTE.skyHorizon }, top: { value: PALETTE.skyTop } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform sampler2D map; varying vec2 vUv;
      void main(){
        // u * 4 copies; mirrored repeat in shader for seamless wrap
        float u = vUv.x * 4.0; float f = fract(u); if (mod(floor(u), 2.0) > 0.5) f = 1.0 - f;
        vec4 c = texture2D(map, vec2(f, vUv.y));
        float a = smoothstep(1.0, 0.82, vUv.y);
        // soften the painted far hills toward the haze
        c.rgb = mix(c.rgb, vec3(0.79,0.87,0.85), 0.04);
        // deepen the painted sky toward the reference's saturated blue
        float skyMask = smoothstep(0.42, 0.9, vUv.y) * smoothstep(0.45, 0.7, c.b - c.r * 0.35);
        c.rgb = mix(c.rgb, c.rgb * vec3(0.66, 0.84, 1.0), skyMask);
        gl_FragColor = vec4(c.rgb, a);
        #include <colorspace_fragment>
      }`,
  }));
  // place so a copy's centre faces -Z; bottom slightly below eye height
  skyline.rotation.y = Math.PI / 2 + Math.PI / 4;
  skyline.renderOrder = -9; scene.add(skyline);

  // ---------- terrain ----------
  const X0 = -220, X1 = 220, Z0 = -300, Z1 = 110, SX = 300, SZ = 260;
  const tg = new THREE.PlaneGeometry(X1 - X0, Z1 - Z0, SX, SZ); tg.rotateX(-Math.PI / 2); tg.translate((X0 + X1) / 2, 0, (Z0 + Z1) / 2);
  const pos = tg.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color(), tmp = new THREE.Color();
  const grassA = new THREE.Color('#9fcb4e'), grassB = new THREE.Color('#84b943'), grassSun = new THREE.Color('#c2dc5c'), grassShade = new THREE.Color('#72a63e');
  const dirt = new THREE.Color('#d8a874'), dirtLight = new THREE.Color('#e6c08f'), bank = new THREE.Color('#b9c47a'), bed = new THREE.Color('#7fb4b0');
  const stripes = ['#b9a3df', '#efd978', '#ec8f70', '#f2efe0', '#a9c75c', '#c2a6e3', '#a6c45a'].map(s => new THREE.Color(s));
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const inside = x > -70 && x < 70 && z > -70 && z < 70;
    const y = inside ? groundHeight(x, z) : baseHeight(x, z);
    pos.setY(i, y);
    const n1 = Math.sin(x * 0.11 + Math.sin(z * 0.07) * 2) * 0.5 + 0.5, n2 = Math.sin(z * 0.13 - x * 0.05 + 1.3) * 0.5 + 0.5;
    c.copy(grassA).lerp(grassB, n1 * 0.7).lerp(grassSun, Math.max(0, n2 - 0.55) * 1.4);
    if (inside) {
      const r = riverInfo(x, z), half = riverHalfAt(x, z);
      if (r.d < half + 2.4) c.lerp(bank, 0.55 * (1 - Math.max(0, (r.d - half) / 2.4)));
      if (r.d < half - 0.3) c.copy(bed);
      const p = pathStrength(x, z);
      if (p > 0) { tmp.copy(dirt).lerp(dirtLight, Math.max(0, p - 0.6) * 1.5); c.lerp(tmp, p); }
      const fsx = fieldStripe(x, z);
      if (fsx && pathStrength(x, z) < 0.3 && r.d > half + 1.5) c.lerp(new THREE.Color(FIELD_COLORS[fsx.idx]), 0.55 * fsx.k);
      // darker grass rim along the far side of hill crests for depth
      c.lerp(grassShade, Math.max(0, Math.sin(x * 0.05 - z * 0.09)) * 0.12);
    }
    // painted flower-field stripes on the distant hills
    if (z < -50) {
      const k = Math.min(1, (-50 - z) / 18);
      const band = (x * 0.035 + z * 0.06 + Math.sin(x * 0.02) * 1.6);
      const idx = Math.floor(band) % stripes.length; const s = stripes[(idx + stripes.length) % stripes.length];
      const edge = Math.abs(fract(band) - 0.5) * 2;
      c.lerp(s, k * 0.8 * (1 - Math.pow(edge, 6)));
    }
    if (x > 58 && z < 40) { // eastern farm slopes get soft field stripes too
      const k = Math.min(1, (x - 58) / 14);
      const band = (z * 0.05 - x * 0.03 + Math.sin(z * 0.03) * 1.4);
      const idx = Math.floor(band) % stripes.length; const s = stripes[(idx + stripes.length) % stripes.length];
      c.lerp(s, k * 0.55 * (1 - Math.pow(Math.abs(fract(band) - 0.5) * 2, 6)));
    }
    if (x < -62 || x > 62) c.lerp(new THREE.Color('#93b956'), 0.2);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  function fract(v: number) { return v - Math.floor(v); }
  tg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  tg.computeVertexNormals();
  const gt = tex['ground']; gt.wrapS = gt.wrapT = THREE.RepeatWrapping;
  const terrainMat = new THREE.ShaderMaterial({
    fog: true, vertexColors: true,
    uniforms: { ...THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { detail: { value: gt }, sunDir: { value: new THREE.Vector3(0.35, 0.8, -0.45).normalize() } }]), uCloudT: cloudUniform },
    vertexShader: `varying vec3 vCol; varying vec3 vN; varying vec3 vW; ${fogChunksV}
      void main(){ vCol = color; vN = normal; vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; vec4 mvPosition = viewMatrix*w; gl_Position = projectionMatrix*mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: `uniform sampler2D detail; uniform vec3 sunDir; varying vec3 vCol; varying vec3 vN; varying vec3 vW; ${CLOUDS} ${fogChunksF}
      void main(){
        vec3 t1 = texture2D(detail, vW.xz / 7.0).rgb;
        vec3 t2 = texture2D(detail, vW.xz / 23.0 + 0.37).rgb;
        float l = dot(mix(t1, t2, 0.4), vec3(0.3, 0.59, 0.11));
        float detailK = l / 0.62;
        vec3 base = vCol * mix(1.0, detailK, 0.5);
        float ndl = max(dot(normalize(vN), sunDir), 0.0);
        vec3 lit = base * (0.66 + 0.46 * ndl) * vec3(1.04, 1.0, 0.94) * cloudShade(vW.xz);
        gl_FragColor = vec4(lit, 1.0);
        #include <fog_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const terrain = new THREE.Mesh(tg, terrainMat); terrain.name = 'terrain'; root.add(terrain);

  // ---------- river ribbon ----------
  const rv: number[] = [], ruv: number[] = [], ridx: number[] = [];
  let along = 0;
  for (let i = 0; i < RIVER.length; i++) {
    const [x, z] = RIVER[i];
    const [nx, nz] = RIVER[Math.min(i + 1, RIVER.length - 1)], [px, pz] = RIVER[Math.max(i - 1, 0)];
    let dx = nx - px, dz = nz - pz; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    if (i > 0) along += Math.hypot(x - RIVER[i - 1][0], z - RIVER[i - 1][1]);
    const half = riverHalfAt(x, z) + 0.9, y = waterLevel(x, z);
    rv.push(x - dz * half, y, z + dx * half, x + dz * half, y, z - dx * half);
    ruv.push(0, along, 1, along);
    if (i > 0) { const b = (i - 1) * 2; ridx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(rv, 3)); rg.setAttribute('uv', new THREE.Float32BufferAttribute(ruv, 2)); rg.setIndex(ridx);
  const water = new THREE.ShaderMaterial({
    fog: true, transparent: true, side: THREE.DoubleSide,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { time: { value: 0 } }]),
    vertexShader: `varying vec2 vUv; ${fogChunksV}
 void main(){ vUv = uv; vec4 mvPosition = modelViewMatrix*vec4(position,1.); gl_Position = projectionMatrix*mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: `uniform float time; varying vec2 vUv; ${fogChunksF}
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      void main(){
        float across = abs(vUv.x*2.0-1.0);
        // painted depth bands: turquoise centre -> lighter shallows -> sandy-green rim
        vec3 deep = vec3(0.22,0.56,0.80), mid = vec3(0.36,0.70,0.88), shallow = vec3(0.62,0.85,0.88), rim = vec3(0.74,0.84,0.66);
        float wob = n(vec2(vUv.y*0.25, 1.7)) * 0.12;
        vec3 col = mix(deep, mid, smoothstep(0.05, 0.55 + wob, across));
        col = mix(col, shallow, smoothstep(0.6 + wob, 0.86, across));
        col = mix(col, rim, smoothstep(0.9, 0.99, across));
        // soft brush streaks stretched along the flow
        float st = n(vec2(vUv.x*7.0, vUv.y*0.22 - time*0.35)) * 0.65 + n(vec2(vUv.x*15.0 + 3.0, vUv.y*0.5 - time*0.6)) * 0.35;
        col = mix(col, vec3(0.86,0.95,0.98), smoothstep(0.58, 0.78, st) * 0.42 * (1.0 - across*0.7));
        // gentle darker ripple troughs
        col *= 1.0 - smoothstep(0.62, 0.8, n(vec2(vUv.x*5.0 + 9.0, vUv.y*0.3 - time*0.25))) * 0.08;
        // round sparkles (sun glints)
        vec2 gp = vec2(vUv.x*26.0, vUv.y*2.2 - time*1.2); vec2 gi = floor(gp), gf = fract(gp) - 0.5;
        float g = step(0.93, h(gi)) * smoothstep(0.22, 0.0, length(gf * vec2(1.0, 1.8))) * (0.5 + 0.5*sin(time*4.0 + h(gi)*20.0));
        col += g * 0.55 * (1.0 - across);
        col = pow(col, vec3(2.2));
        float a = 1.0 - smoothstep(0.93, 1.0, across);
        gl_FragColor = vec4(col, a);
        #include <fog_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const river = new THREE.Mesh(rg, water); river.renderOrder = 2; root.add(river);

  // ---------- bridges (real 3D geometry) ----------
  const plankGeo = new THREE.BoxGeometry(1, 0.12, 0.34);
  // painted wood: warm base, soft grain strokes and a darker hand-drawn edge (matches the sprites' outlines)
  const woodCanvas = document.createElement('canvas'); woodCanvas.width = 256; woodCanvas.height = 64;
  { const g = woodCanvas.getContext('2d')!; g.fillStyle = '#c8935c'; g.fillRect(0, 0, 256, 64);
    const wr = rng(5);
    for (let i = 0; i < 26; i++) { g.strokeStyle = `rgba(${120 + wr() * 40},${70 + wr() * 30},${40},${0.18 + wr() * 0.2})`; g.lineWidth = 1 + wr() * 2.5; g.beginPath(); const y = wr() * 64; g.moveTo(0, y); g.bezierCurveTo(80, y + (wr() - 0.5) * 8, 170, y + (wr() - 0.5) * 8, 256, y + (wr() - 0.5) * 6); g.stroke(); }
    g.fillStyle = 'rgba(255,230,190,0.18)'; g.fillRect(0, 4, 256, 10);
    g.strokeStyle = 'rgba(92,56,32,0.85)'; g.lineWidth = 6; g.strokeRect(3, 3, 250, 58); }
  const woodTex = new THREE.CanvasTexture(woodCanvas); woodTex.colorSpace = THREE.SRGBColorSpace; woodTex.anisotropy = 4;
  const woodMat = new THREE.MeshLambertMaterial({ color: '#ffffff', map: woodTex });
  for (const br of BRIDGES) {
    const n = Math.ceil(br.len / 0.38) + 3;
    const planks = new THREE.InstancedMesh(plankGeo, woodMat, n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const yaw = Math.atan2(br.dir[0], br.dir[1]);
    const r = rng(br.id.length * 77);
    const pc = new THREE.Color();
    for (let k = 0; k < n; k++) {
      const a = -0.6 + (k / (n - 1)) * (br.len + 1.2), t = Math.max(0, Math.min(1, a / br.len));
      const x = br.a[0] + br.dir[0] * a, z = br.a[1] + br.dir[1] * a;
      const y = br.deckA + (br.deckB - br.deckA) * t + Math.sin(t * Math.PI) * 0.85 + 0.06;
      const slope = Math.cos(t * Math.PI) * Math.PI * 0.85 / br.len + (br.deckB - br.deckA) / br.len;
      q.setFromEuler(new THREE.Euler(-Math.atan(slope), yaw, (r() - 0.5) * 0.04, 'YXZ'));
      s.set(br.width + (r() - 0.5) * 0.25, 1, 1); p.set(x, y, z);
      m4.compose(p, q, s); planks.setMatrixAt(k, m4);
      pc.set('#ffffff').offsetHSL(0, 0, -(r() * 0.16)); planks.setColorAt(k, pc);
    }
    root.add(planks);
    // posts + rails
    const postGeo = new THREE.BoxGeometry(0.18, 1.0, 0.18), railGeo = new THREE.BoxGeometry(0.1, 0.12, 1);
    const postMat = new THREE.MeshLambertMaterial({ color: '#b98a5c', map: woodTex });
    const parts: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      let prev: THREE.Vector3 | null = null;
      for (let a = 0; a <= br.len + 0.01; a += br.len / 6) {
        const t = a / br.len, x = br.a[0] + br.dir[0] * a - br.dir[1] * side * (br.width / 2 - 0.1), z = br.a[1] + br.dir[1] * a + br.dir[0] * side * (br.width / 2 - 0.1);
        const y = br.deckA + (br.deckB - br.deckA) * t + Math.sin(t * Math.PI) * 0.85;
        const post = new THREE.Mesh(postGeo, postMat); post.position.set(x, y + 0.45, z); post.updateMatrix(); parts.push(postGeo.clone().applyMatrix4(post.matrix));
        const top = new THREE.Vector3(x, y + 0.85, z);
        if (prev) {
          const rail = new THREE.Mesh(railGeo, postMat); rail.position.copy(prev).add(top).multiplyScalar(0.5);
          rail.scale.z = prev.distanceTo(top); rail.lookAt(top); rail.updateMatrix(); parts.push(railGeo.clone().applyMatrix4(rail.matrix));
        }
        prev = top;
      }
    }
    root.add(new THREE.Mesh(mergeGeometries(parts), postMat)); // one draw call per bridge's posts + rails
    parts.forEach(g => g.dispose());
  }

  // ---------- stepping stones marking Bubble's shallows ----------
  const stoneGeo = new THREE.SphereGeometry(1, 12, 8); stoneGeo.scale(1, 0.35, 0.8);
  const stoneMat = new THREE.MeshLambertMaterial({ color: '#cfc8bb' });
  const sr = rng(9);
  const stoneMats: THREE.Matrix4[] = [];
  for (const [cz, n] of [[13, 7], [-6, 6], [28, 5]] as const) {
    for (let k = 0; k < n; k++) {
      const z = cz + (sr() - 0.5) * 1.5 + k * 0.15;
      const ri = riverInfo(0, z); // find river centre x at this z by scanning
      let cx = 0, best = 1e9; for (let x = -25; x < 25; x += 0.25) { const d = riverInfo(x, z).d; if (d < best) { best = d; cx = x; } }
      void ri;
      const x = cx - riverHalfAt(cx, z) + 0.8 + k * ((riverHalfAt(cx, z) * 2 - 1.6) / (n - 1));
      if (!inShallows(x, z)) continue;
      const s = new THREE.Object3D(); s.position.set(x, waterLevel(x, z) + 0.02, z + (sr() - 0.5) * 0.8);
      s.scale.setScalar(0.45 + sr() * 0.25); s.rotation.y = sr() * 3; s.updateMatrix(); stoneMats.push(s.matrix.clone());
    }
  }

  { const im = new THREE.InstancedMesh(stoneGeo, stoneMat, Math.max(1, stoneMats.length)); stoneMats.forEach((m, i) => im.setMatrixAt(i, m)); im.count = stoneMats.length; root.add(im); }

  // ---------- sprite props ----------
  const treeShadowM: THREE.Matrix4[] = [], propShadowM: THREE.Matrix4[] = [];
  const occluders: WorldView['occluders'] = [];
  let windmillSails: THREE.Object3D | undefined;
  for (const p of PLACEMENTS) {
    const t = tex[p.kind]; if (!t) continue;
    if (p.kind === 'lily-flower') {
      const m = new THREE.Mesh(spriteGeometry(t), spriteMaterial(t)); m.scale.setScalar(0.75); m.position.set(p.x, waterLevel(p.x, p.z) - 0.04, p.z); m.renderOrder = 3; root.add(m); billboards.push(m); continue;
    }
    if (p.kind === 'lilypad') {
      const g = new THREE.PlaneGeometry(1, 0.62).rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, spriteMaterial(t)); m.position.set(p.x, waterLevel(p.x, p.z) + 0.03, p.z);
      m.scale.setScalar(1.1); m.rotation.y = (p.x * 13) % 6; m.renderOrder = 3; root.add(m); continue;
    }
    const mesh = new THREE.Mesh(spriteGeometry(t, p.flip), spriteMaterial(t, false));
    mesh.scale.setScalar(p.h);
    const y = surfaceHeight(p.x, p.z) - 0.08 * p.h;
    mesh.position.set(p.x, y, p.z);
    root.add(mesh); billboards.push(mesh);
    const big = p.h > 2.5;
    // batched contact shadows (tree pools offset away from the upper-right sun)
    const tree = p.kind.startsWith('tree');
    const o = new THREE.Object3D(); o.position.set(p.x + (tree ? p.h * 0.12 : 0), surfaceHeight(p.x, p.z) + 0.04, p.z + 0.1);
    o.scale.set(p.h * (big ? 0.75 : 0.9), 1, p.h * (big ? 0.42 : 0.5)); o.updateMatrix();
    (tree ? treeShadowM : propShadowM).push(o.matrix.clone());
    if (p.kind.startsWith('tree')) occluders.push({ x: p.x, z: p.z, r: p.kind === 'tree-poplar' ? 1.0 : 2.0, h: p.h });
    else if (p.collider && p.h > 0.9) occluders.push({ x: p.x, z: p.z, r: p.collider, h: p.h });
  }
  for (const [list, mat] of [[treeShadowM, treeShadowMat()], [propShadowM, makeBlobShadow(1, 1).material as THREE.Material]] as const) {
    const im = new THREE.InstancedMesh(shadowGeo, mat, list.length); list.forEach((m, i) => im.setMatrixAt(i, m)); im.renderOrder = 1; root.add(im);
  }

  // ---------- instanced painted flowers & grass ----------
  const atlas = tex['flower-atlas'];
  const flowerMat = new THREE.ShaderMaterial({
    fog: true, side: THREE.DoubleSide,
    uniforms: { ...THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: atlas }, time: { value: 0 }, right: { value: new THREE.Vector3(1, 0, 0) }, camPos: { value: new THREE.Vector3() }, focusPos: { value: new THREE.Vector3() } }]), uCloudT: cloudUniform },
    vertexShader: `attribute vec4 aUv; attribute vec2 aScale; attribute float aPhase; attribute vec3 aTint; varying vec3 vTint; uniform float time; uniform vec3 right; uniform vec3 camPos; uniform vec3 focusPos; varying vec2 vUv; varying float vShade; varying vec2 vWxz; ${fogChunksV}
      void main(){
        vec3 o = (instanceMatrix * vec4(0.,0.,0.,1.)).xyz;
        float near = smoothstep(1.4, 3.2, distance(o.xz, camPos.xz)); // shrink cards right at the lens
        // keep a clear corridor between the camera and the explorer
        vec2 cp = focusPos.xz - camPos.xz; float L2 = max(dot(cp, cp), 0.01);
        float tt = dot(o.xz - camPos.xz, cp) / L2; vec2 proj = camPos.xz + cp * clamp(tt, 0.0, 1.0);
        float lat = distance(o.xz, proj);
        float corridor = (tt > 0.0 && tt < 1.05) ? mix(0.3, 1.0, smoothstep(0.45, 1.2, lat)) : 1.0;
        near *= corridor;
        vec2 aScaleN = aScale * near;
        float sway = sin(time*1.7 + aPhase) * 0.07 * position.y * aScale.y + sin(time*0.6 + o.x*0.1) * 0.04 * position.y;
        vec3 p = o + right * (position.x * aScaleN.x + sway * near) + vec3(0., position.y * aScaleN.y, 0.);
        vUv = aUv.xy + vec2(uv.x, uv.y) * aUv.zw;
        vShade = 0.78 + 0.22 * uv.y; vWxz = o.xz; vTint = aTint;
        vec4 mvPosition = viewMatrix * vec4(p, 1.);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `uniform sampler2D map; varying vec2 vUv; varying float vShade; varying vec2 vWxz; varying vec3 vTint; ${CLOUDS} ${fogChunksF}
      void main(){ vec4 c = texture2D(map, vUv); if (c.a < 0.45) discard; vec3 tc = mix(c.rgb, c.rgb * vTint, smoothstep(0.55, 0.85, dot(c.rgb, vec3(0.33)))); gl_FragColor = vec4(tc * vShade * cloudShade(vWxz), 1.);
        #include <fog_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const fg = new THREE.PlaneGeometry(1, 1); fg.translate(0, 0.5, 0);
  type F = { x: number; z: number; cell: number; s: number; tint?: [number, number, number] };
  const items: F[] = [];
  const r = rng(20261108);
  const cellAspect = 256 / 192;
  const okSpot = (x: number, z: number) => !(riverInfo(x, z).d < riverHalfAt(x, z) + 0.3) && pathStrength(x, z) < 0.35 && walkable(x, z, 'explorer', 0.1);
  // grass tufts everywhere
  for (let k = 0; k < 8500; k++) {
    const x = -66 + r() * 132, z = -64 + r() * 128; if (!okSpot(x, z)) continue;
    items.push({ x, z, cell: 15 + Math.floor(r() * 5), s: 0.4 + r() * 0.45 });
  }
  // wildflower patches
  const kinds = [0, 0, 1, 2, 2, 0, 1];
  for (let p = 0; p < 70; p++) {
    const cx = -60 + r() * 120, cz = -58 + r() * 120; const kind = kinds[Math.floor(r() * kinds.length)];
    const n = 5 + Math.floor(r() * 10);
    for (let k = 0; k < n; k++) {
      const x = cx + (r() - 0.5) * 7, z = cz + (r() - 0.5) * 5; if (!okSpot(x, z)) continue;
      items.push({ x, z, cell: kind * 5 + Math.floor(r() * 5), s: (kind === 1 ? 0.55 : 0.4) + r() * 0.3 });
    }
  }
  // path edges & riverbanks get extra colour like the reference
  for (let k = 0; k < 1500; k++) {
    const x = -58 + r() * 116, z = -58 + r() * 116;
    const p = pathStrength(x, z); const rd = riverInfo(x, z).d - riverHalfAt(x, z);
    if (!((p > 0.02 && p < 0.3) || (rd > 0.4 && rd < 2.5))) continue; if (!okSpot(x, z)) continue;
    items.push({ x, z, cell: Math.floor(r() * 15), s: 0.4 + r() * 0.3 });
  }
  // foreground-heavy meadow around the start area (matches the reference's big front flowers)
  for (let k = 0; k < 700; k++) {
    const x = -27 + r() * 16, z = 32 + r() * 24; if (!okSpot(x, z)) continue;
    items.push({ x, z, cell: r() < 0.55 ? 15 + Math.floor(r() * 5) : Math.floor(r() * 15), s: 0.6 + r() * 0.5 });
  }
  // distant flower bands
  for (let k = 0; k < 1800; k++) {
    const x = -90 + r() * 180, z = -60 - r() * 30;
    items.push({ x, z, cell: Math.floor(r() * 15), s: 0.9 + r() * 0.6 });
  }
  // tiny flower specks everywhere: the painting's fine-scale texture of white/yellow/pink dots
  const speckTints: [number, number, number][] = [[1, 1, 1], [1, 0.92, 0.45], [1, 0.75, 0.8], [0.75, 0.85, 1], [1, 1, 1]];
  for (let k = 0; k < 15000; k++) {
    const x = -62 + r() * 124, z = -60 + r() * 120; if (!okSpot(x, z)) continue;
    const daisy = r() < 0.7;
    items.push({ x, z, cell: daisy ? Math.floor(r() * 5) : 10 + Math.floor(r() * 5), s: 0.16 + r() * 0.14, tint: daisy ? speckTints[Math.floor(r() * speckTints.length)] : undefined });
  }
  // flower-field rows on the mid-distance slopes
  for (let k = 0; k < 9000; k++) {
    const x = -60 + r() * 120, z = -58 + r() * 60; const fs = fieldStripe(x, z); if (!fs || r() > fs.k) continue;
    if (pathStrength(x, z) > 0.2 || riverInfo(x, z).d < riverHalfAt(x, z) + 1) continue;
    const col = FIELD_COLORS[fs.idx];
    let cell = 0, tint: [number, number, number] | undefined;
    if (col === '#b9a3df' || col === '#c2a6e3') cell = 5 + Math.floor(r() * 3);
    else if (col === '#ec8f70') cell = 10 + Math.floor(r() * 4);
    else if (col === '#efd978' || col === '#f1c45b') { cell = Math.floor(r() * 5); tint = [1, 0.85, 0.3]; }
    else cell = Math.floor(r() * 5);
    items.push({ x, z, cell, s: 0.45 + r() * 0.3, tint });
  }
  // shuffle so quality reduction keeps a uniform subset
  for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
  const flowers = new THREE.InstancedMesh(fg, flowerMat, items.length);
  const aUv = new Float32Array(items.length * 4), aScale = new Float32Array(items.length * 2), aPhase = new Float32Array(items.length), aTint = new Float32Array(items.length * 3);
  const m4 = new THREE.Matrix4();
  items.forEach((it, i) => {
    const col = it.cell % 5, row = Math.floor(it.cell / 5);
    aUv.set([col / 5, 1 - (row + 1) / 4, 1 / 5, 1 / 4], i * 4);
    aScale.set([it.s * cellAspect, it.s], i * 2); aPhase[i] = r() * 6.28; aTint.set(it.tint ?? [1, 1, 1], i * 3);
    m4.makeTranslation(it.x, (it.z < -58 ? baseHeight(it.x, it.z) : groundHeight(it.x, it.z)) - 0.06, it.z); flowers.setMatrixAt(i, m4);
  });
  fg.setAttribute('aUv', new THREE.InstancedBufferAttribute(aUv, 4));
  fg.setAttribute('aScale', new THREE.InstancedBufferAttribute(aScale, 2));
  fg.setAttribute('aPhase', new THREE.InstancedBufferAttribute(aPhase, 1));
  fg.setAttribute('aTint', new THREE.InstancedBufferAttribute(aTint, 3));
  flowers.frustumCulled = false; root.add(flowers);

  const view: WorldView = {
    root, billboards, skyline, sky, flowers, flowerTotal: items.length, water, flowerMat, windmillSails, occluders,
    update(time, camera, yaw, focus) {
      if (focus) flowerMat.uniforms.focusPos.value.copy(focus);
      water.uniforms.time.value = time; flowerMat.uniforms.time.value = time; cloudUniform.value = time;
      flowerMat.uniforms.right.value.set(Math.cos(yaw), 0, -Math.sin(yaw));
      flowerMat.uniforms.camPos.value.copy(camera.position);
      sky.position.copy(camera.position);
      skyline.position.set(camera.position.x, camera.position.y + H / 2 - 18, camera.position.z);
      for (const b of billboards) b.rotation.y = yaw;
    },
    setQuality(q) { flowers.count = Math.floor(items.length * q); },
  };
  return view;
}
