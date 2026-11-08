import * as THREE from 'three';
import type { Tex } from '../core/assets';
import { makeBlobShadow } from '../world/scene';
import { surfaceHeight, inWater, waterLevel } from '../world/layout';
import type { SpeciesId } from './state';
import spriteMeta from '../data/sprite-meta.json';

export type ViewSet = 'explorer' | 'quad'; // explorer: front/side/back/back34, quad: front/34/side/back
export type Gait = 'walk' | 'waddle' | 'trot' | 'hop';

/** Per-species rig tuning for the 2.5D sprite deformer. */
export interface RigTuning {
  gait: Gait;
  lean: number;      // shear into screen-space acceleration/velocity
  sway: number;      // secondary motion of the top of the silhouette (hair, leaf cap, petal ears)
  jelly: number;     // squash wobble after landings / stops
  breath: number;    // idle belly breathing
  bob: number;       // gait bounce as a fraction of height
}
const RIGS: Record<string, RigTuning> = {
  explorer: { gait: 'walk', lean: 0.07, sway: 0.05, jelly: 0.25, breath: 0.012, bob: 0.03 },
  leaflet: { gait: 'waddle', lean: 0.1, sway: 0.16, jelly: 1.0, breath: 0.02, bob: 0.05 },
  peach: { gait: 'trot', lean: 0.08, sway: 0.11, jelly: 0.45, breath: 0.015, bob: 0.06 },
  bubble: { gait: 'hop', lean: 0.06, sway: 0.05, jelly: 1.4, breath: 0.025, bob: 0.22 },
  grazer: { gait: 'walk', lean: 0.03, sway: 0.03, jelly: 0.2, breath: 0.01, bob: 0.02 },
  finch: { gait: 'hop', lean: 0.04, sway: 0.04, jelly: 0.6, breath: 0.01, bob: 0.35 },
};

const geoCache = new Map<string, THREE.BufferGeometry>();
/** Bottom-anchored, vertically subdivided card so the vertex shader can bend it. */
function rigGeometry(tex: THREE.Texture, flip: boolean) {
  const key = `${tex.uuid}:${flip}`;
  let g = geoCache.get(key);
  if (!g) {
    const img = tex.image as { width: number; height: number };
    g = new THREE.PlaneGeometry(img.width / img.height, 1, 1, 12);
    g.translate(0, 0.5, 0);
    if (flip) { const uv = g.attributes.uv as THREE.BufferAttribute; for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i)); }
    geoCache.set(key, g);
  }
  return g;
}

