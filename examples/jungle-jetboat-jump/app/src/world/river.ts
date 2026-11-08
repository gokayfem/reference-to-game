import * as THREE from 'three';
import { Course } from '../game/courseProgress';
import { PAL } from './palette';

export interface Frame { x: number; z: number; tx: number; tz: number; rx: number; rz: number; hw: number; y: number }

/** Course sample that extrapolates beyond both ends (for the closed pool walls). */
export function frameAt(course: Course, s: number): Frame {
  const c = course.sampleAt(s);
  const over = s < 0 ? s : s > course.length ? s - course.length : 0;
  return { x: c.x + c.tx * over, z: c.z + c.tz * over, tx: c.tx, tz: c.tz, rx: c.rx, rz: c.rz, hw: c.halfWidth, y: c.waterY };
}

export const WATER_EXTEND = 1.18; // water mesh runs under the banks

/** Shared GLSL: value noise, fbm and a cellular (Voronoi F1/F2) for lacy stylised foam. */
export const WATER_NOISE = /* glsl */`
  float wHash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
  vec2 wHash2(vec2 p){ return fract(sin(vec2(dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3)))) * 43758.5453); }
  float wNoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
    return mix(mix(wHash(i),wHash(i+vec2(1,0)),f.x), mix(wHash(i+vec2(0,1)),wHash(i+vec2(1,1)),f.x), f.y); }
  float wFbm(vec2 p){ float v=0., a=.5; for(int i=0;i<4;i++){ v+=a*wNoise(p); p=p*2.03+vec2(1.7,9.2); a*=.5; } return v; }
  // returns (F1, F2-F1)
  vec2 wCell(vec2 p, float t){
    vec2 i = floor(p), f = fract(p); float f1 = 8.0, f2 = 8.0;
    for (int y=-1; y<=1; y++) for (int x=-1; x<=1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = wHash2(i + g); o = 0.5 + 0.45 * sin(t + 6.2831 * o);
      float d = length(g + o - f);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    }
    return vec2(f1, f2 - f1);
  }
  // lacy foam web: bright along cell borders
  float wLace(vec2 p, float t, float width){ return 1.0 - smoothstep(0.0, width, wCell(p, t).y); }
`;

export const MAX_ROCKS = 8;

