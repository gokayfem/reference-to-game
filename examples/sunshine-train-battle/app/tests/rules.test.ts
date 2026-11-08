import { describe, expect, it } from 'vitest';
import { addReserve, applyDamage, collectNear, inFrontArc, Loot, newShield, newWeapon, shieldBlock, startReload, tickShield, tickWeapon, tryFire } from '../src/game/rules';
import { movePlayer, segmentAABB, segmentSphere, solid, v3 } from '../src/game/collision';
import { Game, DT, robotCenter } from '../src/game/game';
import { CARS, carEnd, JUMP_GAP_AFTER, ROOF_Y, TUNING } from '../src/game/level';
import { parseSave } from '../src/core/save';

const idle = { moveX: 0, moveZ: 0, jump: false, sprint: false, fire: false, reload: false, shield: false, yaw: 0, pitch: 0 };
function run(g: Game, seconds: number, inp: Partial<typeof idle> = {}) { for (let i = 0; i < Math.round(seconds / DT); i++) g.step({ ...idle, ...inp }); }

describe('weapon', () => {
  it('fires one round per interval and consumes exactly one', () => {
    const w = newWeapon();
    expect(tryFire(w, false)).toBe(true);
    expect(w.mag).toBe(11);
    expect(tryFire(w, false)).toBe(false); // cooldown
    tickWeapon(w, 0.18);
    expect(tryFire(w, false)).toBe(true);
    expect(w.mag).toBe(10);
  });
  it('cannot fire while shielding or reloading', () => {
    const w = newWeapon();
    expect(tryFire(w, true)).toBe(false);
    w.mag = 5; startReload(w);
    expect(tryFire(w, false)).toBe(false);
  });
  it('reload with 5 reserve after emptying 12 → mag 5, reserve 0, no early update', () => {
    const w = newWeapon(); w.reserve = 5;
    for (let i = 0; i < 12; i++) { expect(tryFire(w, false)).toBe(true); tickWeapon(w, 0.18); }
    expect(w.mag).toBe(0);
    expect(startReload(w)).toBe(true);
    let committed = false, t = 0;
    while (!committed) { committed = tickWeapon(w, DT); t += DT; if (!committed) { expect(w.mag).toBe(0); expect(w.reserve).toBe(5); } }
    expect(t).toBeGreaterThan(1.28);
    expect(w.mag).toBe(5); expect(w.reserve).toBe(0);
  });
  it('restarting a reload cannot create ammunition', () => {
    const w = newWeapon(); w.mag = 10; w.reserve = 3;
    startReload(w); tickWeapon(w, 0.5);
    expect(startReload(w)).toBe(false); // already reloading
    tickWeapon(w, 1.0);
    expect(w.mag + w.reserve).toBe(13);
    expect(w.mag).toBe(12);
  });
  it('reserve is capped', () => { const w = newWeapon(); w.reserve = 115; addReserve(w, 12); expect(w.reserve).toBe(TUNING.reserveCap); });
});

describe('shield', () => {
  it('drains 15/s, 10 per block, ends when empty, refills after 2 s', () => {
    const s = newShield();
    tickShield(s, true, 1); expect(s.energy).toBeCloseTo(85);
    shieldBlock(s); expect(s.energy).toBeCloseTo(75);
    for (let i = 0; i < 7; i++) shieldBlock(s);
    expect(s.energy).toBe(5);
    shieldBlock(s); expect(s.energy).toBe(0); expect(s.active).toBe(false);
    tickShield(s, true, 0.1); expect(s.active).toBe(false);
    tickShield(s, false, 1.9); expect(s.energy).toBe(0);
    tickShield(s, false, 0.2); tickShield(s, false, 1); expect(s.energy).toBeGreaterThan(10);
    for (let i = 0; i < 20; i++) tickShield(s, false, 1);
    expect(s.energy).toBe(100);
  });
});

