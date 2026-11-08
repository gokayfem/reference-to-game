// Pure gameplay rules. Everything here is deterministic and unit tested.
import { TUNING } from './level';

export interface Weapon { mag: number; reserve: number; reloadTimer: number; fireCooldown: number }
export interface ShieldState { energy: number; active: boolean; sinceUse: number }

export const MAG_SIZE = TUNING.magazine;

export function newWeapon(): Weapon {
  return { mag: TUNING.magazine, reserve: TUNING.reserve, reloadTimer: -1, fireCooldown: 0 };
}

export function isReloading(w: Weapon) { return w.reloadTimer >= 0; }

/** Attempts a shot. Returns true if a round was consumed. */
export function tryFire(w: Weapon, shielding: boolean): boolean {
  if (shielding || isReloading(w) || w.fireCooldown > 0 || w.mag <= 0) return false;
  w.mag -= 1;
  w.fireCooldown = TUNING.fireInterval;
  return true;
}

/** Starts a reload if it can transfer anything. Restarting while in progress does nothing. */
export function startReload(w: Weapon): boolean {
  if (isReloading(w) || w.mag >= MAG_SIZE || w.reserve <= 0) return false;
  w.reloadTimer = TUNING.reloadSeconds;
  return true;
}

/** Cancels a reload without changing ammunition. */
export function cancelReload(w: Weapon) { w.reloadTimer = -1; }

/** Advances timers. Returns true on the step the reload commits. Ammo moves only at completion. */
export function tickWeapon(w: Weapon, dt: number): boolean {
  if (w.fireCooldown > 0) w.fireCooldown = Math.max(0, w.fireCooldown - dt);
  if (!isReloading(w)) return false;
  w.reloadTimer -= dt;
  if (w.reloadTimer > 1e-9) return false;
  const take = Math.min(MAG_SIZE - w.mag, w.reserve);
  w.mag += take;
  w.reserve -= take;
  w.reloadTimer = -1;
  return true;
}

export function addReserve(w: Weapon, n: number) { w.reserve = Math.min(TUNING.reserveCap, w.reserve + n); }

export function newShield(): ShieldState { return { energy: TUNING.shield, active: false, sinceUse: 99 }; }

/** Updates the player barrier from the held key. Empty energy ends the barrier. */
export function tickShield(s: ShieldState, held: boolean, dt: number) {
  s.active = held && s.energy > 0;
  if (s.active) {
    s.energy = Math.max(0, s.energy - TUNING.shieldDrainPerSecond * dt);
    s.sinceUse = 0;
    if (s.energy <= 0) s.active = false;
  } else {
    const before = s.sinceUse;
    s.sinceUse += dt;
    const over = Math.min(dt, s.sinceUse - Math.max(before, TUNING.shieldRefillDelay));
    if (over > 0) s.energy = Math.min(TUNING.shield, s.energy + TUNING.shieldRefillPerSecond * over);
  }
}

/** Applies a blocked enemy bolt to the barrier. */
export function shieldBlock(s: ShieldState) {
  s.energy = Math.max(0, s.energy - TUNING.shieldDrainPerHit);
  s.sinceUse = 0;
  if (s.energy <= 0) s.active = false;
}

/**
 * True when a projectile travelling along dir (unit) hits the front arc of something facing forwardYaw.
 * Incoming from the front means the travel direction is opposite to the facing.
 */
export function inFrontArc(forwardYaw: number, dirX: number, dirZ: number, arcDeg: number): boolean {
  const fx = Math.sin(forwardYaw), fz = Math.cos(forwardYaw);
  const len = Math.hypot(dirX, dirZ) || 1;
  const dot = -(dirX * fx + dirZ * fz) / len;
  return dot >= Math.cos((arcDeg / 2) * Math.PI / 180);
}

export interface Damageable { hp: number; defeated: boolean }
/** Applies damage; returns 'defeat' exactly once on the transition to zero. */
export function applyDamage(t: Damageable, dmg: number): 'none' | 'hit' | 'defeat' {
  if (t.defeated) return 'none';
  t.hp = Math.max(0, t.hp - dmg);
  if (t.hp <= 0) { t.defeated = true; return 'defeat'; }
  return 'hit';
}

export interface Loot { id: string; kind: 'blue' | 'orange' | 'cell'; x: number; y: number; z: number; collected: boolean; age: number }
export const LOOT_SCORE = { blue: 30, orange: 60, cell: 0 } as const;
export const CELL_AMMO = 12;

/** Collects every uncollected loot item within the pickup radius once; returns those collected. */
export function collectNear(loot: Loot[], collectedIds: Set<string>, px: number, py: number, pz: number): Loot[] {
  const out: Loot[] = [];
  const r = TUNING.pickupRadius;
  for (const l of loot) {
    if (l.collected || collectedIds.has(l.id) || l.age < 0.35) continue;
    const dx = l.x - px, dy = l.y - py, dz = l.z - pz;
    if (dx * dx + dy * dy + dz * dz <= r * r) { l.collected = true; collectedIds.add(l.id); out.push(l); }
  }
  return out;
}

/** Deterministic PRNG (mulberry32) for robot decisions and drops. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashStr(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
