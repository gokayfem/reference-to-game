import world from '../data/world.json';
import { Solid, solid, v3, V3 } from './collision';

export const ROOF_Y = 2.0;
export const HALF_W = 2.3;
export const HALF_L = 6.0;
export const JUMP_GAP_AFTER = 2; // open gap between cover-car (2) and jump-car (3)

export type EnemyType = 'base' | 'shield' | 'jumper';
export interface CarDef {
  id: string; index: number; z: number; name: string;
  required: string[]; hasSideRoute: boolean; hasLadder: boolean;
  covers: { x: number; z: number; w: number; h: number; l: number; style: 'vent' | 'block' | 'ribbed' }[];
}
export interface EnemyDef { id: string; type: EnemyType; car: number; x: number; z: number }

const NAMES = ['Rear Platform', 'Basic Combat', 'Cover Car', 'Jump Car', 'Defense Car', 'Engine Approach'];
const COVERS: CarDef['covers'][] = [
  [{ x: 1.15, z: 2.6, w: 1.2, h: 0.7, l: 1.8, style: 'vent' }],
  [{ x: -1.1, z: 0.5, w: 1.1, h: 0.75, l: 1.8, style: 'vent' }],
  [{ x: 1.2, z: -3.0, w: 1.2, h: 0.8, l: 1.6, style: 'vent' }, { x: -1.2, z: 0.4, w: 1.1, h: 0.9, l: 1.6, style: 'block' }, { x: 1.05, z: 3.7, w: 1.1, h: 0.75, l: 1.4, style: 'ribbed' }],
  [{ x: 1.0, z: 1.6, w: 1.0, h: 0.6, l: 1.4, style: 'vent' }],
  [{ x: -1.2, z: 0.6, w: 1.2, h: 1.0, l: 1.2, style: 'block' }, { x: 1.2, z: -1.2, w: 1.2, h: 1.0, l: 1.2, style: 'block' }],
  [{ x: -1.3, z: 1.0, w: 1.1, h: 0.75, l: 1.6, style: 'vent' }, { x: 1.3, z: -2.6, w: 1.1, h: 0.75, l: 1.6, style: 'ribbed' }],
];

export const CARS: CarDef[] = world.cars.map((c, i) => ({
  id: c.id, index: i, z: c.center[2], name: NAMES[i], required: c.requiredEnemies,
  hasSideRoute: c.hasSideRoute, hasLadder: c.hasLadder, covers: COVERS[i],
}));

export const ENEMIES: EnemyDef[] = world.enemies.map((e) => ({
  id: e.id, type: e.type as EnemyType, car: world.cars.findIndex((c) => c.id === e.carId), x: e.position[0], z: e.position[2],
}));

export const TUNING = world.tuning;
export const ROBOT_HP: Record<EnemyType, number> = { base: world.robotStats.base.health, shield: world.robotStats.shield.health, jumper: world.robotStats.jumper.health };
export const SHIELD_ARC_DEG = world.robotStats.shield.frontArcDegrees;

export const LOCO_Z0 = CARS[5].z + HALF_L + 1.2; // 73.2
export const LOCO_ROOF_END = LOCO_Z0 + 8.0;
export const LOCO_END = LOCO_Z0 + 13.5;
export const ENGINE_TRIGGER: V3 = v3(0, ROOF_Y, LOCO_Z0 + 4.5);
export const ENGINE_TRIGGER_R = 1.5;
export const PLAYER_START: V3 = v3(world.playerStart[0], ROOF_Y, world.playerStart[2]);

export const WALKWAY_X0 = -3.15, WALKWAY_X1 = -2.35, WALKWAY_Y = 1.3;

export function carStart(i: number) { return CARS[i].z - HALF_L; }
export function carEnd(i: number) { return CARS[i].z + HALF_L; }
export function carAt(z: number): number {
  for (let i = 0; i < CARS.length; i++) if (z >= carStart(i) - 0.6 && z < carEnd(i) + 0.6) return i;
  return z >= LOCO_Z0 - 0.6 ? 6 : -1;
}
export function gateId(i: number) { return `gate-${CARS[i].id}`; }