describe('robot shield arc', () => {
  it('blocks frontal bolts and passes flank bolts', () => {
    // robot facing -Z (yaw PI); bolt travelling +Z hits its front
    expect(inFrontArc(Math.PI, 0, 1, 120)).toBe(true);
    // bolt travelling -X (coming from the robot's +X side) → flank
    expect(inFrontArc(Math.PI, -1, 0, 120)).toBe(false);
    expect(inFrontArc(Math.PI, 0, -1, 120)).toBe(false); // from behind
    expect(inFrontArc(Math.PI, Math.sin(0.9), Math.cos(0.9), 120)).toBe(true); // 51° off axis
    expect(inFrontArc(Math.PI, Math.sin(1.15), Math.cos(1.15), 120)).toBe(false); // 66° off axis
  });
});

describe('damage and loot', () => {
  it('defeat fires exactly once under simultaneous hits', () => {
    const t = { hp: 50, defeated: false };
    const res = [applyDamage(t, 25), applyDamage(t, 25), applyDamage(t, 25), applyDamage(t, 25)];
    expect(res.filter((r) => r === 'defeat').length).toBe(1);
  });
  it('collects within radius once', () => {
    const loot: Loot[] = [{ id: 'a', kind: 'blue', x: 1, y: 0, z: 0, collected: false, age: 1 }, { id: 'b', kind: 'orange', x: 3, y: 0, z: 0, collected: false, age: 1 }];
    const ids = new Set<string>();
    expect(collectNear(loot, ids, 0, 0, 0).map((l) => l.id)).toEqual(['a']);
    expect(collectNear(loot, ids, 0, 0, 0).length).toBe(0);
    loot[0].collected = false; // even a reset flag cannot re-award a known ID
    expect(collectNear(loot, ids, 0, 0, 0).length).toBe(0);
  });
});

describe('collision', () => {
  it('swept segment hits thin targets at projectile speed', () => {
    const thin = solid('t', 'cover', v3(-1, 0, 5), v3(1, 2, 5.02));
    // one 1/60 s step at 45 m/s straddling the 2 cm plate
    expect(segmentAABB(v3(0, 1, 4.6), v3(0, 1, 5.35), thin.min, thin.max)).not.toBeNull();
    expect(segmentSphere(v3(0, 1, 0), v3(0, 1, 10), v3(0.3, 1, 5), 0.5)).toBeCloseTo(0.46, 1);
  });
  it('lands on roofs without tunneling at high fall speed', () => {
    const floor = solid('f', 'roof', v3(-2, -1, -2), v3(2, 2, 2));
    const p = v3(0, 6, 0);
    const r = movePlayer(p, v3(0, -5, 0), [floor]);
    expect(r.grounded).toBe(true); expect(p.y).toBe(2);
  });
});

