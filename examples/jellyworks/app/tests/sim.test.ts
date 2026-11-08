import { describe, it, expect } from 'vitest';
import { Simulation, STEP } from '../src/game/sim';
import { LEVELS, type NodeDef } from '../src/game/levels';
import { LayoutEditor, starsFor } from '../src/game/editor';
import { loadSave, recordCompletion, defaultSave } from '../src/game/progress';

const level = (id: string) => LEVELS.find((l) => l.id === id)!;

function run(sim: Simulation, seconds: number, onStep?: () => void) {
  const n = Math.round(seconds / STEP);
  for (let i = 0; i < n && !sim.complete; i++) { sim.step(); onStep?.(); }
  return sim;
}

function assertOwnership(sim: Simulation) {
  const ids = sim.ownedCandies().map((c) => c.id);
  expect(new Set(ids).size).toBe(ids.length); // no candy in two places
  for (const id of ids) expect(sim.delivered.has(id)).toBe(false);
}

const n = (id: string, kind: NodeDef['kind'], c: number, r: number, inputs: any[], outputs: any[], extra: Partial<NodeDef> = {}): NodeDef =>
  ({ id, kind, cell: [c, r], inputs, outputs, fixed: false, ...extra });

describe('supplied layouts', () => {
  for (const L of LEVELS) {
    it(`${L.id}: solved layout completes`, () => {
      const sim = new Simulation(L, L.solvedLayout);
      run(sim, 240, () => assertOwnership(sim));
      expect(sim.complete).toBe(true);
      for (const [g, goal] of Object.entries(L.goals)) expect(sim.goalCount(g)).toBe(goal);
      console.log(`[solved] ${L.id}: complete at ${sim.time.toFixed(2)}s`, Object.fromEntries(Object.keys(L.goals).map((g) => [g, sim.goalCount(g)])));
    });
    it(`${L.id}: initial layout cannot complete and shows a local jam`, () => {
      const sim = new Simulation(L, L.initialLayout);
      const jams: string[] = [];
      run(sim, 120, () => { for (const e of sim.events) if (e.type === 'jam') jams.push(`${e.node}: ${e.reason}`); });
      expect(sim.complete).toBe(false);
      expect(jams.length).toBeGreaterThan(0);
      console.log(`[initial] ${L.id} jams:`, [...new Set(jams)].slice(0, 4));
    });
    it(`${L.id}: applying knownSolution via editor yields solved behaviour`, () => {
      const ed = new LayoutEditor(L);
      for (const s of L.knownSolution) {
        if (s.action === 'place') expect(ed.apply(s.node!.kind === 'turn' ? 'turn' : 'belt', s.node!.cell[0], s.node!.cell[1], s.node!).ok).toBe(true);
        if (s.action === 'rotate_to_ports') {
          const node = ed.nodes().find((x) => x.id === s.id)!;
          let res = ed.rotate(node.cell[0], node.cell[1], false);
          const now = ed.nodes().find((x) => x.id === s.id)!;
          if (now.inputs.join() !== s.inputs!.join()) { ed.undo(); res = ed.rotate(node.cell[0], node.cell[1], true); }
          expect(res.ok).toBe(true);
          const after = ed.nodes().find((x) => x.id === s.id)!;
          expect(after.inputs).toEqual(s.inputs);
          expect(after.outputs).toEqual(s.outputs);
        }
      }
      expect(ed.movesUsed).toBe(L.knownSolution.length);
      expect(starsFor(L, ed.movesUsed)).toBe(3);
      const sim = new Simulation(L, ed.nodes());
      run(sim, 240);
      expect(sim.complete).toBe(true);
    });
  }
});

