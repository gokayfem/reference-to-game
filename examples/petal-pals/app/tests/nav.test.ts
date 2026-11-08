import { describe, it, expect } from 'vitest';
import { NavGrid, walkable, bridgeAt, BRIDGES, LM, START, riverInfo, riverHalfAt } from '../src/world/layout';

describe('world walkability', () => {
  it('deep water blocks the explorer but bridges are walkable', () => {
    // river centre at z=0 is near x=0
    expect(walkable(0, 0, 'explorer')).toBe(false);
    for (const b of BRIDGES) {
      const mx = (b.a[0] + b.b[0]) / 2, mz = (b.a[1] + b.b[1]) / 2;
      expect(bridgeAt(mx, mz)).not.toBeNull();
      expect(walkable(mx, mz, 'explorer')).toBe(true);
    }
  });
  it('bubble may use marked shallows, land companions may not', () => {
    const z = 10; let cx = 0, best = 1e9; for (let x = -20; x < 20; x += 0.1) { const d = riverInfo(x, z).d; if (d < best) { best = d; cx = x; } }
    expect(riverHalfAt(cx, z)).toBeGreaterThan(3);
    expect(walkable(cx, z, 'bubble')).toBe(true);
    expect(walkable(cx, z, 'land')).toBe(false);
  });
  it('a path exists start→camp→lookout→orchard→start for land companions (via bridges)', () => {
    const nav = new NavGrid('land', 0.25);
    const route: [number, number][] = [START, LM.camp, [34, -29], LM.orchard, LM.sunflowers, START];
    for (let i = 0; i < route.length - 1; i++) {
      const p = nav.findPath(route[i][0], route[i][1], route[i + 1][0], route[i + 1][1], 80000);
      expect(p, `leg ${i}`).not.toBeNull();
      // every waypoint is on walkable ground
      for (const w of p!) expect(nav.okWorld(w[0], w[1])).toBe(true);
    }
  });
  it('the explorer start and habitat centres are walkable', () => {
    for (const p of [START, LM.camp, LM.orchard, LM.sunflowers, LM.riverbank]) expect(walkable(p[0], p[1], 'explorer')).toBe(true);
  });
});

describe('bridges span the widened river', () => {
  it('both bridge ends are on dry, walkable land just beyond the deck', () => {
    for (const b of BRIDGES) for (const [e, s] of [[b.a, -1], [b.b, 1]] as const) {
      const x = e[0] + b.dir[0] * s * 1.0, z = e[1] + b.dir[1] * s * 1.0;
      expect(riverInfo(x, z).d, `${b.id}`).toBeGreaterThan(riverHalfAt(x, z));
      expect(walkable(x, z, 'explorer'), `${b.id} end`).toBe(true);
    }
  });
});