/** Builds every collision volume. Decorative meshes are independent of these. */
export function buildSolids(): Solid[] {
  const s: Solid[] = [];
  const gz = 0.6; // guard height above roof
  CARS.forEach((car, i) => {
    const z0 = carStart(i), z1 = carEnd(i);
    s.push(solid(`roof-${car.id}`, 'roof', v3(-HALF_W, -1.2, z0), v3(HALF_W, ROOF_Y, z1)));
    // low side guards: stop accidental slides but are jumpable (apex ~1.07 m)
    const gapsLeft = car.hasSideRoute ? [[z0 + 0.6, z0 + 1.6], [z1 - 1.6, z1 - 0.6]] : [];
    pushGuardRun(s, `gr-${car.id}`, HALF_W, z0, z1, []);
    // the -X side faces the decorative parallel train: tall guard (except the walkway steps)
    pushGuardRun(s, `gl-${car.id}`, -HALF_W - 0.2, z0, z1, gapsLeft, 1.6);
    car.covers.forEach((c, k) => s.push(solid(`cover-${car.id}-${k}`, 'cover',
      v3(c.x - c.w / 2, ROOF_Y, car.z + c.z - c.l / 2), v3(c.x + c.w / 2, ROOF_Y + c.h, car.z + c.z + c.l / 2))));
    if (i > 0) s.push(solid(gateId(i), 'gate', v3(-HALF_W, ROOF_Y, z1 - 0.35), v3(HALF_W, ROOF_Y + 2.6, z1 - 0.1)));
    if (i < CARS.length - 1 && i !== JUMP_GAP_AFTER)
      s.push(solid(`bridge-${car.id}`, 'bridge', v3(-2.1, ROOF_Y - 0.4, z1), v3(2.1, ROOF_Y, z1 + 1.2)));
    if (car.hasSideRoute) {
      s.push(solid(`walk-${car.id}`, 'walk', v3(WALKWAY_X0, WALKWAY_Y - 0.25, z0 + 0.4), v3(WALKWAY_X1, WALKWAY_Y, z1 - 0.4)));
      // outer rail of the walkway (blocks player, not shots)
      s.push(solid(`walkrail-${car.id}`, 'guard', v3(WALKWAY_X0 - 0.15, WALKWAY_Y, z0 + 0.4), v3(WALKWAY_X0, WALKWAY_Y + 1.0, z1 - 0.4), false));
      // steps up from walkway to roof at both ends
      for (const zc of [z0 + 1.1, z1 - 1.1])
        s.push(solid(`step-${car.id}-${zc.toFixed(1)}`, 'step', v3(-2.8, WALKWAY_Y, zc - 0.5), v3(-HALF_W, WALKWAY_Y + 0.35, zc + 0.5)));
    }
  });
  // rear wall of the rear platform
  s.push(solid('rear-guard', 'guard', v3(-HALF_W, ROOF_Y, carStart(0) - 0.2), v3(HALF_W, ROOF_Y + 1.0, carStart(0)), false));
  // gangway onto the locomotive
  s.push(solid('bridge-loco', 'bridge', v3(-2.1, ROOF_Y - 0.4, carEnd(CARS.length - 1)), v3(2.1, ROOF_Y, LOCO_Z0)));
  // locomotive roof, cab and front
  s.push(solid('loco-roof', 'roof', v3(-HALF_W, -1.2, LOCO_Z0), v3(HALF_W, ROOF_Y, LOCO_END)));
  s.push(solid('loco-cab', 'cab', v3(-HALF_W, ROOF_Y, LOCO_ROOF_END), v3(HALF_W, ROOF_Y + 1.5, LOCO_END)));
  pushGuardRun(s, 'loco-gr', HALF_W, LOCO_Z0, LOCO_ROOF_END, []);
  pushGuardRun(s, 'loco-gl', -HALF_W - 0.2, LOCO_Z0, LOCO_ROOF_END, [], 1.6);
  return s;

  function pushGuardRun(out: Solid[], id: string, x0: number, z0: number, z1: number, gaps: number[][], h = gz) {
    let a = z0;
    const cuts = [...gaps].sort((p, q) => p[0] - q[0]);
    let k = 0;
    for (const g of cuts) { if (g[0] > a) out.push(solid(`${id}-${k++}`, 'guard', v3(x0, ROOF_Y, a), v3(x0 + 0.2, ROOF_Y + h, g[0]), false)); a = g[1]; }
    if (z1 > a) out.push(solid(`${id}-${k}`, 'guard', v3(x0, ROOF_Y, a), v3(x0 + 0.2, ROOF_Y + h, z1), false));
  }
}

/** Valid robot roof area on a car (keeps clear of edges/gates). */
export function robotBounds(i: number) {
  return { x0: -1.85, x1: 1.85, z0: carStart(i) + 0.8, z1: carEnd(i) - 0.9 };
}