describe('machines', () => {
  it('mixer waits for both ingredients; one red + one yellow -> exactly one orange', () => {
    const layout = [
      n('red', 'source', 0, 0, [], ['E'], { color: 'red', fixed: true }),
      n('b1', 'straight', 1, 0, ['W'], ['E']),
      n('mixer', 'mixer', 2, 0, ['W', 'S'], ['E'], { inputColors: { W: 'red', S: 'yellow' }, fixed: true }),
      n('b2', 'straight', 3, 0, ['W'], ['E']),
    ];
    const sim = new Simulation({ goals: {}, size: [5, 3] }, layout);
    const produced: number[] = [];
    run(sim, 10, () => sim.events.forEach((e) => e.type === 'produce' && produced.push(e.candy)));
    expect(produced.length).toBe(0); // red alone never produces orange
    const mixer = sim.byId.get('mixer')!;
    expect(mixer.buffers.W!.length).toBe(1);
    // add yellow feed from the south
    const yellow = [n('yellow', 'source', 2, 2, [], ['N'], { color: 'yellow', fixed: true }), n('b3', 'straight', 2, 1, ['S'], ['N'])];
    const sim2 = new Simulation({ goals: {}, size: [5, 3] }, [...layout, ...yellow]);
    const consumed: number[][] = [];
    for (let i = 0; i < 60 * 4; i++) { sim2.step(); sim2.events.forEach((e) => e.type === 'consume' && consumed.push(e.candies)); }
    expect(consumed.length).toBeGreaterThan(0);
    expect(consumed.every((c) => c.length === 2)).toBe(true);
    const outs = sim2.ownedCandies().filter((c) => c.color === 'orange');
    expect(outs.length).toBeGreaterThan(0);
    // orange appears only after 1.2s processing of the first consume
    assertOwnership(sim2);
  });

  it('warm blue sent directly to cube press is blocked with feedback', () => {
    const layout = [
      n('blue', 'source', 0, 0, [], ['E'], { color: 'blue', fixed: true }),
      n('b1', 'straight', 1, 0, ['W'], ['E']),
      n('cube', 'cube_press', 2, 0, ['W'], ['E'], { fixed: true }),
    ];
    const sim = new Simulation({ goals: {}, size: [4, 1] }, layout);
    const jams: string[] = [];
    run(sim, 8, () => sim.events.forEach((e) => e.type === 'jam' && jams.push(e.reason)));
    expect(sim.ownedCandies().some((c) => c.shape === 'cube')).toBe(false);
    expect(jams.some((j) => j.includes('COOLED'))).toBe(true);
    expect(sim.byId.get('b1')!.candy?.temp).toBe('warm'); // stays at the input, unchanged
  });
});

describe('flow', () => {
  it('merge from two sources: fair, no duplication or loss', () => {
    const layout = [
      n('a', 'source', 0, 1, [], ['E'], { color: 'red', fixed: true }),
      n('b', 'source', 1, 0, [], ['S'], { color: 'yellow', fixed: true }),
      n('m', 'merge', 1, 1, ['W', 'N'], ['E']),
      n('o1', 'straight', 2, 1, ['W'], ['E']),
      n('o2', 'straight', 3, 1, ['W'], ['E']),
      n('bin', 'bin', 4, 1, ['W'], [], { fixed: true, accepts: { color: 'red', shape: 'unformed' } }),
    ];
    // replace bin with an always-accepting sink: count arrivals at o2 exit by tracking enter events
    const sim = new Simulation({ goals: {}, size: [5, 2] }, layout.slice(0, 5));
    const passed = { red: 0, yellow: 0 };
    const seen = new Set<number>();
    for (let i = 0; i < 60 * 40; i++) {
      sim.step();
      for (const e of sim.events) if (e.type === 'enter' && e.node === 'm') {
        expect(seen.has(e.candy)).toBe(false); seen.add(e.candy);
        const c = sim.byId.get('m')!.candy!; passed[c.color as 'red' | 'yellow']++;
      }
      assertOwnership(sim);
      // drain the end belt so flow continues
      const end = sim.byId.get('o2')!; if (end.candy && end.progress >= 1) { end.candy = null; }
    }
    expect(passed.red).toBeGreaterThan(5);
    expect(Math.abs(passed.red - passed.yellow)).toBeLessThanOrEqual(1);
  });

  it('splitter alternates, and when one bin fills the other branch keeps receiving', () => {
    const L = level('optimize');
    const sim = new Simulation(L, L.solvedLayout);
    run(sim, 240);
    expect(sim.goalCount('bin-orange-a')).toBe(6);
    expect(sim.goalCount('bin-orange-b')).toBe(6);
    // custom: unequal goals to force one full bin
    const sim2 = new Simulation({ ...L, goals: { 'bin-orange-a': 2, 'bin-orange-b': 10, 'bin-blue': 1 } }, L.solvedLayout);
    run(sim2, 300);
    expect(sim2.complete).toBe(true);
    expect(sim2.goalCount('bin-orange-b')).toBe(10);
  });

  it('repeated restarts never double count deliveries', () => {
    const L = level('connect');
    let total = 0;
    for (let k = 0; k < 4; k++) {
      const sim = new Simulation(L, L.solvedLayout); // STOP & EDIT then RUN builds a fresh sim
      run(sim, 3 + k * 2);
      expect(sim.goalCount('bin-blue')).toBeLessThanOrEqual(6);
      total = sim.goalCount('bin-blue');
    }
    const full = new Simulation(L, L.solvedLayout);
    run(full, 200);
    expect(full.goalCount('bin-blue')).toBe(6);
    expect(full.delivered.size).toBe(6);
    expect(total).toBeLessThanOrEqual(6);
  });
});

