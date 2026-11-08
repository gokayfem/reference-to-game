import world from '../data/world.json';

export const TUNING = {
  maxSpeed: world.tuning.maxSpeed,
  boostSpeed: world.tuning.boostSpeed,
  accel: world.tuning.acceleration,
  brake: world.tuning.brake,
  reverseMax: 3,
  coastDrag: 1.2,
  boostCapacity: world.tuning.boostCapacity,
  boostDrain: world.tuning.boostDrainPerSecond,
  boostRefill: world.tuning.boostRefillPerSecond,
  boostDelay: world.tuning.boostRefillDelay,
  maxYawRate: 1.55,
  current: 1.4,
  gravity: world.jump.gravity,
  launchUp: world.jump.launchUpSpeed,
  airSteer: 0.35,
  hullRadius: 1.05,
  maxBankDeg: 16,
};

export interface InputState { throttle: boolean; brake: boolean; left: boolean; right: boolean; boost: boolean }
export const NO_INPUT: InputState = { throttle: false, brake: false, left: false, right: false, boost: false };

/** Pure boat state. Heading h: forward = (sin h, 0, cos h). */
export interface BoatState {
  x: number; y: number; z: number;
  heading: number;
  speed: number;   // forward m/s along heading
  slip: number;    // lateral m/s (right +)
  vy: number;
  airborne: boolean;
  airVx: number; airVz: number; // world horizontal velocity while airborne
  boost: number;
  boostIdle: number;
  boosting: boolean;
  steer: number;   // smoothed -1..1 (right +)
  bank: number;    // visual roll radians
  pitch: number;   // visual pitch radians
  throttleLevel: number;
}

export function makeBoat(x: number, y: number, z: number, heading: number): BoatState {
  return { x, y, z, heading, speed: 0, slip: 0, vy: 0, airborne: false, airVx: 0, airVz: 0,
    boost: TUNING.boostCapacity, boostIdle: 99, boosting: false, steer: 0, bank: 0, pitch: 0, throttleLevel: 0 };
}

/** Steering authority grows from low speed and tapers at very high speed. */
export function steerAuthority(speed: number): number {
  const a = Math.abs(speed);
  const low = Math.min(1, 0.25 + a / 6);
  const high = 1 - 0.35 * Math.max(0, Math.min(1, (a - TUNING.maxSpeed) / (TUNING.boostSpeed - TUNING.maxSpeed)));
  return low * high;
}

/** Advance horizontal controls (throttle/boost/steer) for a grounded boat. Position integration happens in the session. */
export function stepControls(b: BoatState, inp: InputState, dt: number) {
  const steerTarget = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
  b.steer += (steerTarget - b.steer) * Math.min(1, dt * 8);
  const wantsBoost = inp.boost && b.boost > 0 && !inp.brake;
  b.boosting = wantsBoost;
  if (wantsBoost) { b.boost = Math.max(0, b.boost - TUNING.boostDrain * dt); b.boostIdle = 0; }
  else { b.boostIdle += dt; if (b.boostIdle >= TUNING.boostDelay) b.boost = Math.min(TUNING.boostCapacity, b.boost + TUNING.boostRefill * dt); }
  b.throttleLevel += (((inp.throttle || wantsBoost) ? 1 : 0) - b.throttleLevel) * Math.min(1, dt * 4);
  if (b.airborne) {
    b.heading -= b.steer * TUNING.maxYawRate * TUNING.airSteer * dt;
    return;
  }
  const cap = wantsBoost ? TUNING.boostSpeed : TUNING.maxSpeed;
  if (inp.brake) {
    if (b.speed > 0) b.speed = Math.max(0, b.speed - TUNING.brake * dt);
    else b.speed = Math.max(-TUNING.reverseMax, b.speed - TUNING.accel * 0.5 * dt);
  } else if (inp.throttle || wantsBoost) {
    const a = wantsBoost ? TUNING.accel * 1.8 : TUNING.accel;
    if (b.speed < cap) b.speed = Math.min(cap, b.speed + a * dt);
    else b.speed = Math.max(cap, b.speed - TUNING.coastDrag * 2 * dt); // ease back down after boost
  } else {
    const s = Math.sign(b.speed);
    b.speed = s * Math.max(0, Math.abs(b.speed) - TUNING.coastDrag * dt);
  }
  const yawRate = b.steer * TUNING.maxYawRate * steerAuthority(b.speed) * (b.speed < 0 ? -1 : 1);
  b.heading -= yawRate * dt; // steer right (+) turns toward right vector
  // centrifugal slip, decays with hull grip
  b.slip += -yawRate * b.speed * 0.06 * dt;
  b.slip *= Math.exp(-3.2 * dt);
}

export function forwardOf(h: number) { return { x: Math.sin(h), z: Math.cos(h) }; }
export function rightOf(h: number) { return { x: -Math.cos(h), z: Math.sin(h) }; }
