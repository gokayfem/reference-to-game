/** Build-mode layout editing with move budget and undo/redo. Pure data. */
import { cellKey, rotateDir, mirrorDir, type Dir } from './ports';
import { cloneNode, type LevelDef, type NodeDef, type NodeKind } from './levels';

export type Tool = 'belt' | 'turn' | 'split' | 'merge' | 'erase' | 'mix' | 'mold';
export const PLACE_KIND: Partial<Record<Tool, NodeKind>> = { belt: 'straight', turn: 'turn', split: 'split', merge: 'merge' };

export interface Orientation { inputs: Dir[]; outputs: Dir[] }
export const DEFAULT_ORIENT: Record<string, Orientation> = {
  straight: { inputs: ['W'], outputs: ['E'] },
  turn: { inputs: ['W'], outputs: ['S'] },
  split: { inputs: ['W'], outputs: ['E', 'S'] },
  merge: { inputs: ['W', 'N'], outputs: ['E'] },
};

export function rotateOrient(o: Orientation, cw: boolean): Orientation {
  return { inputs: o.inputs.map((d) => rotateDir(d, cw)), outputs: o.outputs.map((d) => rotateDir(d, cw)) };
}
/** Flip chirality keeping the first input (turn: W→S becomes W→N). */
export function flipOrient(o: Orientation): Orientation {
  const axis = o.inputs[0];
  return { inputs: o.inputs.map((d) => mirrorDir(d, axis)), outputs: o.outputs.map((d) => mirrorDir(d, axis)) };
}

interface Change { cell: string; before: NodeDef | null; after: NodeDef | null }
export interface EditResult { ok: boolean; cost: number; reason?: string }

const samePorts = (a: Orientation, b: Orientation) =>
  [...a.inputs].sort().join() === [...b.inputs].sort().join() && [...a.outputs].sort().join() === [...b.outputs].sort().join();

export class LayoutEditor {
  layout = new Map<string, NodeDef>();
  movesUsed = 0;
  undoStack: Change[] = [];
  redoStack: Change[] = [];
  version = 0;

  constructor(public level: LevelDef, initial: NodeDef[] = level.initialLayout) {
    for (const n of initial) this.layout.set(cellKey(n.cell[0], n.cell[1]), cloneNode(n));
  }

  get budget() { return this.level.moveBudget; }
  get movesLeft() { return this.budget - this.movesUsed; }
  nodes(): NodeDef[] { return [...this.layout.values()]; }
  at(c: number, r: number) { return this.layout.get(cellKey(c, r)) ?? null; }
  inBounds(c: number, r: number) { return c >= 0 && r >= 0 && c < this.level.size[0] && r < this.level.size[1]; }

  /** Validate without mutating; used for hover feedback. */
  check(tool: Tool, c: number, r: number, orient?: Orientation): EditResult {
    if (!this.inBounds(c, r)) return { ok: false, cost: 0, reason: 'Outside the board' };
    const cur = this.at(c, r);
    if (tool === 'mix' || tool === 'mold') return { ok: false, cost: 0, reason: 'Machines are fixed in this puzzle — inspect only' };
    if (cur?.fixed) return { ok: false, cost: 0, reason: 'Fixed machine — it cannot be changed' };
    if (tool === 'erase') {
      if (!cur) return { ok: false, cost: 0, reason: 'Nothing to erase here' };
    } else {
      const kind = PLACE_KIND[tool]!;
      const o = orient ?? DEFAULT_ORIENT[kind];
      if (cur && cur.kind === kind && samePorts(cur, o)) return { ok: true, cost: 0, reason: 'Already placed' };
    }
    if (this.movesLeft <= 0) return { ok: false, cost: 0, reason: 'No moves left — undo or reset the level' };
    return { ok: true, cost: 1 };
  }

  apply(tool: Tool, c: number, r: number, orient?: Orientation): EditResult {
    const res = this.check(tool, c, r, orient);
    if (!res.ok || res.cost === 0) return res;
    const key = cellKey(c, r);
    const before = this.layout.get(key) ?? null;
    let after: NodeDef | null = null;
    if (tool !== 'erase') {
      const kind = PLACE_KIND[tool]!;
      const o = orient ?? DEFAULT_ORIENT[kind];
      after = { id: `${kind === 'straight' || kind === 'turn' ? 'belt' : kind}-${c}-${r}`, kind, cell: [c, r], inputs: [...o.inputs], outputs: [...o.outputs], fixed: false };
    }
    this.commit({ cell: key, before: before && cloneNode(before), after });
    return res;
  }

  rotate(c: number, r: number, cw = true): EditResult {
    return this.reorient(c, r, (o) => rotateOrient(o, cw));
  }
  flip(c: number, r: number): EditResult {
    const cur = this.at(c, r);
    if (cur && cur.kind !== 'turn' && !cur.fixed) return { ok: false, cost: 0, reason: 'Only turns can be mirrored' };
    return this.reorient(c, r, flipOrient);
  }

  private reorient(c: number, r: number, fn: (o: Orientation) => Orientation): EditResult {
    if (!this.inBounds(c, r)) return { ok: false, cost: 0, reason: 'Outside the board' };
    const cur = this.at(c, r);
    if (!cur) return { ok: false, cost: 0, reason: 'Nothing to rotate here' };
    if (cur.fixed) return { ok: false, cost: 0, reason: 'Fixed machine — it cannot be rotated' };
    if (this.movesLeft <= 0) return { ok: false, cost: 0, reason: 'No moves left — undo or reset the level' };
    const o = fn(cur);
    const after = { ...cloneNode(cur), inputs: o.inputs, outputs: o.outputs };
    this.commit({ cell: cellKey(c, r), before: cloneNode(cur), after });
    return { ok: true, cost: 1 };
  }

  private commit(ch: Change) {
    this.set(ch.cell, ch.after);
    this.undoStack.push(ch);
    this.redoStack = [];
    this.movesUsed += 1;
    this.version++;
  }
  private set(key: string, n: NodeDef | null) {
    if (n) this.layout.set(key, cloneNode(n)); else this.layout.delete(key);
  }

  undo(): boolean {
    const ch = this.undoStack.pop();
    if (!ch) return false;
    this.set(ch.cell, ch.before);
    this.redoStack.push(ch);
    this.movesUsed -= 1;
    this.version++;
    return true;
  }
  redo(): boolean {
    const ch = this.redoStack.pop();
    if (!ch) return false;
    this.set(ch.cell, ch.after);
    this.undoStack.push(ch);
    this.movesUsed += 1;
    this.version++;
    return true;
  }
}

/** Star rating from completion and edit economy relative to the supplied (unproven) solution. */
export function starsFor(level: LevelDef, movesUsed: number): number {
  const sol = level.knownSolution.length;
  if (movesUsed <= sol) return 3;
  if (movesUsed <= sol + Math.ceil((level.moveBudget - sol) / 2)) return 2;
  return 1;
}