describe('game flow', () => {
  it('player bolts stop at the nearest cover (thin 2 cm plate, 45 m/s)', () => {
    const g = new Game(); g.start();
    const r = g.s.robots.find((x) => x.id === 'robot-1-a')!;
    const p = g.s.player; p.x = r.x; p.z = r.z - 6; p.y = ROOF_Y;
    g.s.solids.push(solid('test-plate', 'cover', v3(r.x - 1, ROOF_Y, r.z - 3), v3(r.x + 1, ROOF_Y + 3, r.z - 2.98)));
    const c = robotCenter(r), eyeY = p.y + 1.6;
    const pitch = Math.atan2(c.y - eyeY, c.z - p.z);
    run(g, DT, { fire: true, yaw: 0, pitch });
    expect(g.s.aim.kind).toBe('solid');
    run(g, 0.5, { yaw: 0, pitch });
    expect(r.hp).toBe(r.maxHp);
    // remove the plate: the same shot now lands
    g.s.solids.pop();
    g.s.weapon.fireCooldown = 0;
    run(g, DT, { fire: true, yaw: 0, pitch });
    run(g, 0.5, { yaw: 0, pitch });
    expect(r.hp).toBe(r.maxHp - TUNING.damage);
  });
  it('shield robot only takes flank damage', () => {
    const g = new Game(); g.start();
    const r = g.s.robots.find((x) => x.type === 'shield')!;
    r.yaw = Math.PI; // facing -Z
    const c = robotCenter(r);
    g.hitRobot; // hit API is exercised via bolts below
    g.s.bolts.push({ id: 1, owner: 'player', x: c.x, y: c.y, z: c.z - 3, px: c.x, py: c.y, pz: c.z - 3, vx: 0, vy: 0, vz: 45, life: 2, alive: true, src: 'player' });
    (g as any).stepBolts();
    for (let i = 0; i < 10; i++) (g as any).stepBolts();
    expect(r.hp).toBe(r.maxHp);
    g.s.bolts.push({ id: 2, owner: 'player', x: c.x + 3, y: c.y, z: c.z, px: c.x + 3, py: c.y, pz: c.z, vx: -45, vy: 0, vz: 0, life: 2, alive: true, src: 'player' });
    for (let i = 0; i < 10; i++) (g as any).stepBolts();
    expect(r.hp).toBe(r.maxHp - TUNING.damage);
  });
  it('drops loot once and retry restores the checkpoint snapshot (no loot farming)', () => {
    const g = new Game(); g.start();
    for (const id of CARS[1].required) { const r = g.s.robots.find((x) => x.id === id)!; for (let i = 0; i < 4; i++) g.hitRobot(r, r.x, r.y, r.z); }
    run(g, DT);
    expect(g.s.cleared[1]).toBe(true);
    const lootAfterClear = g.s.loot.length;
    expect(lootAfterClear).toBe(4); // 2 robots x (crystal + cell), dropped exactly once
    // collect a crystal, then die
    const l = g.s.loot.find((x) => x.kind === 'blue')!;
    l.age = 1; const p = g.s.player; p.x = l.x; p.z = l.z; p.y = ROOF_Y;
    run(g, DT);
    const scoreWith = g.s.score;
    expect(g.s.collectedIds.has(l.id)).toBe(true);
    g.hurtPlayer(200, 'test');
    expect(g.s.phase).toBe('dead');
    g.retry();
    expect(g.s.phase).toBe('playing');
    expect(g.s.collectedIds.has(l.id)).toBe(false);
    expect(g.s.score).toBe(scoreWith - 30);
    expect(g.s.loot.length).toBe(lootAfterClear);
    expect(g.s.cleared[1]).toBe(true);
  });
  it('sustained fire cannot pin a robot in stagger', () => {
    const g = new Game(); g.start();
    const r = g.s.robots.find((x) => x.type === 'base')!;
    r.hp = 10000; r.maxHp = 10000;
    let staggered = 0;
    for (let i = 0; i < 180; i++) { if (i % 11 === 0) g.hitRobot(r, r.x, r.y, r.z); run(g, DT); if (r.state === 'stagger') staggered++; }
    expect(staggered / 180).toBeLessThan(0.35);
  });
  it('shield robot barrier drops while it recovers from firing', () => {
    const g = new Game(); g.start();
    const r = g.s.robots.find((x) => x.type === 'shield')!;
    r.yaw = Math.PI; r.state = 'recover'; r.t = 1.5;
    const c = robotCenter(r);
    g.s.bolts.push({ id: 3, owner: 'player', x: c.x, y: c.y, z: c.z - 3, px: c.x, py: c.y, pz: c.z - 3, vx: 0, vy: 0, vz: 45, life: 2, alive: true, src: 'player' });
    for (let i = 0; i < 10; i++) (g as any).stepBolts();
    expect(r.hp).toBe(r.maxHp - TUNING.damage);
  });
  it('loot never spawns inside cover', () => {
    const g = new Game(); g.start();
    const cover = g.s.solids.find((o) => o.kind === 'cover')!;
    const r = g.s.robots[0]; r.x = (cover.min.x + cover.max.x) / 2; r.z = cover.max.z + 0.2;
    for (let i = 0; i < 4; i++) g.hitRobot(r, r.x, r.y, r.z);
    for (const l of g.s.loot) for (const o of g.s.solids.filter((q) => q.kind === 'cover'))
      expect(l.x > o.min.x && l.x < o.max.x && l.z > o.min.z && l.z < o.max.z).toBe(false);
  });
  it('player cannot walk through a robot', () => {
    const g = new Game(); g.start();
    const r = g.s.robots.find((x) => x.id === 'robot-1-a')!;
    const p = g.s.player; p.x = r.x; p.z = r.z - 3; p.y = ROOF_Y;
    run(g, 1.5, { moveZ: 1 });
    expect(Math.hypot(p.x - r.x, p.z - r.z)).toBeGreaterThan(0.75);
    expect(p.z).toBeLessThan(r.z + 0.5);
  });
  it('falling returns to checkpoint with penalty', () => {
    const g = new Game(); g.start(); g.s.score = 100;
    const p = g.s.player; p.x = 3.5; p.y = ROOF_Y; p.z = 0;
    run(g, 2);
    expect(g.s.falls).toBe(1); expect(g.s.score).toBe(50); expect(p.y).toBe(ROOF_Y);
  });
  it('jumps the authored gap at walk speed', () => {
    const g = new Game(); g.start();
    for (let i = 0; i <= JUMP_GAP_AFTER; i++) g.s.cleared[i] = true;
    (g as any).syncGates();
    const p = g.s.player; p.x = 0; p.z = carEnd(JUMP_GAP_AFTER) - 1.2; p.y = ROOF_Y;
    run(g, 0.15, { moveZ: 1 });
    run(g, 0.05, { moveZ: 1, jump: true });
    run(g, 1.2, { moveZ: 1 });
    expect(g.s.falls).toBe(0);
    expect(p.z).toBeGreaterThan(carEnd(JUMP_GAP_AFTER) + 1.2);
    expect(p.y).toBe(ROOF_Y);
  });
  it('walking straight into the gap falls and recovers', () => {
    const g = new Game(); g.start();
    for (let i = 0; i <= JUMP_GAP_AFTER; i++) g.s.cleared[i] = true;
    (g as any).syncGates(); g.s.checkpoint = JUMP_GAP_AFTER;
    const p = g.s.player; p.x = 0; p.z = carEnd(JUMP_GAP_AFTER) - 0.5; p.y = ROOF_Y;
    run(g, 2, { moveZ: 1 });
    expect(g.s.falls).toBeGreaterThanOrEqual(1);
  });
  it('closed gates block the player; win requires all cars and the trigger', () => {
    const g = new Game(); g.start();
    const p = g.s.player; p.x = 0; p.z = carEnd(1) - 2; p.y = ROOF_Y;
    run(g, 1, { moveZ: 1 });
    expect(p.z).toBeLessThan(carEnd(1) - 0.3);
    g.s.cleared = g.s.cleared.map(() => true); (g as any).syncGates();
    p.z = 77.7; p.x = 0; p.y = ROOF_Y;
    run(g, DT);
    expect(g.s.phase).toBe('won');
    g.reset();
    expect(g.s.phase).toBe('title');
    expect(g.s.cleared.filter(Boolean).length).toBe(1);
    expect(g.s.robots.every((r) => !r.defeated)).toBe(true);
    expect(g.s.weapon.mag).toBe(12); expect(g.s.weapon.reserve).toBe(60);
  });
  it('player shield blocks frontal enemy bolts and drains energy', () => {
    const g = new Game(); g.start();
    const p = g.s.player; p.yaw = 0;
    run(g, DT, { shield: true });
    const before = g.s.shield.energy;
    g.s.bolts.push({ id: 9, owner: 'robot', x: p.x, y: p.y + 1.3, z: p.z + 3, px: p.x, py: p.y + 1.3, pz: p.z + 3, vx: 0, vy: 0, vz: -11, life: 3, alive: true, src: 'x' });
    run(g, 0.4, { shield: true });
    expect(p.health).toBe(100);
    expect(before - g.s.shield.energy).toBeGreaterThan(10);
  });
});

describe('save', () => {
  it('recovers from corrupt saves', () => {
    expect(parseSave('{not json').best).toBe(0);
    expect(parseSave('{"version":7,"best":5}').best).toBe(0);
    expect(parseSave('{"version":1,"best":900,"settings":{"volume":"loud"}}').settings.volume).toBe(0.8);
    expect(parseSave('{"version":1,"best":900}').best).toBe(900);
  });
});