function rigMaterial(soft: boolean) {
  return new THREE.ShaderMaterial({
    fog: true, transparent: soft, side: THREE.DoubleSide, depthWrite: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      map: { value: null }, uLean: { value: 0 }, uSway: { value: 0 }, uJelly: { value: 0 }, uBreath: { value: 0 }, uTime: { value: 0 },
      uAlphaTest: { value: soft ? 0.04 : 0.42 }, uTint: { value: new THREE.Color(1, 1, 1) }, uFlash: { value: 0 },
    }]),
    vertexShader: `
      uniform float uLean, uSway, uJelly, uBreath, uTime; varying vec2 vUv;
      #include <fog_pars_vertex>
      void main(){
        vUv = uv;
        vec3 p = position; float h = clamp(p.y, 0.0, 1.0);
        p.x += uLean * h * h;                                         // whole-body shear (inertia / lean)
        p.x += uSway * smoothstep(0.55, 1.0, h) * (h - 0.55) * 2.2;   // lagging top: hair, leaf cap, petal ears
        float belly = sin(h * 3.14159);
        p.x *= 1.0 + uBreath * belly + uJelly * 0.08 * belly;         // breathing + squash bulge
        p.y *= 1.0 - uJelly * 0.06;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform sampler2D map; uniform float uAlphaTest, uFlash; uniform vec3 uTint; varying vec2 vUv;
      #include <fog_pars_fragment>
      void main(){
        vec4 c = texture2D(map, vUv);
        if (c.a < uAlphaTest) discard;
        vec3 col = c.rgb * uTint + uFlash * 0.25;
        gl_FragColor = vec4(col, c.a);
        #include <fog_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** Simple critically-damped-ish spring. */
class Spring { v = 0; x = 0; constructor(public k: number, public c: number) {} step(target: number, dt: number) { this.v += (this.k * (target - this.x) - this.c * this.v) * dt; this.x += this.v * dt; return this.x; } }

/**
 * Directional painted-sprite rig: picks one of the painted views (and walk-cycle frames when available)
 * from the facing relative to the camera, then deforms the card with spring-driven lean, secondary sway,
 * squash/jelly and breathing.
 */
export class Actor {
  readonly group = new THREE.Group();
  readonly sprite: THREE.Mesh;
  readonly shadow: THREE.Mesh;
  readonly mat: THREE.ShaderMaterial;
  pos = new THREE.Vector3();
  prev = new THREE.Vector3();
  vel = new THREE.Vector3();
  facing = 0; // radians, atan2(dx, dz) in world
  walkPhase = 0;
  speed = 0;
  pose: string | null = null;
  hop = 0;
  spin = 0;
  bobOffset = Math.random() * 10;
  hidden = false;
  swims = false;
  air = 0; // extra height for flight arcs
  rig: RigTuning;
  private leanS = new Spring(60, 9); private swayS = new Spring(38, 4.2); private jellyS = new Spring(140, 7);
  private lastVx = 0; private wasMoving = false; private lastHopPhase = 0;
  private scaleFor: Record<string, number>;

  constructor(public id: string, public species: SpeciesId | 'explorer', public height: number, private prefix: string, private views: ViewSet,
    private tex: Tex, scaleFor: Record<string, number> = {}, private soft = false, shadowSize = 0.6) {
    this.scaleFor = { ...scaleFor, ...(spriteMeta as Record<string, number>) };
    this.rig = RIGS[prefix] ?? RIGS.explorer;
    const t = tex[`${prefix}-front`] ?? tex[prefix] ?? tex[`${prefix}-34`];
    this.mat = rigMaterial(soft);
    this.mat.uniforms.map.value = t;
    this.sprite = new THREE.Mesh(rigGeometry(t, false), this.mat);
    this.sprite.renderOrder = 5;
    this.shadow = makeBlobShadow(shadowSize * 1.3, shadowSize * 0.7);
    this.group.add(this.sprite);
    this.sprite.userData.actor = this;
  }

  place(x: number, z: number) { this.pos.set(x, surfaceHeight(x, z), z); this.prev.copy(this.pos); }

  private pickView(camYaw: number, moving: boolean): { key: string; flip: boolean } {
    const rel = wrap(this.facing - camYaw);
    if (this.pose) return { key: this.pose, flip: !(Math.sin(rel) >= 0) }; // action poses painted facing right
    const a = wrap(Math.PI - rel); // 0 = away from camera, +PI/2 = screen right
    const ab = Math.abs(a), flip = a < 0;
    const P = this.prefix;
    let view: string, f = flip;
    if (this.views === 'explorer') {
      if (ab < 0.39) { view = 'back'; f = false; } else if (ab < 1.18) view = 'back34'; else if (ab < 1.96) view = 'side'; else if (ab < 2.75) view = 'front34'; else { view = 'front'; f = false; }
    } else {
      if (ab < 0.6) { view = 'back'; f = false; } else if (ab < 1.96) view = 'side'; else if (ab < 2.75) view = '34'; else { view = 'front'; f = false; }
    }
    // painted walk-cycle frames when moving (4 frames per stride pair)
    let walkKey = `${P}-walk-${view}-0`;
    // round creatures read the same from side and 3/4: reuse the 3/4 cycle when no side cycle exists
    if (moving && !this.tex[walkKey] && view === 'side' && this.tex[`${P}-walk-34-0`]) { view = '34'; walkKey = `${P}-walk-34-0`; }
    if (moving && !this.tex[walkKey] && view === '34' && this.tex[`${P}-walk-front-0`]) { view = 'front'; f = false; walkKey = `${P}-walk-front-0`; }
    if (moving && this.tex[walkKey]) {
      const idx = Math.floor(this.walkPhase / (this.rig.gait === 'hop' ? Math.PI / 4 : Math.PI / 2)) % 4; // hop sheets = one hop per 4 frames
      return { key: `${P}-walk-${view}-${idx}`, flip: f };
    }
    return { key: `${P}-${view}`, flip: f };
  }

  render(alpha: number, time: number, camYaw: number, dt = 1 / 60) {
    const x = this.prev.x + (this.pos.x - this.prev.x) * alpha;
    const z = this.prev.z + (this.pos.z - this.prev.z) * alpha;
    let y = surfaceHeight(x, z);
    const wet = this.swims && inWater(x, z);
    if (wet) y = waterLevel(x, z) - this.height * 0.28;
    this.group.position.set(x, y, z);
    this.group.visible = !this.hidden;
    const moving = this.speed > 0.15;
    const v = this.pickView(camYaw, moving && !this.pose);
    const painted = v.key.includes('-walk-');
    const t = this.tex[v.key];
    this.sprite.geometry = rigGeometry(t, v.flip);
    this.mat.uniforms.map.value = t;
    const s = this.height * (this.scaleFor[v.key] ?? 1);
    const R = this.rig;

    // ---- gait (procedural layer on top of painted frames)
    let bob = 0, roll = 0, sy = 1, sx = 1;
    const ph = this.walkPhase;
    if (moving) {
      if (R.gait === 'walk') { bob = Math.abs(Math.sin(ph)) * R.bob; roll = Math.sin(ph) * 0.03; }
      else if (R.gait === 'waddle') { bob = Math.abs(Math.sin(ph)) * R.bob; roll = Math.sin(ph) * 0.12; }
      else if (R.gait === 'trot') { bob = Math.abs(Math.sin(ph * 1.0)) * R.bob; roll = Math.sin(ph) * 0.025; }
      else if (painted) { // painted hop frames carry the jump; keep landing jelly
        const hp = (ph / Math.PI) % 1; if (hp < this.lastHopPhase) this.jellyS.v -= 4 * R.jelly; this.lastHopPhase = hp;
      }
      else { // hop: airborne arcs with squash on landing
        const hp = (ph / Math.PI) % 1; bob = Math.sin(hp * Math.PI) * R.bob;
        sy = 1 + Math.sin(hp * Math.PI) * 0.08; sx = 1 - Math.sin(hp * Math.PI) * 0.05;
        if (hp < this.lastHopPhase) this.jellyS.v -= 6 * R.jelly; // landing impulse
        this.lastHopPhase = hp;
      }
    } else {
      const b = Math.sin((time + this.bobOffset) * 2.2);
      sy = 1 + b * R.breath * 0.6; sx = 1 - b * R.breath * 0.3;
    }
    if (this.wasMoving && !moving) this.jellyS.v += 5 * R.jelly; // stop: settle wobble
    this.wasMoving = moving;
    if (this.hop > 0) {
      const hp = this.hop; bob += Math.sin(hp * Math.PI) * 0.35;
      sy *= 1 + Math.sin(hp * Math.PI * 2) * 0.07;
      if (hp > 0.92) this.jellyS.v -= 3 * R.jelly;
    }

    // ---- springs driven by screen-space motion
    const right = new THREE.Vector3(Math.cos(camYaw), 0, -Math.sin(camYaw));
    const vx = this.vel.dot(right);
    const ax = (vx - this.lastVx) / Math.max(dt, 1e-3); this.lastVx = vx;
    const leanTarget = THREE.MathUtils.clamp(vx * 0.35 - ax * 0.06, -2.2, 2.2) * R.lean;
    const lean = this.leanS.step(leanTarget, dt);
    const sway = this.swayS.step(-lean * 2.2 + (moving ? Math.sin(ph * 2) * 0.02 : Math.sin(time * 1.3 + this.bobOffset) * 0.012), dt) * (R.sway / 0.1);
    const jelly = this.jellyS.step(0, dt);
    // v.flip mirrors UVs only, so shear stays in screen space (no sign change needed)
    this.mat.uniforms.uLean.value = lean;
    this.mat.uniforms.uSway.value = sway * 0.1;
    this.mat.uniforms.uJelly.value = THREE.MathUtils.clamp(jelly * 0.12, -0.6, 0.6);
    this.mat.uniforms.uBreath.value = moving ? 0 : Math.sin((time + this.bobOffset) * 2.2) * R.breath;
    this.mat.uniforms.uTime.value = time;

    const bobM = bob * this.height + this.air;
    this.sprite.scale.set(s * sx, s * sy, s);
    this.sprite.position.y = bobM - 0.03 * this.height;
    this.sprite.rotation.set(0, camYaw, roll + Math.sin(this.spin * Math.PI * 2) * 0.25);
    this.shadow.position.set(x, (wet ? waterLevel(x, z) : surfaceHeight(x, z)) + 0.05, z + 0.05);
    this.shadow.visible = !this.hidden;
    const shrink = 1 - Math.min(0.5, bobM / Math.max(0.2, this.height));
    this.shadow.scale.set(this.height * 1.0 * shrink, 1, this.height * 0.5 * shrink);
  }
  center(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + this.air + this.height * 0.5, this.pos.z); }
}

export function wrap(a: number) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }

export function makeExplorer(tex: Tex) {
  return new Actor('explorer', 'explorer', 1.45, 'explorer', 'explorer', tex, { 'explorer-offer': 0.74, 'explorer-camera': 0.97, 'explorer-flute': 0.99, 'explorer-point': 1.0 }, false, 0.75);
}
export function makeCompanion(id: string, species: SpeciesId, tex: Tex): Actor {
  if (species === 'leaflet') return new Actor(id, species, 0.62, 'leaflet', 'quad', tex, {}, false, 0.5);
  if (species === 'bloomble') return new Actor(id, species, 0.7, 'peach', 'quad', tex, {}, false, 0.55);
  const a = new Actor(id, species, 0.5, 'bubble', 'quad', tex, {}, true, 0.5); a.swims = true; return a;
}
