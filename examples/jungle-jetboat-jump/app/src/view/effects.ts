import * as THREE from 'three';
import { BoatState, forwardOf, rightOf } from '../game/boat';
import { WATER_NOISE } from '../world/river';

const NOISE = /* glsl */`
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
  float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
  float fbm(vec2 p){ float v=0., a=.5; for(int i=0;i<4;i++){ v+=a*noise(p); p*=2.1; a*=.5; } return v; }`;

/** Foam wake ribbon following the boat's actual travelled path (pooled ring buffer; cleared on teleport). */
export class Wake {
  readonly mesh: THREE.Mesh;
  private max = 140;
  private pts: { x: number; y: number; z: number; px: number; pz: number; born: number; speed: number }[] = [];
  private geo: THREE.BufferGeometry;
  private pos: Float32Array; private aux: Float32Array;
  private lastX = NaN; private lastZ = NaN;
  readonly uniforms = { uTime: { value: 0 } };

  constructor() {
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.max * 2 * 3);
    this.aux = new Float32Array(this.max * 2 * 3); // side, age, strength
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aux', new THREE.BufferAttribute(this.aux, 3).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < this.max - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    this.geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      vertexShader: `attribute vec3 aux; varying vec3 vAux; void main(){ vAux = aux; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `uniform float uTime; varying vec3 vAux; ${NOISE} ${WATER_NOISE}
        void main(){
          float side = vAux.x; float age = vAux.y; float str = vAux.z;
          float n = fbm(vec2(side*5.0, age*26.0 - uTime*0.7));
          float n2 = fbm(vec2(side*13.0 + 5.0, age*60.0));
          // two foamy V arms with lacy breakup, turbulent centre behind the jet
          float arm = smoothstep(0.4, 0.66, abs(side)) * (1.0 - smoothstep(0.66, 0.93, abs(side)));
          float lace = smoothstep(0.5, 0.66, n * 0.7 + n2 * 0.5);
          float centre = (1.0 - smoothstep(0.0, 0.4, abs(side))) * smoothstep(0.35, 0.7, n) * (1.0 - age) * (1.0 - age);
          float a = max(arm * lace, centre * 0.95);
          // fizzing bubbles left in the churned water
          vec2 bc = wCell(vec2(side * 7.0, age * 70.0), uTime * 2.0);
          float bub = (1.0 - smoothstep(0.08, 0.16, bc.x)) * smoothstep(0.1, 0.0, bc.x - 0.05) ;
          a = max(a, bub * (1.0 - age) * (1.0 - smoothstep(0.75, 0.95, abs(side))) * 0.85);
          a *= (1.0 - smoothstep(0.0, 1.0, age)) * str * (1.0 - smoothstep(0.92, 1.0, abs(side)));
          if (a < 0.02) discard;
          gl_FragColor = vec4(vec3(0.97,1.0,1.0), clamp(a*0.75,0.,0.85));
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  clear() { this.pts = []; this.lastX = NaN; this.geo.setDrawRange(0, 0); }

  update(b: BoatState, waterY: number, t: number) {
    this.uniforms.uTime.value = t;
    const f = forwardOf(b.heading);
    const sx = b.x - f.x * 1.6, sz = b.z - f.z * 1.6;
    if (!b.airborne && Math.abs(b.speed) > 1.2) {
      if (isNaN(this.lastX) || Math.hypot(sx - this.lastX, sz - this.lastZ) > 0.6) {
        this.pts.unshift({ x: sx, y: waterY + 0.06, z: sz, px: -f.z, pz: f.x, born: t, speed: Math.min(1, Math.abs(b.speed) / 14) });
        if (this.pts.length > this.max) this.pts.pop();
        this.lastX = sx; this.lastZ = sz;
      }
    } else if (b.airborne) { this.lastX = NaN; }
    const life = 3.2;
    let n = 0;
    for (let i = 0; i < this.pts.length; i++) {
      const p = this.pts[i];
      const age = (t - p.born) / life;
      if (age > 1) break;
      const w = 1.0 + age * 4.5 * p.speed;
      for (const side of [-1, 1]) {
        const k = (n * 2 + (side > 0 ? 1 : 0));
        this.pos[k * 3] = p.x + p.px * w * side; this.pos[k * 3 + 1] = p.y; this.pos[k * 3 + 2] = p.z + p.pz * w * side;
        this.aux[k * 3] = side; this.aux[k * 3 + 1] = age; this.aux[k * 3 + 2] = p.speed * (i === 0 ? 0 : 1);
      }
      n++;
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.aux.needsUpdate = true;
    this.geo.setDrawRange(0, Math.max(0, (n - 1) * 6));
  }
}

/** Pooled spray (rooster-tail foam clumps, chine sheets, sparkling droplets, bursts). Visual only — never touches rules. */
export class Spray {
  readonly points: THREE.Points;
  private n: number;
  private p: Float32Array; private v: Float32Array; private life: Float32Array; private size: Float32Array; private seed: Float32Array; private max: Float32Array;
  private cursor = 0; private acc = 0;
  constructor(count = 3200) {
    this.n = count;
    this.p = new Float32Array(count * 3); this.v = new Float32Array(count * 3);
    this.life = new Float32Array(count); this.size = new Float32Array(count); this.seed = new Float32Array(count); this.max = new Float32Array(count).fill(1);
    for (let i = 0; i < count; i++) this.seed[i] = Math.random();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('life', new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('seed', new THREE.BufferAttribute(this.seed, 1));
    g.setAttribute('maxLife', new THREE.BufferAttribute(this.max, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uScale: { value: 600 }, uSun: { value: new THREE.Vector3(0.45, 0.78, 0.42) } },
      vertexShader: `attribute float life; attribute float size; attribute float seed; attribute float maxLife; uniform float uScale;
        varying float vL; varying float vNear; varying float vSeed; varying float vBig;
        void main(){ float k = clamp(life / maxLife, 0., 1.); vL = k; vSeed = seed; vBig = step(0.13, size);
          vec4 mv = modelViewMatrix*vec4(position,1.); gl_Position = projectionMatrix*mv;
          vNear = smoothstep(1.2, 3.0, -mv.z);
          float grow = mix(1.35, 0.8, k); // clumps expand as they age
          gl_PointSize = life > 0.0 ? min(size * grow * uScale / -mv.z, 90.0) : 0.0; }`,
      fragmentShader: `varying float vL; varying float vNear; varying float vSeed; varying float vBig;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + vSeed*91.7) * 43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        void main(){
          vec2 c = gl_PointCoord - 0.5; float d = length(c);
          float a;
          vec3 col;
          if (vBig > 0.5) {
            // lumpy foam clump with a lit top and cool shaded underside
            float lump = n(c*5.0 + vSeed*7.0)*0.55 + n(c*11.0 - vSeed*3.0)*0.3;
            float edge = 0.5 - d*1.0 + (lump - 0.42)*0.18;
            a = smoothstep(0.0, 0.3, edge);
            float shade = clamp(0.5 - c.y*1.2 + c.x*0.4, 0., 1.);
            col = mix(vec3(0.70,0.86,0.90), vec3(1.0), smoothstep(0.25, 0.75, shade + lump*0.25));
            a *= 0.55;
          } else {
            if (d > 0.5) discard;
            a = smoothstep(0.5, 0.18, d);
            col = mix(vec3(0.82,0.95,0.98), vec3(1.0), smoothstep(0.4, 0.05, d));
          }
          a *= smoothstep(0.0, vBig > 0.5 ? 0.6 : 0.35, vL) * vNear;
          if (a < 0.02) discard;
          gl_FragColor = vec4(col, a);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }
  setPixelScale(h: number) { (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = h * 0.6; }
  clear() { this.life.fill(0); }
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life = 1) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.n;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.life[i] = life; this.max[i] = life; this.size[i] = size;
  }
  burst(x: number, y: number, z: number, n: number, power: number) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, sp = (0.4 + Math.random()) * power;
      const big = k % 3 === 0;
      this.emit(x, y, z, Math.cos(a) * sp, 2 + Math.random() * power, Math.sin(a) * sp,
        big ? 0.4 + Math.random() * 0.6 : 0.05 + Math.random() * 0.12, big ? 0.6 + Math.random() * 0.4 : 0.8 + Math.random() * 0.6);
    }
  }
  update(b: BoatState, waterY: number, dt: number, quality: number) {
    const sp = Math.abs(b.speed);
    if (!b.airborne && sp > 1.5 && b.y < waterY + 0.3) {
      const f = forwardOf(b.heading), r = rightOf(b.heading);
      const k = Math.min(1.3, sp / 14);
      this.acc += dt * (90 + sp * 70) * quality * (b.boosting ? 1.5 : 1);
      while (this.acc > 1) {
        this.acc -= 1;
        const kind = Math.random();
        const rnd = Math.random;
        if (kind < 0.34) {
          // rooster-tail crest: big foam clumps thrown up and back from the jet
          const sx = b.x - f.x * 2.05 + r.x * (rnd() - 0.5) * 1.0, sz = b.z - f.z * 2.05 + r.z * (rnd() - 0.5) * 1.0;
          const back = -(1.5 + rnd() * 2.5), up = (1.0 + rnd() * 2.2) * (0.5 + k * 0.6), lat = (rnd() - 0.5) * 3.4 + b.steer * -1.5;
          this.emit(sx, waterY + 0.2, sz, f.x * (sp * 0.55 + back) + r.x * lat, up, f.z * (sp * 0.55 + back) + r.z * lat,
            (0.2 + rnd() * 0.32) * (0.6 + k * 0.5), 0.3 + rnd() * 0.3);
        } else if (kind < 0.62) {
          // chine sheets: medium clumps peeling off both sides, heavier on the outside of a turn
          const outer = -b.steer;
          const side = rnd() < 0.5 + outer * 0.3 ? 1 : -1;
          const along = -1.7 + rnd() * 1.6;
          const sx = b.x + f.x * along + r.x * side * 1.05, sz = b.z + f.z * along + r.z * side * 1.05;
          const out = 1.8 + rnd() * 2.6 + Math.max(0, outer * side) * 4.5;
          this.emit(sx, waterY + 0.12, sz, f.x * sp * 0.5 + r.x * side * out, 1.0 + rnd() * 2.0 + Math.max(0, outer * side) * 1.5, f.z * sp * 0.5 + r.z * side * out,
            rnd() < 0.5 ? (0.14 + rnd() * 0.18) * (0.6 + k * 0.5) : 0.05 + rnd() * 0.08, 0.35 + rnd() * 0.3);
        } else {
          // sparkling droplets flung high
          const side = rnd() < 0.5 ? -1 : 1;
          const sx = b.x - f.x * (0.5 + rnd() * 1.6) + r.x * side * 1.0, sz = b.z - f.z * (0.5 + rnd() * 1.6) + r.z * side * 1.0;
          const out = 1.0 + rnd() * 4.0;
          this.emit(sx, waterY + 0.3, sz, f.x * sp * 0.6 + r.x * side * out, 2.5 + rnd() * 4.0 * k, f.z * sp * 0.6 + r.z * side * out, 0.035 + rnd() * 0.07, 0.7 + rnd() * 0.6);
        }
      }
    }
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const drag = this.size[i] > 0.2 ? Math.exp(-dt * 1.6) : Math.exp(-dt * 0.4);
      this.v[i * 3] *= drag; this.v[i * 3 + 2] *= drag;
      this.v[i * 3 + 1] -= (this.size[i] > 0.13 ? 7.5 : 9.8) * dt;
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      if (this.p[i * 3 + 1] < waterY - (this.size[i] > 0.13 ? 0.05 : 0.3)) this.life[i] = 0;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.life.needsUpdate = true; g.attributes.size.needsUpdate = true; g.attributes.maxLife.needsUpdate = true;
  }
}
