// Purple toy robots: rounded shell, cyan eyes, fin ears. Type is readable by silhouette and motion.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Robot } from '../game/game';
import { robotCenter } from '../game/game';
import type { EnemyType } from '../game/level';

const shellMat = () => new THREE.MeshPhysicalMaterial({ color: '#9350d2', roughness: 0.3, metalness: 0.05, clearcoat: 0.9, clearcoatRoughness: 0.2, emissive: '#5a2a8c', emissiveIntensity: 0.22, sheen: 0.4, sheenColor: new THREE.Color('#c9a0ff') });
const visorMat = new THREE.MeshPhysicalMaterial({ color: '#6a34a6', roughness: 0.22, clearcoat: 1, emissive: '#3a1670', emissiveIntensity: 0.35 });
const jointMat = new THREE.MeshStandardMaterial({ color: '#3b3e4a', roughness: 0.5, metalness: 0.5 });
const springMat = new THREE.MeshStandardMaterial({ color: '#9aa3b0', roughness: 0.3, metalness: 0.8 });
const greenMat = new THREE.MeshStandardMaterial({ color: '#4fae3a', roughness: 0.45 });
const orangeMat = new THREE.MeshStandardMaterial({ color: '#f26c1c', roughness: 0.35, emissive: '#ff5a00', emissiveIntensity: 0.25 });

const sphere = new THREE.SphereGeometry(1, 32, 24);
const eyeGeo = new THREE.SphereGeometry(1, 16, 12);
const finGeo = new THREE.ConeGeometry(0.13, 0.42, 4);
const limbGeo = new THREE.CapsuleGeometry(0.07, 0.24, 4, 8);
const footGeo = new RoundedBoxGeometry(0.24, 0.13, 0.32, 2, 0.05);
const handGeo = new RoundedBoxGeometry(0.19, 0.17, 0.2, 2, 0.06);
const springGeo = (() => {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 80; i++) { const a = i / 80 * Math.PI * 10; pts.push(new THREE.Vector3(Math.cos(a) * 0.08, i / 80 * 0.36, Math.sin(a) * 0.08)); }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, 0.018, 6, false);
})();

const barrierMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  uniforms: { t: { value: 0 }, hit: { value: 0 } },
  vertexShader: 'varying vec3 vN; varying vec3 vV; varying vec2 vUv; void main(){ vUv = uv; vec4 wp = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-wp.xyz); gl_Position = projectionMatrix * wp; }',
  fragmentShader: 'uniform float t; uniform float hit; varying vec3 vN; varying vec3 vV; varying vec2 vUv; void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 2.0); float hex = 0.5 + 0.5*sin(vUv.y*60.0 + t*3.0); float edge = smoothstep(0.0,0.08,vUv.x)*smoothstep(1.0,0.92,vUv.x); vec3 c = vec3(0.35,0.95,1.0); float a = (0.14 + f*0.55 + hex*0.06 + hit*0.5) * edge; gl_FragColor = vec4(c*(0.7+hit), a);\n#include <colorspace_fragment>\n}',
});

// ---------------------------------------------------------------------------------------------
// Sculpted robot meshes (fal). One static mesh per type, normalised to feet at y=0 facing +Z, animated by a small
// vertex-shader rig: legs (below hipY) swing/compress, arms (|x| beyond shoulderX, above hipY) raise for the telegraph.
export interface RobotModelDef { scene: THREE.Object3D; height: number; hipY: number; shoulderX: number }
const robotModels: Partial<Record<EnemyType, RobotModelDef>> = {};
export function setRobotModel(type: EnemyType, def: RobotModelDef) { robotModels[type] = def; }

interface RigUniforms { uWalk: { value: number }; uAmp: { value: number }; uArm: { value: number }; uSquash: { value: number }; uHip: { value: number }; uShoulder: { value: number } }

