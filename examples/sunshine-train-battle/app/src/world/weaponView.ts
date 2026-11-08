// First-person rig rendered in its own scene/camera after the world (controlled near clipping).
// Exactly two hands (HandRig): the right hand is parented to the blaster's grip socket; the left hand
// blends between gun-local sockets (support, slot, latch) and rig-space targets (belt, barrier) so it
// stays locked to the gun through recoil and reload tilts.
import * as THREE from 'three';
import { flashSprite } from './materials';
import { HandRig, MeshHand, POSES, blendPose, gloveMats } from './handRig';

export const VIEW_FOV = 70;

export interface ViewState {
  reloadP: number; shielding: boolean; speed: number; grounded: boolean; sprinting: boolean;
  lookDX: number; lookDY: number; aspect: number; t: number;
}

const basis = (x: number[], y: number[], z: number[]) => {
  const X = new THREE.Vector3(x[0], x[1], x[2]).normalize(), Y = new THREE.Vector3(y[0], y[1], y[2]).normalize();
  const Z = new THREE.Vector3(z[0], z[1], z[2]).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
};
/** Orthonormal frame from a forearm direction (z) and a back-of-hand hint (y). */
const frameZY = (z: number[], yHint: number[]) => {
  const Z = new THREE.Vector3(z[0], z[1], z[2]).normalize();
  const Y = new THREE.Vector3(yHint[0], yHint[1], yHint[2]);
  Y.addScaledVector(Z, -Y.dot(Z)).normalize();
  const X = new THREE.Vector3().crossVectors(Y, Z);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
};
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class WeaponView {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(VIEW_FOV, 1, 0.01, 10);
  rig = new THREE.Group();
  gun = new THREE.Group();
  model?: THREE.Object3D;
  right = new HandRig(1);
  left = new HandRig(-1);
  meshRight?: MeshHand; meshLeft?: MeshHand;
  /** gun-local sockets (derived from the model's bounds in setModel) */
  sockets = { grip: new THREE.Object3D(), foreEnd: new THREE.Object3D(), slot: new THREE.Object3D(), latch: new THREE.Object3D() };
  private cellInGun: THREE.Group; private cellHeld: THREE.Group; private cellEject: THREE.Group;
  private flash: THREE.Sprite; private flashLight: THREE.PointLight;
  private shieldPanel: THREE.Mesh;
  private muzzle = new THREE.Object3D();
  private recoil = 0; private flashT = 0; private shieldK = 0; private bob = 0; private hurtK = 0; private landK = 0; private sprintK = 0; private triggerT = 0;
  private sway = new THREE.Vector2();
  basePos = new THREE.Vector3(0.2, -0.25, -0.6);
  baseRot = new THREE.Euler(0, 0, -0.2);
  /** distance (m) at which the barrel axis crosses the crosshair ray */
  convergence = 18;
  noseDown = 0.05;
  private tmpM = new THREE.Matrix4(); private tmpS = new THREE.Vector3();
  private sP = new THREE.Vector3(); private sQ = new THREE.Quaternion(); private lP = new THREE.Vector3(); private lQ = new THREE.Quaternion();

  constructor() {
    this.scene.add(this.camera);
    this.camera.add(this.rig);
    this.rig.add(this.gun);
    this.gun.position.copy(this.basePos);
    const hemi = new THREE.HemisphereLight('#d9ecff', '#7f9a55', 1.0);
    const sun = new THREE.DirectionalLight('#fff1dc', 3.0); sun.position.set(-1.5, 2.2, 1.2);
    const rim = new THREE.DirectionalLight('#bfe0ff', 1.2); rim.position.set(2, 0.8, -1.5);
    this.scene.add(hemi, sun, rim);

    const makeCell = () => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.07, 18), gloveMats.armor); body.rotation.x = Math.PI / 2; g.add(body);
      const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.0205, 0.0205, 0.024, 18), new THREE.MeshBasicMaterial({ color: '#5ff8f2' })); glow.rotation.x = Math.PI / 2; g.add(glow);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.012, 14), gloveMats.cuff); cap.rotation.x = Math.PI / 2; cap.position.z = 0.04; g.add(cap);
      return g;
    };
    this.cellInGun = makeCell(); this.cellHeld = makeCell(); this.cellEject = makeCell();
    for (const k of Object.values(this.sockets)) this.gun.add(k);
    this.sockets.slot.add(this.cellInGun);
    this.left.holdSocket.add(this.cellHeld); this.cellHeld.rotation.set(0, Math.PI / 2, 0); this.cellHeld.visible = false;
    this.gun.add(this.cellEject); this.cellEject.visible = false;

    this.right.root.scale.setScalar(1.2); this.left.root.scale.setScalar(1.2);
    this.sockets.grip.add(this.right.root);
    this.rig.add(this.left.root);
    this.right.apply(POSES.grip);

    this.gun.add(this.muzzle);
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashSprite(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.scale.setScalar(0.12); this.flash.visible = false; this.muzzle.add(this.flash);
    this.flashLight = new THREE.PointLight('#ffb050', 0, 1.2); this.muzzle.add(this.flashLight);

    const shieldMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { t: { value: 0 }, k: { value: 0 }, hit: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform float t; uniform float k; uniform float hit; varying vec2 vUv; void main(){ vec2 p = vUv*2.0-1.0; float w = 1.0 - smoothstep(-0.1, -1.0, p.y)*0.55; float top = p.y > 0.6 ? length(vec2(p.x*0.75, (p.y-0.6)*1.6)) + 0.6 : abs(p.y); float d = max(abs(p.x)/w, top); float shape = 1.0 - smoothstep(0.9, 0.96, d); float rim = smoothstep(0.76, 0.93, d) * shape; float hex = abs(sin(p.x*22.0)*sin(p.y*19.0 + p.x*11.0)); float scan = 0.5+0.5*sin(vUv.y*70.0 - t*6.0); vec3 c = vec3(0.4,0.95,1.0); float a = (0.16 + rim*0.85 + hex*0.05 + scan*0.05 + hit*0.45) * shape * k; gl_FragColor = vec4(c*(0.8+hit), a);\n#include <colorspace_fragment>\n}',
    });
    this.shieldPanel = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.48, 1, 1), shieldMat);
    this.rig.add(this.shieldPanel);
  }

  /** Normalises the generated GLB with a wrapper: muzzle along -Z, ~0.6 m long; derives hand/cell sockets from its bounds. */
  setModel(root: THREE.Object3D) {
    const wrap = new THREE.Group();
    root.rotation.y = Math.PI / 2; // generated asset muzzle points +X (verified by side render)
    wrap.add(root);
    const box = new THREE.Box3().setFromObject(wrap);
    const s = 0.6 / box.getSize(new THREE.Vector3()).z;
    wrap.scale.setScalar(s);
    const c = new THREE.Box3().setFromObject(wrap).getCenter(new THREE.Vector3());
    wrap.position.set(-c.x, -c.y + 0.02, -c.z - 0.06);
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        const src = m.material as THREE.MeshStandardMaterial;
        // glossy toy-plastic response (clearcoat) over the generated albedo
        const mat = new THREE.MeshPhysicalMaterial({ map: src.map, roughness: 0.34, metalness: 0.05, clearcoat: 0.75, clearcoatRoughness: 0.18 });
        if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
        m.material = mat; src.dispose();
      }
    });
    // measure in gun-local space (wrap is still unparented here, so its world matrix is its local matrix)
    wrap.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(wrap);
    this.gun.add(wrap);
    this.model = wrap;
    const L = b.max.z - b.min.z, H = b.max.y - b.min.y;
    this.muzzle.position.set(0, b.min.y + H * 0.74, b.min.z - 0.005);
    this.aimAtConvergence();
    this.sockets.grip.position.set(0.004, b.min.y + H * 0.3, b.min.z + L * 0.69);
    // forearm drops down and out to the right so the sleeve leaves frame at the bottom-right corner
    this.sockets.grip.quaternion.copy(frameZY([0.45, -0.62, 0.64], [1, 0.1, 0]));
    this.sockets.foreEnd.position.set(b.min.x - 0.03, b.min.y + H * 0.2, b.min.z + L * 0.42);
    // palm up under the fore-end, forearm dropping back-left toward the bottom-left of the frame
    this.sockets.foreEnd.quaternion.copy(frameZY([-0.35, -0.85, 0.4], [-0.85, 0.5, 0]));
    this.sockets.slot.position.set(b.min.x + 0.018, b.min.y + H * 0.66, b.min.z + L * 0.84);
    this.sockets.latch.position.set(b.min.x - 0.02, b.min.y + H * 0.72, b.min.z + L * 0.8);
    this.sockets.latch.quaternion.copy(basis([0, 0, -1], [-1, 0, 0], [0, -1, 0]));
  }

  /** Swap the procedural rig for sculpted per-pose meshes (same sockets and choreography). */
  useMeshHands(right: MeshHand, left: MeshHand) {
    this.sockets.grip.remove(this.right.root); this.rig.remove(this.left.root);
    right.root.scale.setScalar(1.2); left.root.scale.setScalar(1.2);
    this.sockets.grip.add(right.root); this.rig.add(left.root);
    right.setPose('grip'); left.setPose('support');
    this.meshRight = right; this.meshLeft = left;
  }

  /** Rotate the rest pose so the barrel axis (gun -Z through the muzzle) passes through the crosshair at `convergence` m. */
  aimAtConvergence() {
    const roll = this.baseRot.z;
    // muzzle line starts at basePos + R*(muzzle.xy offset); solve yaw/pitch for gun -Z toward (0, 0, -D)
    const target = new THREE.Vector3(0, 0, -this.convergence);
    const off = new THREE.Vector3(this.muzzle.position.x, this.muzzle.position.y, 0);
    let yaw = 0, pitch = 0;
    for (let i = 0; i < 6; i++) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
      const start = this.basePos.clone().add(off.clone().applyQuaternion(q));
      const d = target.clone().sub(start);
      yaw = Math.atan2(-d.x, -d.z);
      pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    }
    // yaw converges on the crosshair; pitch stays slightly nose-down so the top of the blaster reads (FPS convention)
    this.baseRot.set(Math.min(pitch, 0) - this.noseDown, yaw, roll);
    this.gun.rotation.order = 'YXZ';
  }

  /** Camera-space muzzle socket for the simulation (right, up, forward). */
  muzzleOffset() {
    this.rig.updateMatrixWorld(true);
    const p = this.muzzle.getWorldPosition(new THREE.Vector3());
    this.camera.worldToLocal(p);
    return { r: p.x, u: p.y, f: -p.z };
  }

  fire() { this.recoil = 1; this.flashT = 0.06; this.triggerT = 0.09; this.flash.material.rotation = Math.random() * Math.PI; }
  dryFire() { this.triggerT = 0.12; }
  hurt() { this.hurtK = 1; }
  land() { this.landK = 1; }
  shieldHit() { ((this.shieldPanel.material as THREE.ShaderMaterial).uniforms.hit.value = 1); }

  /** gun-local socket → rig-space transform */
  private socketInRig(o: THREE.Object3D, outP: THREE.Vector3, outQ: THREE.Quaternion) {
    this.gun.updateMatrix();
    o.updateMatrix();
    this.tmpM.multiplyMatrices(this.gun.matrix, o.matrix);
    this.tmpM.decompose(outP, outQ, this.tmpS);
  }

  update(dt: number, st: ViewState) {
    this.camera.aspect = st.aspect; this.camera.updateProjectionMatrix();
    this.recoil = Math.max(0, this.recoil - dt * 7);
    this.flashT -= dt; this.triggerT -= dt; this.hurtK = Math.max(0, this.hurtK - dt * 3); this.landK = Math.max(0, this.landK - dt * 4);
    this.flash.visible = this.flashT > 0;
    this.flash.scale.setScalar(0.1 + Math.random() * 0.06);
    this.flashLight.intensity = this.flashT > 0 ? 3 : 0;
    this.shieldK += ((st.shielding ? 1 : 0) - this.shieldK) * Math.min(1, dt * 12);
    this.sprintK += ((st.sprinting && st.reloadP < 0 && !st.shielding ? 1 : 0) - this.sprintK) * Math.min(1, dt * 8);
    if (st.grounded) this.bob += dt * st.speed * 1.9;
    const bobA = Math.min(1, st.speed / 5);
    this.sway.x += (-st.lookDX * 0.0006 - this.sway.x) * Math.min(1, dt * 10);
    this.sway.y += (st.lookDY * 0.0006 - this.sway.y) * Math.min(1, dt * 10);
    const breathe = Math.sin(st.t * 1.6) * 0.0025;

    // ---- reload choreography follows the simulation's real reload progress (0..1; -1 idle) ----
    const p = st.reloadP, R = p >= 0;
    const tilt = R ? smooth(0, 0.18, p) * (1 - smooth(0.9, 1, p)) : 0;
    const release = R ? smooth(0.08, 0.16, p) * (1 - smooth(0.22, 0.3, p)) : 0;
    const toBelt = R ? smooth(0.22, 0.42, p) * (1 - smooth(0.48, 0.66, p)) : 0;
    const carry = R ? smooth(0.48, 0.7, p) * (1 - smooth(0.74, 0.84, p)) : 0;
    const insert = R ? smooth(0.7, 0.82, p) * (1 - smooth(0.86, 0.92, p)) : 0;
    const slap = R ? smooth(0.84, 0.9, p) * (1 - smooth(0.93, 1, p)) : 0;
    const slapJolt = R ? Math.sin(Math.min(1, Math.max(0, (p - 0.88) / 0.06)) * Math.PI) : 0;

    const g = this.gun;
    g.position.set(
      this.basePos.x + this.sway.x + Math.sin(this.bob) * 0.008 * bobA - this.sprintK * 0.03,
      this.basePos.y + this.sway.y + breathe - Math.abs(Math.cos(this.bob)) * 0.01 * bobA - tilt * 0.03 - this.shieldK * 0.05 - this.hurtK * 0.02 - this.landK * 0.025 - this.sprintK * 0.04 + slapJolt * 0.008,
      this.basePos.z + this.recoil * 0.05 + tilt * 0.03);
    g.rotation.set(
      this.baseRot.x + this.recoil * 0.09 + tilt * 0.22 - this.sprintK * 0.25 - this.landK * 0.05,
      this.baseRot.y - tilt * 0.25 + this.sprintK * 0.35,
      this.baseRot.z - tilt * 0.25 - this.shieldK * 0.1 - this.sprintK * 0.3 + slapJolt * 0.04);

    // ---- energy cells: seated → ejected (falls & spins) → fresh cell carried in the left hand → seated ----
    const ejectK = R ? Math.min(1, Math.max(0, (p - 0.16) / 0.3)) : 0;
    this.cellInGun.visible = !R || p < 0.16 || p >= 0.82;
    this.cellEject.visible = R && ejectK > 0 && ejectK < 1;
    if (this.cellEject.visible) {
      const sp = this.sockets.slot.position;
      this.cellEject.position.set(sp.x - ejectK * 0.09, sp.y + ejectK * 0.03 - ejectK * ejectK * 0.25, sp.z + ejectK * 0.05);
      this.cellEject.rotation.set(ejectK * 6, ejectK * 3, 0);
    }
    this.cellHeld.visible = !this.meshLeft && R && p > 0.46 && p < 0.82;

    // ---- right hand: grip, trigger squeeze, thumb release ----
    let rp = POSES.grip;
    if (this.triggerT > 0) rp = blendPose(POSES.grip, POSES.gripFire, Math.min(1, this.triggerT / 0.05));
    if (release > 0) rp = blendPose(rp, POSES.gripRelease, release);
    if (this.meshRight) this.meshRight.update(dt, this.triggerT > 0 ? 1 : 0); else this.right.drive(rp, dt, 30);

    // ---- left hand: blend across gun sockets (support, latch) and rig-space targets (belt, barrier) ----
    this.socketInRig(this.sockets.foreEnd, this.sP, this.sQ);
    this.socketInRig(this.sockets.latch, this.lP, this.lQ);
    const beltP = new THREE.Vector3(-0.2, -0.62, -0.32), beltQ = basis([1, 0, 0], [0, 0, 1], [0, -1, 0]);
    // insert/slap approach from below-left in camera space: back of hand outward, fingers up, forearm down out of frame
    const sideQ = frameZY([-0.35, -0.75, 0.55], [-1, 0.2, 0]);
    const carryP = this.lP.clone().add(new THREE.Vector3(-0.1, -0.22, 0.06));
    const pressP = this.lP.clone().add(new THREE.Vector3(-0.07 * (1 - slap) - 0.03, -0.15 + slap * 0.02, 0.05));
    const blockP = new THREE.Vector3(-0.15, -0.2, -0.42), blockQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 - 0.15, 0.25, 0.2));
    const Lh = this.meshLeft ? this.meshLeft.root : this.left.root;
    Lh.position.copy(this.sP); Lh.quaternion.copy(this.sQ);
    if (toBelt > 0) { Lh.position.lerp(beltP, toBelt); Lh.quaternion.slerp(beltQ, toBelt); }
    if (carry > 0) { Lh.position.lerp(carryP, carry); Lh.quaternion.slerp(sideQ, carry); }
    const wIn = Math.min(1, insert + slap);
    if (wIn > 0) { Lh.position.lerp(pressP, wIn); Lh.quaternion.slerp(sideQ, wIn); }
    if (this.shieldK > 0.001) { Lh.position.lerp(blockP, this.shieldK); Lh.quaternion.slerp(blockQ, this.shieldK); }
    Lh.position.y += -Math.abs(Math.cos(this.bob)) * 0.008 * bobA * (1 - this.shieldK);
    let lp = POSES.support;
    if (toBelt > 0) lp = blendPose(lp, POSES.relaxed, toBelt);
    if (carry > 0 || insert > 0) lp = blendPose(lp, POSES.pinch, Math.max(carry, insert));
    if (slap > 0) lp = blendPose(lp, POSES.slap, slap);
    if (this.shieldK > 0.001) lp = blendPose(lp, POSES.shield, this.shieldK);
    const live = blendPose(lp, lp, 0); // copy, then add a little idle finger life
    live.f[3][0] += Math.sin(st.t * 1.3) * 0.03; live.f[2][0] += Math.sin(st.t * 1.1 + 1) * 0.02;
    if (this.meshLeft) {
      // sculpted pose meshes: pick the pose that matches the current action
      // the latch is pressed with the cupped support hand (an open palm would cover the blaster)
      const pose = this.shieldK > 0.5 ? 'open' : (carry > 0.05 || insert > 0.05 || (R && p > 0.46 && p < 0.84)) ? 'cell' : 'support';
      this.meshLeft.setPose(pose);
      this.meshLeft.update(dt);
    } else this.left.drive(live, dt, 22);

    const sm = this.shieldPanel.material as THREE.ShaderMaterial;
    sm.uniforms.k.value = this.shieldK; sm.uniforms.t.value = st.t; sm.uniforms.hit.value = Math.max(0, sm.uniforms.hit.value - dt * 4);
    this.shieldPanel.visible = this.shieldK > 0.02;
    this.shieldPanel.position.set(-0.12, -0.06 - (1 - this.shieldK) * 0.08, -0.56);
    this.shieldPanel.rotation.set(0, 0.2, 0);
    this.shieldPanel.scale.setScalar(0.6 + this.shieldK * 0.4);
  }
}
