import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { BoatState } from '../game/boat';

/**
 * Runtime asset manifest (see public/assets/manifest.json):
 *  hero-boat.glb  bow +Z, waterline origin, 3.8 m long, 2.04 m wide.
 *  driver.glb / passenger.glb  seated pose facing +Z, origin at boot soles, 1.18 m tall; *_head node split at neck.
 */
export const SEATS = {
  driver: new THREE.Vector3(-0.42, -0.08, -0.22),    // starboard (right when facing forward = -X)
  passenger: new THREE.Vector3(0.42, -0.08, -0.22),  // port
};

/** Warm fresnel rim like the painted reference's edge light; added to emissive so it survives shadowing. */
function addRim(mat: THREE.MeshStandardMaterial, strength: number) {
  mat.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      { float ndv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
        totalEmissiveRadiance += vec3(1.0, 0.86, 0.62) * pow(1.0 - ndv, 3.0) * ${strength.toFixed(2)}; }`);
  };
  mat.customProgramCacheKey = () => 'rim' + strength;
}

interface CrewRig { root: THREE.Object3D; body: THREE.Object3D; head: THREE.Object3D | null; baseHeadRot: number }

export class BoatView {
  readonly root = new THREE.Group();     // world transform (position/yaw)
  readonly tilt = new THREE.Group();     // bank/pitch
  readonly model = new THREE.Group();
  private driver!: CrewRig;
  private passenger!: CrewRig;
  private celebrate = 0;
  private brace = 0;
  private wheel: THREE.Object3D;

  constructor(boat: GLTF, driver: GLTF, passenger: GLTF) {
    this.root.add(this.tilt); this.tilt.add(this.model);
    const hull = boat.scene;
    hull.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true; m.receiveShadow = true;
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.metalness = 0; mat.roughness = Math.max(0.42, mat.roughness);
        if (mat.metalnessMap) mat.metalnessMap = null;
        mat.envMapIntensity = 0.6;
        addRim(mat, 0.35);
        mat.needsUpdate = true;
      }
    });
    this.model.add(hull);
    this.driver = this.rig(driver, SEATS.driver);
    this.passenger = this.rig(passenger, SEATS.passenger);
    // small steering wheel overlay so the cockpit view shows a turning wheel from real input
    const w = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 6, 18), new THREE.MeshStandardMaterial({ color: '#2b2b30', roughness: 0.5 }));
    const hub = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.03), w.material);
    w.add(hub);
    this.wheel = new THREE.Group(); this.wheel.add(w);
    this.wheel.position.set(-0.42, 0.42, 0.28); this.wheel.rotation.x = -0.9;
    this.model.add(this.wheel);
  }

  private rig(g: GLTF, seat: THREE.Vector3): CrewRig {
    const root = new THREE.Group();
    root.position.copy(seat);
    const body = new THREE.Group();
    root.add(body);
    let head: THREE.Object3D | null = null;
    const scene = g.scene;
    scene.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        const mat = m.material as THREE.MeshStandardMaterial; mat.metalness = 0; mat.metalnessMap = null; mat.roughness = 0.75; addRim(mat, 0.25); mat.needsUpdate = true;
      }
    });
    const headNode = scene.getObjectByName(scene.children.find(c => c.name.endsWith('_head'))?.name ?? '__none');
    body.add(scene);
    if (headNode) {
      // re-pivot head at its base so it can turn
      const box = new THREE.Box3().setFromObject(headNode);
      const pivot = new THREE.Group();
      pivot.position.set((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
      scene.add(pivot);
      headNode.position.sub(pivot.position);
      pivot.add(headNode);
      head = pivot;
    }
    this.model.add(root);
    return { root, body, head, baseHeadRot: 0 };
  }

  /** Count of crew bodies — used by the acceptance check (exactly two). */
  get crewCount() { return [this.driver, this.passenger].filter(c => c.root.parent === this.model).length; }

  triggerCelebrate() { this.celebrate = 2.2; }
  triggerBrace() { this.brace = 0.6; }
  resetPose() { this.celebrate = 0; this.brace = 0; }

  update(b: BoatState, t: number, dt: number, finished: boolean) {
    this.tilt.rotation.set(-b.pitch, 0, -b.bank, 'YXZ');
    if (finished && this.celebrate <= 0) this.celebrate = 0.5;
    this.celebrate = Math.max(0, this.celebrate - dt);
    this.brace = Math.max(0, this.brace - dt);
    const lean = b.steer * 0.22;
    const bounce = this.celebrate > 0 ? Math.abs(Math.sin(t * 9)) * 0.12 : 0;
    const braceK = b.airborne ? 1 : this.brace / 0.6;
    for (const [c, k] of [[this.driver, 1], [this.passenger, 1.3]] as const) {
      c.body.rotation.z = lean * k;
      c.body.rotation.x = -0.12 * braceK + Math.sin(t * 7 + k) * 0.01 * Math.min(1, Math.abs(b.speed) / 6);
      c.body.position.y = bounce * (k === 1 ? 1 : 1.2);
      if (c.head) {
        const look = c === this.passenger ? (this.celebrate > 0 ? -0.6 : -b.steer * 0.35 + Math.sin(t * 0.7) * 0.15) : -b.steer * 0.25;
        c.head.rotation.y += (look - c.head.rotation.y) * Math.min(1, dt * 5);
      }
    }
    this.wheel.rotation.z = -b.steer * 1.2;
  }
}