function rigMaterial(src: THREE.MeshStandardMaterial, u: RigUniforms) {
  const mat = new THREE.MeshPhysicalMaterial({ map: src.map, roughness: 0.3, metalness: 0.05, clearcoat: 0.85, clearcoatRoughness: 0.18, sheen: 0.3, sheenColor: new THREE.Color('#d2b0ff'), emissive: '#2a1046', emissiveIntensity: 0.35 });
  if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'uniform float uWalk; uniform float uAmp; uniform float uArm; uniform float uSquash; uniform float uHip; uniform float uShoulder;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
      vec3 transformed = vec3( position );
      float side = sign(transformed.x);
      // legs: stride shear + squash toward the hip
      if (transformed.y < uHip) {
        float k = (uHip - transformed.y) / uHip;
        transformed.z += sin(uWalk + (side > 0.0 ? 0.0 : 3.14159)) * uAmp * k;
        transformed.y = uHip - (uHip - transformed.y) * uSquash;
      }
      // arms: raise forward for the attack telegraph
      float ax = abs(transformed.x) - uShoulder;
      if (ax > 0.0 && transformed.y > uHip && transformed.y < uHip * 2.4) {
        float a = uArm * 1.1 * min(1.0, ax * 6.0);
        float y0 = transformed.y - uHip * 1.9;
        transformed.z += sin(a) * (y0 < 0.0 ? -y0 : 0.0) + a * ax * 0.6;
        transformed.y += (1.0 - cos(a)) * (y0 < 0.0 ? -y0 : 0.0) * 0.8;
      }
      `);
  };
  mat.customProgramCacheKey = () => 'robotRig';
  return mat;
}

export interface RobotMesh { group: THREE.Group; body: THREE.Group; shell: THREE.MeshPhysicalMaterial; eyes: THREE.MeshBasicMaterial; legs: THREE.Object3D[]; arms: THREE.Object3D[]; barrier?: THREE.Mesh; barrierMat?: THREE.ShaderMaterial; charge: THREE.Mesh; type: EnemyType; rig?: RigUniforms; holder?: THREE.Group }

export function buildRobot(type: EnemyType): RobotMesh {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const shell = shellMat();
  const eyes = new THREE.MeshBasicMaterial({ color: '#58fff4' });
  const R = type === 'shield' ? 0.6 : type === 'jumper' ? 0.48 : 0.52;
  const cy = type === 'shield' ? 0.9 : type === 'jumper' ? 0.95 : 0.86;
  body.position.y = cy;
  const hull = new THREE.Mesh(sphere, shell); hull.scale.set(R * (type === 'shield' ? 1.12 : 1), R * 0.98, R); hull.castShadow = true; body.add(hull);
  // dark face visor and panel seam
  const visor = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16, Math.PI / 2 - 0.8, 1.6, 1.05, 0.62), visorMat); visor.scale.setScalar(R * 1.012); body.add(visor);
  const seam = new THREE.Mesh(new THREE.TorusGeometry(R * 1.0, 0.018, 6, 40), jointMat); seam.rotation.x = Math.PI / 2; seam.position.y = -R * 0.18; body.add(seam);
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyes); eye.scale.set(0.085, 0.12, 0.05); eye.position.set(s * R * 0.33, R * 0.12, R * 0.93); eye.rotation.y = s * 0.35; body.add(eye);
    const fin = new THREE.Mesh(finGeo, shell); fin.position.set(s * R * 0.9, R * 0.55, -R * 0.1); fin.rotation.z = -s * 1.0; fin.castShadow = true; body.add(fin);
    const shoulder = new THREE.Mesh(sphere, jointMat); shoulder.scale.setScalar(0.11); shoulder.position.set(s * R * 0.98, -R * 0.15, R * 0.1); body.add(shoulder);
  }
  // arms (pivot at shoulder)
  const arms: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(s * R * 1.02, cy - R * 0.15, R * 0.1);
    const upper = new THREE.Mesh(limbGeo, jointMat); upper.position.set(s * 0.15, -0.1, 0.06); upper.rotation.z = s * 0.95; arm.add(upper);
    const hand = new THREE.Mesh(handGeo, shell); hand.position.set(s * 0.3, -0.2, 0.14); hand.castShadow = true; arm.add(hand);
    group.add(arm); arms.push(arm);
  }
  // legs
  const legs: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(s * R * 0.42, cy - R * 0.8, 0);
    const hipLen = cy - R * 0.8;
    if (type === 'jumper') {
      const spring = new THREE.Mesh(springGeo, springMat); spring.position.y = -hipLen; spring.scale.y = hipLen / 0.36; leg.add(spring);
      const foot = new THREE.Mesh(footGeo, greenMat); foot.position.set(0, -hipLen + 0.04, 0.04); leg.add(foot);
    } else {
      const shin = new THREE.Mesh(limbGeo, jointMat); shin.position.y = -hipLen / 2; shin.scale.y = hipLen / 0.37; leg.add(shin);
      const foot = new THREE.Mesh(footGeo, type === 'shield' ? shell : shell); foot.position.set(0, -hipLen + 0.05, 0.05); foot.scale.set(type === 'shield' ? 1.25 : 1, 1, 1); foot.castShadow = true; leg.add(foot);
    }
    group.add(leg); legs.push(leg);
  }
  let barrier: THREE.Mesh | undefined, bMat: THREE.ShaderMaterial | undefined;
  if (type === 'shield') {
    const emitter = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.06, 24), orangeMat); emitter.rotation.x = Math.PI / 2; emitter.position.set(0, -R * 0.25, R * 1.02); body.add(emitter);
    bMat = barrierMat.clone();
    // 120-degree forward barrier matching the rule arc
    barrier = new THREE.Mesh(new THREE.SphereGeometry(0.98, 32, 16, Math.PI / 2 - Math.PI / 3, (2 * Math.PI) / 3, Math.PI * 0.12, Math.PI * 0.72), bMat);
    // SphereGeometry phi = PI/2 points +Z, so the arc is centred on the robot's forward axis
    barrier.position.y = cy; group.add(barrier);
  }
  if (type === 'jumper') { for (const s of [-1, 1]) { const stripe = new THREE.Mesh(new THREE.TorusGeometry(R * 0.5, 0.03, 6, 24), greenMat); stripe.position.set(s * R * 0.62, -R * 0.35, 0); stripe.rotation.y = Math.PI / 2; body.add(stripe); } }
  const charge = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), new THREE.MeshBasicMaterial({ color: '#ff8a3c', transparent: true, opacity: 0.9 }));
  charge.position.set(0, cy - 0.05, R + 0.3); charge.visible = false; group.add(charge);
  const def = robotModels[type];
  let rig: RigUniforms | undefined;
  if (def) {
    // swap the primitive body for the sculpted mesh; keep barrier/charge/hitbox conventions
    body.visible = false; legs.forEach((l) => (l.visible = false)); arms.forEach((a) => (a.visible = false));
    rig = { uWalk: { value: 0 }, uAmp: { value: 0 }, uArm: { value: 0 }, uSquash: { value: 1 }, uHip: { value: def.hipY }, uShoulder: { value: def.shoulderX } };
    const model = def.scene.clone(true);
    let mainMat: THREE.MeshPhysicalMaterial | undefined;
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.material = rigMaterial(m.material as THREE.MeshStandardMaterial, rig!);
      mainMat = m.material as THREE.MeshPhysicalMaterial;
      m.castShadow = true; m.receiveShadow = false;
    });
    const holder = new THREE.Group(); holder.name = 'sculpt'; holder.add(model); group.add(holder);
    return { group, body, shell: mainMat ?? shell, eyes, legs, arms, barrier, barrierMat: bMat, charge, type, rig, holder };
  }
  return { group, body, shell, eyes, legs, arms, barrier, barrierMat: bMat, charge, type };
}

/** Pooled toy-part debris for defeats. */
export class Debris {
  parts: { m: THREE.Mesh; v: THREE.Vector3; w: THREE.Vector3; life: number }[] = [];
  constructor(private root: THREE.Object3D) {}
  burst(x: number, y: number, z: number) {
    const shell = shellMat();
    const pieces: THREE.BufferGeometry[] = [new THREE.SphereGeometry(0.2, 14, 8, 0, Math.PI), new THREE.SphereGeometry(0.19, 14, 8, Math.PI, Math.PI), finGeo, handGeo, footGeo];
    pieces.forEach((g, i) => {
      const m = new THREE.Mesh(g, i < 3 ? shell : jointMat);
      m.position.set(x, y, z); m.castShadow = true;
      const a = (i / pieces.length) * Math.PI * 2;
      this.parts.push({ m, v: new THREE.Vector3(Math.cos(a) * 2.2, 3 + i * 0.4, Math.sin(a) * 2.2), w: new THREE.Vector3(Math.random() * 8, Math.random() * 8, 0), life: 1.6 });
      this.root.add(m);
    });
  }
  update(dt: number, floorY: number) {
    for (const p of this.parts) {
      p.life -= dt;
      p.v.y -= 14 * dt;
      p.m.position.addScaledVector(p.v, dt);
      if (p.m.position.y < floorY + 0.1) { p.m.position.y = floorY + 0.1; p.v.y *= -0.35; p.v.x *= 0.6; p.v.z *= 0.6; p.w.multiplyScalar(0.6); }
      p.m.rotation.x += p.w.x * dt; p.m.rotation.y += p.w.y * dt;
      if (p.life < 0.5) p.m.scale.setScalar(Math.max(0.01, p.life / 0.5));
      if (p.life <= 0) { this.root.remove(p.m); if (p.m.geometry.type === 'SphereGeometry' && (p.m.geometry as THREE.SphereGeometry).parameters.radius < 0.21) p.m.geometry.dispose(); }
    }
    this.parts = this.parts.filter((p) => p.life > 0);
  }
  clear() { for (const p of this.parts) this.root.remove(p.m); this.parts = []; }
}

export class RobotViews {
  map = new Map<string, RobotMesh>();
  constructor(private root: THREE.Object3D) {}
  sync(robots: Robot[], alpha: number, t: number) {
    const seen = new Set<string>();
    for (const r of robots) {
      seen.add(r.id);
      let v = this.map.get(r.id);
      if (!v) { v = buildRobot(r.type); this.map.set(r.id, v); this.root.add(v.group); }
      v.group.visible = !r.defeated;
      if (r.defeated) continue;
      const x = r.px + (r.x - r.px) * alpha, y = r.py + (r.y - r.py) * alpha, z = r.pz + (r.z - r.pz) * alpha;
      v.group.position.set(x, y, z);
      v.group.rotation.y = r.yaw;
      const phase = t * 6 + (r.seed % 10);
      let squash = 1, lean = 0;
      if (r.state === 'windup') squash = 1 - 0.35 * Math.min(1, (0.55 - r.t) / 0.4);
      if (r.state === 'land') squash = 1 - 0.25 * Math.max(0, (r.t - 0.55) / 0.25);
      if (r.state === 'telegraph') lean = -0.18;
      if (r.state === 'stagger') lean = 0.25;
      const walking = r.state === 'move';
      v.body.position.y = (r.type === 'shield' ? 0.9 : r.type === 'jumper' ? 0.95 : 0.86) * (r.type === 'jumper' ? squash : 1) + (walking ? Math.abs(Math.sin(phase)) * 0.04 : Math.sin(t * 2 + r.seed) * 0.015);
      v.body.rotation.x = lean;
      v.legs.forEach((l, i) => { l.scale.y = r.type === 'jumper' ? squash : 1; l.rotation.x = walking ? Math.sin(phase + i * Math.PI) * 0.4 : 0; });
      v.arms.forEach((a, i) => { a.rotation.x = r.state === 'telegraph' ? -1.1 : walking ? Math.sin(phase + i * Math.PI) * 0.35 : -0.2; });
      const tele = r.state === 'telegraph';
      v.eyes.color.set(tele ? '#fff3a0' : '#58fff4');
      if (v.rig && v.holder) {
        // sculpted mesh animation driven by the same AI state
        v.rig.uWalk.value = phase * 1.4;
        v.rig.uAmp.value += ((walking ? 0.09 : 0) - v.rig.uAmp.value) * 0.2;
        v.rig.uArm.value += ((r.state === 'telegraph' ? 1 : 0) - v.rig.uArm.value) * 0.18;
        v.rig.uSquash.value = r.type === 'jumper' ? squash : 1;
        const bob = walking ? Math.abs(Math.sin(phase)) * 0.035 : Math.sin(t * 2 + r.seed) * 0.012;
        v.holder.position.y = bob - (r.type === 'jumper' ? (1 - squash) * 0.12 : 0);
        const kick = r.flash > 0 ? Math.sin((0.12 - r.flash) / 0.12 * Math.PI) * 0.12 : 0; // hit wobble without freezing
        v.holder.rotation.set(lean + kick, 0, (walking ? Math.sin(phase) * 0.07 : 0) + kick * 0.5);
        const sc = r.state === 'telegraph' ? 1 + Math.sin(t * 30) * 0.015 : 1;
        v.holder.scale.set(sc, sc * (r.type === 'jumper' ? 1 : 1), sc);
        v.shell.emissive.set(r.flash > 0 ? '#c79bff' : tele ? '#5a1c6e' : '#2a1046');
        v.shell.emissiveIntensity = r.flash > 0 ? 0.45 : tele ? 0.22 + Math.sin(t * 25) * 0.05 : 0.35;
      } else { v.shell.emissive.set(r.flash > 0 ? '#ffffff' : '#5a2a8c'); v.shell.emissiveIntensity = r.flash > 0 ? 0.6 : 0.22; }
      v.charge.visible = tele;
      if (tele) { const k = 1 - Math.max(0, r.t) / 0.8; v.charge.scale.setScalar(0.4 + k * 1.2); }
      if (v.barrier) { const up = r.state === 'recover' ? 0 : 1; v.barrier.scale.setScalar(v.barrier.scale.x + (Math.max(0.05, up) - v.barrier.scale.x) * 0.25); v.barrier.visible = v.barrier.scale.x > 0.08; }
      if (v.barrierMat) { v.barrierMat.uniforms.t.value = t; v.barrierMat.uniforms.hit.value = Math.max(0, v.barrierMat.uniforms.hit.value - 0.05); }
    }
    for (const [id, v] of this.map) if (!seen.has(id)) { this.root.remove(v.group); this.map.delete(id); }
  }
  shieldHit(id: string) { const v = this.map.get(id); if (v?.barrierMat) v.barrierMat.uniforms.hit.value = 1; }
  reset() { for (const v of this.map.values()) this.root.remove(v.group); this.map.clear(); }
}

export { robotCenter };
