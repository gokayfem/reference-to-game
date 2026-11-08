import { describe, it, expect } from 'vitest';
import { Session, DT, POINTS, starsFor } from '../src/game/session';
import { NO_INPUT, InputState, TUNING } from '../src/game/boat';
import { getCourse } from '../src/game/courseProgress';
import { loadSave, writeSave, SAVE_KEY, DEFAULT_SAVE } from '../src/core/save';

const course = getCourse();
const run = (s: Session, inp: Partial<InputState>, seconds: number) => {
  const i = { ...NO_INPUT, ...inp };
  const n = Math.round(seconds / DT);
  for (let k = 0; k < n; k++) s.step(i);
};
function running() { const s = new Session(course); s.start(); run(s, {}, 3.1); expect(s.phase).toBe('running'); s.drainEvents(); return s; }
function place(s: Session, at: number, lat = 0, speed = 10, headingOffset = 0) {
  const c = course.sampleAt(at); const b = s.boat;
  b.x = c.x + c.rx * lat; b.z = c.z + c.rz * lat; b.y = c.waterY; b.heading = Math.atan2(c.tx, c.tz) + headingOffset;
  b.speed = speed; b.slip = 0; b.airborne = false;
  const pr = course.project(b.x, b.z, Math.round(at), 60);
  s.progressS = pr.s; s.lateral = pr.lateral; s.progressIndex = pr.index; s.onRamp = false;
}

describe('course progress', () => {
  it('projects onto the centreline with signed lateral offset and stable local search', () => {
    for (const at of [20, 150, 400, 700]) {
      const c = course.sampleAt(at);
      const p = course.project(c.x + c.rx * 3, c.z + c.rz * 3, at, 30);
      expect(Math.abs(p.s - at)).toBeLessThan(0.6);
      expect(p.lateral).toBeCloseTo(3, 0);
    }
    expect(course.length).toBeGreaterThan(700);
  });
});

describe('checkpoints', () => {
  it('only the first valid forward crossing counts; backward, repeat and out-of-order are ignored', () => {
    const s = running();
    const g0 = s.gates[0], g1 = s.gates[1];
    // out of order: cross gate 2 first
    place(s, g1.s - 3, 0, 10); run(s, { throttle: true }, 1);
    expect(g1.passed).toBe(false);
    expect(s.drainEvents().some(e => e.type === 'gateIgnored' && e.reason === 'order')).toBe(true);
    // backward across gate 1
    place(s, g0.s + 3, 0, 8, Math.PI); run(s, {}, 1);
    expect(g0.passed).toBe(false);
    expect(s.drainEvents().some(e => e.type === 'gateIgnored' && e.reason === 'backward')).toBe(true);
    // forward twice
    place(s, g0.s - 3, 0, 10); run(s, { throttle: true }, 1);
    expect(g0.passed).toBe(true); expect(s.gatesPassed).toBe(1);
    place(s, g0.s - 3, 0, 10); run(s, { throttle: true }, 1);
    expect(s.gatesPassed).toBe(1);
    expect(s.liveScore).toBe(POINTS.gate + s.suns * POINTS.token - s.hits * POINTS.hit);
  });
  it('a crossing outside the buoy width does not count', () => {
    const s = running();
    place(s, s.gates[0].s - 3, s.gates[0].halfWidth + 1.5, 10); run(s, { throttle: true }, 1);
    expect(s.gates[0].passed).toBe(false);
  });
});

describe('tokens', () => {
  it('a token awards exactly once even with overlapping checks', () => {
    const s = running();
    const t = s.tokens[5];
    place(s, t.s - 2, t.lateral, 2);
    run(s, {}, 2.5); // drift slowly across the token over many ticks
    const ev = s.drainEvents().filter(e => e.type === 'pickup' && e.id === t.id);
    expect(ev.length).toBe(1);
    expect(t.collected).toBe(true);
    expect(s.suns).toBe(1);
    place(s, t.s - 2, t.lateral, 2); run(s, {}, 2.5);
    expect(s.drainEvents().filter(e => e.type === 'pickup').length).toBe(0);
  });
});