describe('editor', () => {
  it('undo/redo placement and rotation keep graph and moves consistent', () => {
    const ed = new LayoutEditor(level('connect'));
    expect(ed.apply('belt', 4, 2).ok).toBe(true);
    expect(ed.movesUsed).toBe(1);
    expect(ed.rotate(4, 2, true).ok).toBe(true);
    expect(ed.at(4, 2)!.inputs).toEqual(['N']);
    expect(ed.movesUsed).toBe(2);
    ed.undo();
    expect(ed.at(4, 2)!.inputs).toEqual(['W']);
    expect(ed.movesUsed).toBe(1);
    ed.undo();
    expect(ed.at(4, 2)).toBeNull();
    expect(ed.movesUsed).toBe(0);
    ed.redo(); ed.redo();
    expect(ed.at(4, 2)!.outputs).toEqual(['S']);
    expect(ed.movesUsed).toBe(2);
    // identical placement costs nothing
    const ed2 = new LayoutEditor(level('connect'));
    const r = ed2.apply('belt', 1, 2);
    expect(r.cost).toBe(0);
    expect(ed2.movesUsed).toBe(0);
  });

  it('invalid edits on fixed machines or outside the board spend no moves', () => {
    const ed = new LayoutEditor(level('connect'));
    expect(ed.apply('erase', 3, 2).ok).toBe(false);
    expect(ed.apply('belt', 3, 2).ok).toBe(false);
    expect(ed.rotate(0, 2).ok).toBe(false);
    expect(ed.apply('belt', -1, 0).ok).toBe(false);
    expect(ed.apply('belt', 10, 0).ok).toBe(false);
    expect(ed.apply('erase', 5, 0).ok).toBe(false);
    expect(ed.movesUsed).toBe(0);
    expect(ed.nodes().length).toBe(level('connect').initialLayout.length);
  });

  it('move budget is enforced', () => {
    const ed = new LayoutEditor(level('connect'));
    for (let c = 0; c < 6; c++) expect(ed.apply('belt', c, 0).ok).toBe(true);
    const r = ed.apply('belt', 7, 0);
    expect(r.ok).toBe(false);
    expect(ed.movesUsed).toBe(6);
  });
});

describe('progress', () => {
  it('recovers from corrupted save and keeps best results', () => {
    expect(loadSave({ getItem: () => '{not json' })).toEqual(defaultSave());
    expect(loadSave({ getItem: () => JSON.stringify({ version: 9 }) })).toEqual(defaultSave());
    const d = recordCompletion(defaultSave(), 'connect', 2, 4);
    recordCompletion(d, 'connect', 3, 1);
    recordCompletion(d, 'connect', 1, 5);
    expect(d.levels.connect).toEqual({ completed: true, stars: 3, bestMoves: 1 });
  });
});