export function buildWater(course: Course, quality: 'high' | 'low', rocks: { x: number; z: number; radius: number }[] = []) {
  const s0 = -40, s1 = course.length + 40;
  const cols = quality === 'high' ? 40 : 20;
  const rowStep = quality === 'high' ? 0.75 : 1.5;
  const rows = Math.floor((s1 - s0) / rowStep) + 1;
  const n = rows * (cols + 1);
  const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), foam = new Float32Array(n), lat = new Float32Array(n), tan = new Float32Array(n * 2);
  let p = 0, q = 0, f = 0, t2 = 0;
  for (let i = 0; i < rows; i++) {
    const s = s0 + i * rowStep;
    const fr = frameAt(course, s);
    const slope = Math.max(0, frameAt(course, s - 2).y - frameAt(course, s + 2).y) / 4;
    let churn = 0;
    for (const st of course.rapidSteps) churn = Math.max(churn, s >= st - 2 ? Math.exp(-(s - st + 2) / 4) * 0.42 : 0);
    const jg = course.jump;
    if (s > jg.rampEndS && s < jg.gapEndS + 14) churn = Math.max(churn, s < jg.gapEndS ? 1 : Math.exp(-(s - jg.gapEndS) / 6));
    for (let j = 0; j <= cols; j++) {
      const l = (j / cols * 2 - 1) * WATER_EXTEND;
      const lm = l * fr.hw;
      pos[p++] = fr.x + fr.rx * lm; pos[p++] = fr.y; pos[p++] = fr.z + fr.rz * lm;
      uv[q++] = l; uv[q++] = s;
      lat[f] = lm;
      tan[t2++] = fr.tx; tan[t2++] = fr.tz;
      foam[f++] = Math.min(1, Math.max(slope * 9.0, churn * (0.75 + 0.25 * Math.sin(j * 1.7 + s))));
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < rows - 1; i++) for (let j = 0; j < cols; j++) {
    const a = i * (cols + 1) + j, b = a + 1, c = a + cols + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('aFoam', new THREE.BufferAttribute(foam, 1));
  geo.setAttribute('aLat', new THREE.BufferAttribute(lat, 1));
  geo.setAttribute('aTan', new THREE.BufferAttribute(tan, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();

  const rockArr = Array.from({ length: MAX_ROCKS }, (_, i) => rocks[i] ? new THREE.Vector3(rocks[i].x, rocks[i].z, rocks[i].radius) : new THREE.Vector3(1e6, 1e6, 0));
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color(PAL.waterDeep) },
      uMid: { value: new THREE.Color(PAL.waterMid) },
      uShallow: { value: new THREE.Color(PAL.waterShallow) },
      uCrest: { value: new THREE.Color('#4fd2c9') },
      uFoam: { value: new THREE.Color(PAL.foam) },
      uSkyTop: { value: new THREE.Color(PAL.skyMid) },
      uSkyHor: { value: new THREE.Color('#cdeaf6') },
      uSunDir: { value: new THREE.Vector3(0.45, 0.78, 0.42).normalize() },
      uDetail: { value: quality === 'high' ? 1 : 0 },
      uBoat: { value: new THREE.Vector4(0, 0, 0, 0) },
      uRocks: { value: rockArr },
    },
  ]);
  uniforms.uRocks.value = rockArr; // merge() clones arrays of vectors; keep live refs
  const mat = new THREE.ShaderMaterial({
    uniforms, fog: true,
    vertexShader: /* glsl */`
      attribute float aFoam; attribute float aLat; attribute vec2 aTan;
      uniform float uTime;
      varying vec2 vUv; varying float vFoam; varying vec3 vWorld; varying vec3 vN; varying float vH; varying float vLat;
      #include <fog_pars_vertex>
      // directional waves in river space (lat, s): all travel downstream with the current
      void wave(vec2 p, vec2 d, float len, float amp, float spd, inout float h, inout vec2 g){
        float k = 6.2831 / len; float ph = k * dot(d, p) - uTime * spd * k;
        h += amp * sin(ph); g += amp * k * cos(ph) * d;
      }
      void main(){
        vUv = uv; vFoam = aFoam; vLat = aLat;
        vec2 p = vec2(aLat, uv.y);
        float h = 0.0; vec2 g = vec2(0.0);
        float edge = 1.0 - smoothstep(0.82, 1.08, abs(uv.x));
        float rough = 1.0 + aFoam * 2.5;
        wave(p, normalize(vec2(0.18, 1.0)), 7.5, 0.085 * rough, 1.6, h, g);
        wave(p, normalize(vec2(-0.45, 1.0)), 4.6, 0.055 * rough, 1.9, h, g);
        wave(p, normalize(vec2(0.85, 0.6)), 3.1, 0.032 * rough, 1.3, h, g);
        wave(p, normalize(vec2(-0.9, 0.35)), 2.2, 0.018 * rough, 1.1, h, g);
        h *= edge; g *= edge;
        vH = h / (0.19 * rough);
        vec3 pos3 = position; pos3.y += h;
        // world normal from analytic slopes: right = (-t.y, t.x)
        vec3 T = vec3(aTan.x, 0.0, aTan.y), R = vec3(-aTan.y, 0.0, aTan.x);
        vN = normalize(vec3(0.0, 1.0, 0.0) - R * g.x - T * g.y);
        vec4 wp = modelMatrix * vec4(pos3, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uDeep; uniform vec3 uMid; uniform vec3 uShallow; uniform vec3 uCrest; uniform vec3 uFoam;
      uniform vec3 uSkyTop; uniform vec3 uSkyHor; uniform vec3 uSunDir; uniform float uDetail; uniform vec4 uBoat; uniform vec3 uRocks[${MAX_ROCKS}];
      varying vec2 vUv; varying float vFoam; varying vec3 vWorld; varying vec3 vN; varying float vH; varying float vLat;
      #include <fog_pars_fragment>
      ${WATER_NOISE}
      void main(){
        float l = abs(vUv.x);
        float s = vUv.y;
        vec2 rp = vec2(vLat, s);                 // river-space metres
        vec2 flow = rp - vec2(0.0, uTime * 2.2); // advected with the current
        // micro ripples
        vec2 mp = flow * vec2(0.55, 0.32);
        float m0 = wFbm(mp), mx = wFbm(mp + vec2(0.07, 0.0)), mz = wFbm(mp + vec2(0.0, 0.07));
        vec3 N = normalize(vN + vec3(-(mx - m0), 0.0, -(mz - m0)) * 3.2 * (0.6 + 0.4 * uDetail));
        vec3 V = normalize(cameraPosition - vWorld);
        float ndv = clamp(dot(N, V), 0.0, 1.0);
        // body colour: deep teal channel, turquoise shallows, lighter translucent crests
        float depth = 1.0 - smoothstep(0.0, 0.95, l);
        vec3 c = mix(uShallow, uMid, smoothstep(0.05, 0.5, depth));
        c = mix(c, uDeep, smoothstep(0.45, 1.0, depth) * (0.7 + 0.3 * m0));
        float crest = smoothstep(0.15, 0.9, vH);
        c = mix(c, uCrest, crest * 0.55);
        c *= mix(0.86, 1.06, smoothstep(-0.8, 0.6, vH));
        // sky reflection (Schlick)
        vec3 Rv = reflect(-V, N);
        vec3 sky = mix(uSkyHor, uSkyTop, smoothstep(0.0, 0.45, Rv.y));
        float fres = 0.03 + 0.97 * pow(1.0 - ndv, 5.0);
        c = mix(c, sky, clamp(fres, 0.0, 1.0) * 0.55);
        // sun: broad sheen + tight highlight + twinkling glints
        vec3 Hh = normalize(uSunDir + V);
        float nh = max(dot(N, Hh), 0.0);
        c += vec3(1.0, 0.97, 0.88) * (pow(nh, 60.0) * 0.35 + pow(nh, 600.0) * 2.2) * (0.5 + 0.5 * uDetail);
        vec2 gc = floor(vWorld.xz * 3.0);
        float tw = wHash(gc);
        float glint = step(0.93, tw) * pow(nh, 140.0) * (0.5 + 0.5 * sin(uTime * 9.0 + tw * 40.0));
        c += vec3(1.0) * glint * 3.0 * uDetail;
        // ---- foam ----
        float lace = wLace(flow * vec2(0.9, 0.55), uTime * 0.8, 0.09);
        float laceFine = wLace(flow * vec2(2.2, 1.4) + 13.0, uTime * 1.3, 0.07);
        float breakup = smoothstep(0.35, 0.75, wFbm(flow * 0.35 + 3.0));
        // banks
        float bankBand = smoothstep(0.8, 0.97, l);
        float bank = bankBand * max(lace, laceFine * 0.8) * (0.55 + 0.45 * breakup) + smoothstep(0.93, 1.0, l) * 0.6;
        // wave crests
        float caps = wFbm(flow * vec2(1.6, 1.1) + 7.0);
        float crestFoam = smoothstep(0.78, 1.0, vH) * smoothstep(0.55, 0.75, caps) * 0.75;
        // rapids / cascade whitewater
        // streaky tumbling whitewater (stretched along the flow), denser where the drop is steeper
        float tumble = wFbm(flow * vec2(1.3, 0.38) + vec2(0.0, -uTime * 1.4));
        float streak = wFbm(flow * vec2(3.2, 0.5) + 21.0);
        float white = vFoam * smoothstep(0.62 - vFoam * 0.35, 0.8 - vFoam * 0.3, tumble * 0.65 + streak * 0.45);
        // rings of foam round rocks, trailing downstream
        float rockFoam = 0.0;
        for (int i = 0; i < ${MAX_ROCKS}; i++) {
          vec3 rk = uRocks[i];
          float d = length(vWorld.xz - rk.xy) - rk.z;
          rockFoam = max(rockFoam, (1.0 - smoothstep(0.0, 1.1, d)) * smoothstep(0.3, 0.6, caps + 0.25));
        }
        // hull collar + bow wave, scaled by real boat speed
        vec2 bd = vWorld.xz - uBoat.xy;
        float ch = cos(uBoat.z), sh = sin(uBoat.z);
        vec2 bl = vec2(bd.x * ch - bd.y * sh, bd.x * sh + bd.y * ch); // x = right/left, y = forward
        float e = length(vec2(bl.x / 1.25, (bl.y + 0.2) / 2.15));
        float spd = clamp(uBoat.w / 14.0, 0.0, 1.3);
        float collar = (1.0 - smoothstep(0.92, 1.3, e)) * smoothstep(0.75, 0.95, e) * (0.35 + 0.65 * spd) * smoothstep(0.3, 0.6, caps + 0.2);
        float foamAmt = clamp(max(max(bank, crestFoam), max(white, max(rockFoam, collar))), 0.0, 1.0);
        // foam takes a little sky tint in its shadowed side
        vec3 foamCol = mix(vec3(0.80, 0.93, 0.95), uFoam, 0.6 + 0.4 * ndv);
        c = mix(c, foamCol, foamAmt * 0.95);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = false;
  return { mesh, uniforms };
}

/** Sandy/earth bank ribbons that slope from under the water to the cliff foot. */
export function buildBanks(course: Course) {
  const s0 = -40, s1 = course.length + 40;
  const prof = [ // [lateral offset beyond halfWidth, height above water]
    [-2.2, -0.9], [-0.4, -0.15], [0.8, 0.25], [2.5, 0.6], [4.5, 1.1], [7.0, 1.6], [10, 2.2], [16, 3.0], [26, 4.0],
  ];
  const rows = Math.floor((s1 - s0) / 2) + 1;
  const pos: number[] = [], colr: number[] = [], idx: number[] = [];
  const sand = new THREE.Color(PAL.sand), wet = new THREE.Color('#c77d3c'), soil = new THREE.Color(PAL.bank),
    grass = new THREE.Color(PAL.foliage), grassD = new THREE.Color(PAL.foliageDark);
  const tmp = new THREE.Color();
  for (const side of [-1, 1]) {
    const base = pos.length / 3;
    for (let i = 0; i < rows; i++) {
      const s = s0 + i * 2;
      const fr = frameAt(course, s);
      for (let k = 0; k < prof.length; k++) {
        const [off, h] = prof[k];
        const wob = Math.sin(s * 0.13 + side * 2) * 0.8 + Math.sin(s * 0.41) * 0.4;
        const lat = side * (fr.hw + off + (k > 1 ? wob : 0));
        pos.push(fr.x + fr.rx * lat, fr.y + h + (k > 2 ? Math.sin(s * 0.3 + k) * 0.15 : 0), fr.z + fr.rz * lat);
        const nz = Math.sin(s * 0.21 + k * 1.7) * 0.5 + 0.5;
        if (k <= 1) tmp.copy(wet);
        else if (k === 2) tmp.copy(sand).lerp(soil, 0.35 + nz * 0.3);
        else if (k === 3) tmp.copy(soil).lerp(grassD, 0.35 + nz * 0.35);
        else tmp.copy(grassD).lerp(grass, nz * 0.7).lerp(soil, k > 6 ? 0.25 : 0);
        colr.push(tmp.r, tmp.g, tmp.b);
      }
    }
    const P = prof.length;
    for (let i = 0; i < rows - 1; i++) for (let k = 0; k < P - 1; k++) {
      const a = base + i * P + k, b = a + 1, c = a + P, d = c + 1;
      if (side > 0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}