describe('collisions', () => {
  it('boosted hull cannot tunnel through the narrowest rock and is charged once per cooldown', () => {
    const s = running();
    const rock = [...s.rocks].sort((a, b) => a.radius - b.radius)[0];
    place(s, rock.s - 8, rock.lateral, TUNING.boostSpeed);
    for (let k = 0; k < 90; k++) {
      s.step({ ...NO_INPUT, throttle: true, boost: true });
      const d = Math.hypot(s.boat.x - rock.x, s.boat.z - rock.z);
      expect(d).toBeGreaterThanOrEqual(rock.radius + TUNING.hullRadius - 0.02);
    }
    const scrapes = s.drainEvents().filter(e => e.type === 'scrape');
    expect(scrapes.length).toBeGreaterThan(0);
    // 1.5 s of grinding can charge at most 2 penalties
    expect(s.hits).toBeLessThanOrEqual(2);
    expect(s.hits).toBeGreaterThanOrEqual(1);
  });
  it('banks keep the hull inside the visible channel', () => {
    const s = running();
    place(s, 200, 0, 14, 1.2);
    run(s, { throttle: true }, 3);
    expect(Math.abs(s.lateral)).toBeLessThanOrEqual(s.channelHalfWidth(s.progressS) + 0.05);
  });
});

describe('canyon leap', () => {
  const j = course.jump;
  it('launching at speed lands in the zone for a single 500 bonus', () => {
    const s = running();
    place(s, j.rampEndS - j.rampLength - 12, 0, 14);
    run(s, { throttle: true }, 4);
    const ev = s.drainEvents();
    expect(ev.some(e => e.type === 'launch')).toBe(true);
    const land = ev.find(e => e.type === 'land');
    expect(land && land.type === 'land' && land.result).toBe('clean');
    expect(s.landingAwarded).toBe(true);
    const sc = s.liveScore;
    place(s, j.rampEndS - j.rampLength - 12, 0, 14); run(s, { throttle: true }, 4);
    expect(s.liveScore - sc).toBeLessThan(POINTS.landing);
  });
  it('the leap is consistently reachable from 12 m/s up to full boost', () => {
    for (const v of [12, 14, 17, 20]) {
      const s = running();
      place(s, j.rampEndS - j.rampLength - 6, 0, v);
      run(s, { throttle: true, boost: v > 14 }, 4);
      const land = s.drainEvents().find(e => e.type === 'land');
      expect(land && land.type === 'land' ? land.result : 'none', `speed ${v}`).toBe('clean');
    }
  });
  it('a slow approach falls into the cascade gap and recovers at the last checkpoint with a time penalty', () => {
    const s = running();
    s.lastCheckpointS = s.gates[3].s + 3;
    place(s, j.rampEndS - j.rampLength - 2, 0, 3);
    const t0 = s.time; const serial = s.teleportSerial;
    run(s, {}, 6);
    const ev = s.drainEvents();
    expect(ev.some(e => e.type === 'recover')).toBe(true);
    expect(s.recoveries).toBe(1);
    expect(s.time - t0).toBeGreaterThan(POINTS.recoveryTime);
    expect(s.teleportSerial).toBeGreaterThan(serial);
    expect(s.landingAwarded).toBe(false);
    expect(Math.abs(s.progressS - s.lastCheckpointS)).toBeLessThan(20);
  });
});

