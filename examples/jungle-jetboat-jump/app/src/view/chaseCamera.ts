import * as THREE from 'three';

export type CamMode = 'chase' | 'cockpit';

/** Damped low rear chase camera (reference framing) with a cockpit option using the same boat and crew. */
export class ChaseCamera {
  mode: CamMode = 'chase';
  readonly cam: THREE.PerspectiveCamera;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private landKick = 0;
  private init = false;
  private yaw = 0;
  // framing tuned against media/scene-development/references/gameplay-original.png
  back = 4.4; up = 1.5; ahead = 10; lookUp = -0.6;

  constructor(aspect: number) {
    this.cam = new THREE.PerspectiveCamera(50, aspect, 0.1, 2600);
  }
  reset() { this.init = false; this.landKick = 0; }
  kick(a: number) { this.landKick = Math.min(0.6, this.landKick + a); }

  update(x: number, y: number, z: number, heading: number, speed: number, dt: number, boatObj: THREE.Object3D, waterY: number, floorAt?: (x: number, z: number) => number) {
    if (this.mode === 'cockpit') {
      const p = new THREE.Vector3(0.0, 1.35, -1.75).applyMatrix4(boatObj.matrixWorld);
      const l = new THREE.Vector3(0, 0.9, 8).applyMatrix4(boatObj.matrixWorld);
      this.cam.position.copy(p); this.cam.lookAt(l);
      this.cam.fov = 68; this.cam.updateProjectionMatrix();
      this.init = false;
      return;
    }
    // yaw-lagged framing: during a turn the hull swings across the view (reference shows the starboard side in a left turn)
    if (!this.init) this.yaw = heading;
    let dy = heading - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * (1 - Math.exp(-dt * 3.2));
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const pull = Math.min(1.2, Math.max(0, speed - 10) * 0.1);
    const camY = Math.max(y, waterY) ;
    const tp = new THREE.Vector3(x - fx * (this.back + pull), camY + this.up + pull * 0.25, z - fz * (this.back + pull));
    tp.y = Math.max(tp.y, waterY + 1.6);
    const tl = new THREE.Vector3(x + fx * this.ahead, y + this.lookUp, z + fz * this.ahead);
    if (!this.init) { this.pos.copy(tp); this.look.copy(tl); this.init = true; }
    const kp = 1 - Math.exp(-dt * 14), kl = 1 - Math.exp(-dt * 14);
    const py = this.pos.y;
    this.pos.lerp(tp, kp);
    this.pos.y = py + (tp.y - py) * (1 - Math.exp(-dt * 4)); // softer vertical follow for jumps/rapids
    if (floorAt) this.pos.y = Math.max(this.pos.y, floorAt(this.pos.x, this.pos.z) + 1.4); // never dip under the ramp deck
    this.look.lerp(tl, kl);
    this.landKick *= Math.exp(-dt * 6);
    this.cam.position.copy(this.pos);
    this.cam.position.y -= this.landKick * 0.5;
    this.cam.lookAt(this.look);
    this.cam.fov = 50 + Math.min(5, Math.max(0, speed - 12) * 0.6);
    this.cam.updateProjectionMatrix();
  }
}