describe('finish', () => {
  it('crossing the finish without every gate cannot complete the run', () => {
    const s = running();
    s.gates.forEach((g, i) => { if (i !== 2) g.passed = true; }); s.nextGate = 2;
    place(s, s.finishS - 4, 0, 12); run(s, { throttle: true }, 1.5);
    expect(s.phase).toBe('running');
    expect(s.drainEvents().some(e => e.type === 'finishBlocked')).toBe(true);
    expect(s.results).toBeNull();
  });
  it('with all gates it finishes and results derive from state', () => {
    const s = running();
    s.gates.forEach(g => (g.passed = true)); s.nextGate = 6;
    s.tokens.slice(0, 22).forEach(t => (t.collected = true));
    place(s, s.finishS - 4, 0, 12); run(s, { throttle: true }, 1.5);
    expect(s.phase).toBe('finished');
    const r = s.results!;
    expect(r.suns).toBe(22); expect(r.gates).toBe(6);
    expect(r.score).toBe(22 * 100 + 6 * 250 - r.penalties + r.landingBonus + r.timeBonus);
  });
  it('star thresholds', () => {
    expect(starsFor({ time: 100, suns: 10, recoveries: 0, cleanLanding: true })).toBe(1);
    expect(starsFor({ time: 100, suns: 20, recoveries: 3, cleanLanding: false })).toBe(2);
    expect(starsFor({ time: 100, suns: 25, recoveries: 0, cleanLanding: true })).toBe(3);
    expect(starsFor({ time: 111, suns: 30, recoveries: 0, cleanLanding: true })).toBe(2);
  });
});

describe('fixed step / frame-rate independence', () => {
  it('30, 60 and 120 fps render loops give identical simulation', () => {
    const result = (fps: number) => {
      const s = running();
      // integer tick bookkeeping (1/120 s units) so frame pacing is exact; input is sampled once per rendered frame
      const frameTicks = 120 / fps; let accTicks = 0;
      for (let f = 0; f * frameTicks < 6 * 120; f++) {
        const tt = f * frameTicks; // in 1/120 s
        const inp = { ...NO_INPUT, throttle: true, boost: tt >= 240 && tt < 480, right: tt >= 120 && tt < 192 };
        accTicks += frameTicks;
        while (accTicks >= 2) { s.step(inp); accTicks -= 2; }
      }
      return { x: s.boat.x.toFixed(3), z: s.boat.z.toFixed(3), sc: s.liveScore, sp: s.boat.speed.toFixed(3), b: s.boat.boost.toFixed(2) };
    };
    const a = result(30), b = result(60), c = result(120);
    expect(b).toEqual(a); expect(c).toEqual(a);
  });
  it('boost drains 35/s, refills 12/s after 1 s', () => {
    const s = running(); place(s, 100, 0, 10);
    run(s, { throttle: true, boost: true }, 1);
    expect(s.boat.boost).toBeCloseTo(65, 0);
    run(s, { throttle: true }, 1);
    expect(s.boat.boost).toBeCloseTo(65, 0);
    run(s, { throttle: true }, 1);
    expect(s.boat.boost).toBeCloseTo(77, 0);
  });
});

describe('restart', () => {
  it('reset restores the clean initial state', () => {
    const s = running();
    run(s, { throttle: true }, 5);
    s.tokens[0].collected = true; s.gates[0].passed = true; s.hits = 3; s.boat.boost = 10;
    const serial = s.teleportSerial;
    s.reset();
    expect(s.phase).toBe('ready'); expect(s.time).toBe(0); expect(s.suns).toBe(0); expect(s.gatesPassed).toBe(0);
    expect(s.hits).toBe(0); expect(s.boat.boost).toBe(TUNING.boostCapacity); expect(s.liveScore).toBe(0);
    expect(s.teleportSerial).toBe(serial + 1);
    expect(s.drainEvents()).toEqual([]);
  });
});

describe('save', () => {
  it('recovers from corrupted or foreign data', () => {
    const mem: Record<string, string> = {};
    const st = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = v; } };
    mem[SAVE_KEY] = '{not json'; expect(loadSave(st)).toEqual(DEFAULT_SAVE);
    mem[SAVE_KEY] = JSON.stringify({ version: 99, bestScore: 5 }); expect(loadSave(st).bestScore).toBe(0);
    writeSave({ ...DEFAULT_SAVE, bestTime: 95.2, bestScore: 4000 }, st);
    expect(loadSave(st).bestTime).toBe(95.2);
    mem[SAVE_KEY] = JSON.stringify({ version: 1, bestTime: 'x', bestScore: NaN }); expect(loadSave(st).bestTime).toBeNull();
  });
});
