/**
 * Deterministic conveyor/machine simulation. Pure data, no rendering.
 * The graph owns which node holds each candy ID; a candy is never in two places.
 */
import { DV, opposite, cellKey, type Dir } from './ports';
import { isTransport, recipeSeconds, type CandyColor, type NodeDef, type LevelDef } from './levels';

export const STEP = 1 / 60;
export const TRANSIT_SECONDS = 1.05; // time for one candy to cross one transport cell
export const SPAWN_SECONDS = 1.2;
export const EMIT_SECONDS = 0.3; // machine output slides from housing to its port
export const BUFFER_CAP = 1; // bounded input buffer per machine port
export const JAM_SECONDS = 1.0; // blocked longer than this is shown as a jam

export type Temp = 'warm' | 'cooled';
export type Shape = 'unformed' | 'star' | 'cube';

export interface Candy {
  id: number;
  color: CandyColor;
  temp: Temp;
  shape: Shape;
  history: string[];
}

export type MachineState = 'idle' | 'awaiting' | 'processing' | 'blocked' | 'completed';

export interface NodeRT {
  def: NodeDef;
  key: string;
  // transport
  candy: Candy | null;
  progress: number;
  entry: Dir | null;
  exit: Dir | null; // chosen/tentative exit
  splitPref: number;
  mergePtr: number;
  // machines / sources
  buffers: Partial<Record<Dir, Candy[]>>;
  processing: { inputs: Candy[]; result: Candy; t: number; dur: number } | null;
  out: Candy | null;
  outProgress: number;
  spawnTimer: number;
  state: MachineState;
  completedFlash: number;
  // bins
  count: number;
  // feedback
  blockedFor: number;
  blockedReason: string | null;
}

export type SimEvent =
  | { type: 'spawn'; node: string; candy: number }
  | { type: 'enter'; node: string; candy: number }
  | { type: 'consume'; node: string; candies: number[] }
  | { type: 'produce'; node: string; candy: number }
  | { type: 'deliver'; node: string; candy: number; count: number }
  | { type: 'jam'; node: string; reason: string }
  | { type: 'complete' };

export interface TransferRequest { from: NodeRT; to: NodeRT; dir: Dir; port: Dir; candy: Candy }

export class Simulation {
  nodes = new Map<string, NodeRT>();
  byId = new Map<string, NodeRT>();
  goals: Record<string, number>;
  delivered = new Set<number>();
  time = 0;
  nextCandyId = 1;
  events: SimEvent[] = [];
  complete = false;
  size: [number, number];

  constructor(level: Pick<LevelDef, 'goals' | 'size'>, layout: NodeDef[]) {
    this.goals = { ...level.goals };
    this.size = level.size;
    for (const def of layout) {
      const key = cellKey(def.cell[0], def.cell[1]);
      const rt: NodeRT = {
        def, key, candy: null, progress: 0, entry: null, exit: null, splitPref: 0, mergePtr: 0,
        buffers: {}, processing: null, out: null, outProgress: 0,
        spawnTimer: SPAWN_SECONDS - 0.35, state: 'idle', completedFlash: 0, count: 0,
        blockedFor: 0, blockedReason: null,
      };
      for (const p of def.inputs) rt.buffers[p] = [];
      this.nodes.set(key, rt);
      this.byId.set(def.id, rt);
    }
  }

  /** All candies currently owned by the graph (for invariants/tests). */
  ownedCandies(): Candy[] {
    const list: Candy[] = [];
    for (const n of this.nodes.values()) {
      if (n.candy) list.push(n.candy);
      if (n.out) list.push(n.out);
      for (const b of Object.values(n.buffers)) if (b) list.push(...b);
      if (n.processing) list.push(...n.processing.inputs);
    }
    return list;
  }

  neighbor(n: NodeRT, d: Dir): NodeRT | undefined {
    const [dc, dr] = DV[d];
    return this.nodes.get(cellKey(n.def.cell[0] + dc, n.def.cell[1] + dr));
  }

  private makeCandy(color: CandyColor): Candy {
    return { id: this.nextCandyId++, color, temp: 'warm', shape: 'unformed', history: [`source:${color}`] };
  }

  /** Whether `target` will accept `candy` through input port `port`. Returns reason string when not. */
  acceptReason(target: NodeRT, port: Dir, candy: Candy): string | null {
    const d = target.def;
    if (!d.inputs.includes(port)) return 'No input port facing this belt';
    if (isTransport(d.kind)) return target.candy ? 'busy' : null;
    if (d.kind === 'bin') {
      const a = d.accepts!;
      if (candy.color !== a.color || candy.shape !== a.shape) return `Bin only takes ${a.color} ${a.shape}s`;
      const goal = this.goals[d.id] ?? 0;
      if (target.count >= goal) return 'Bin is full';
      if (this.delivered.has(candy.id)) return 'Already delivered';
      return null;
    }
    const buf = target.buffers[port]!;
    const need = machineInputSpec(d, port);
    if (need && !(candy.color === need.color && candy.temp === need.temp && candy.shape === need.shape)) {
      return need.hint;
    }
    if (buf.length >= BUFFER_CAP) return 'busy';
    return null;
  }

  step(dt = STEP) {
    this.events = [];
    if (this.complete) return;
    this.time += dt;
    const nodes = [...this.nodes.values()].sort((a, b) => (a.def.id < b.def.id ? -1 : 1));

    // 1. sources spawn into their output slot
    for (const n of nodes) {
      if (n.def.kind !== 'source') continue;
      n.spawnTimer += dt;
      if (!n.out && n.spawnTimer >= SPAWN_SECONDS) {
        n.out = this.makeCandy(n.def.color!);
        n.outProgress = 0;
        n.spawnTimer = 0;
        this.events.push({ type: 'spawn', node: n.def.id, candy: n.out.id });
      }
    }

    // 2. machines process
    for (const n of nodes) {
      if (!['mixer', 'star_press', 'cooler', 'cube_press'].includes(n.def.kind)) continue;
      n.completedFlash = Math.max(0, n.completedFlash - dt);
      if (n.processing) {
        n.processing.t += dt;
        if (n.processing.t >= n.processing.dur && !n.out) {
          n.out = n.processing.result;
          n.outProgress = 0;
          n.processing = null;
          n.completedFlash = 0.35;
          this.events.push({ type: 'produce', node: n.def.id, candy: n.out.id });
        }
      }
      if (!n.processing && !n.out) {
        const ready = n.def.inputs.every((p) => (n.buffers[p]?.length ?? 0) > 0);
        if (ready) {
          const inputs = n.def.inputs.map((p) => n.buffers[p]!.shift()!);
          const result = applyRecipe(n.def.kind, inputs);
          n.processing = { inputs, result, t: 0, dur: recipeSeconds(recipeIdFor(n.def.kind)) };
          this.events.push({ type: 'consume', node: n.def.id, candies: inputs.map((c) => c.id) });
        }
      }
    }

    // 3. advance transport and emitters
    for (const n of nodes) {
      if (n.candy) n.progress = Math.min(1, n.progress + dt / TRANSIT_SECONDS);
      if (n.out) n.outProgress = Math.min(1, n.outProgress + dt / EMIT_SECONDS);
    }

    // 4. gather transfer requests (pre-state capacity, reservations resolve conflicts)
    const requests = new Map<string, TransferRequest[]>();
    const waiting: { n: NodeRT; reason: string }[] = [];
    for (const n of nodes) {
      const candy = n.candy && n.progress >= 1 ? n.candy : n.out && n.outProgress >= 1 ? n.out : null;
      if (!candy) continue;
      const exits = this.exitOrder(n);
      let chosen: TransferRequest | null = null;
      let reason = 'Belt end is open — nothing connected';
      for (const d of exits) {
        const t = this.neighbor(n, d);
        if (!t) { reason = 'Belt end is open — nothing connected'; continue; }
        const port = opposite(d);
        const r = this.acceptReason(t, port, candy);
        if (r === null) { chosen = { from: n, to: t, dir: d, port, candy }; break; }
        reason = r === 'busy' ? 'Waiting for space downstream' : r;
      }
      if (chosen) {
        const list = requests.get(chosen.to.key) ?? [];
        list.push(chosen);
        requests.set(chosen.to.key, list);
      } else waiting.push({ n, reason });
    }

    // 5. resolve: one grant per destination capacity; merges use fair round-robin
    const granted: TransferRequest[] = [];
    for (const [, list] of requests) {
      const to = list[0].to;
      if (list.length === 1) { granted.push(list[0]); continue; }
      // order requesters by the destination's round-robin pointer over its input ports
      const ports = to.def.inputs;
      const ranked = [...list].sort((a, b) => {
        const ia = (ports.indexOf(a.port) - to.mergePtr + ports.length) % ports.length;
        const ib = (ports.indexOf(b.port) - to.mergePtr + ports.length) % ports.length;
        return ia - ib;
      });
      // transports and bins take one per tick; machine ports are distinct so all may pass
      if (isTransport(to.def.kind) || to.def.kind === 'bin') {
        granted.push(ranked[0]);
        for (const r of ranked.slice(1)) waiting.push({ n: r.from, reason: 'Waiting to merge' });
      } else granted.push(...ranked);
    }

    // 6. apply
    for (const g of granted) {
      const { from, to, dir, port, candy } = g;
      if (from.candy === candy) { from.candy = null; from.progress = 0; from.entry = null; from.exit = null; }
      else if (from.out === candy) { from.out = null; from.outProgress = 0; }
      from.blockedFor = 0; from.blockedReason = null;
      if (from.def.kind === 'split') {
        const idx = from.def.outputs.indexOf(dir);
        from.splitPref = (idx + 1) % from.def.outputs.length;
      }
      if (to.def.inputs.length > 1) to.mergePtr = (to.def.inputs.indexOf(port) + 1) % to.def.inputs.length;
      if (isTransport(to.def.kind)) {
        to.candy = candy; to.progress = 0; to.entry = port;
        to.exit = to.def.outputs.length === 1 ? to.def.outputs[0] : null;
        this.events.push({ type: 'enter', node: to.def.id, candy: candy.id });
      } else if (to.def.kind === 'bin') {
        this.delivered.add(candy.id);
        to.count += 1;
        candy.history.push(`bin:${to.def.id}`);
        this.events.push({ type: 'deliver', node: to.def.id, candy: candy.id, count: to.count });
      } else {
        to.buffers[port]!.push(candy);
        this.events.push({ type: 'enter', node: to.def.id, candy: candy.id });
      }
    }

    // 7. blocked bookkeeping
    const grantedFrom = new Set(granted.map((g) => g.from));
    for (const { n, reason } of waiting) {
      if (grantedFrom.has(n)) continue;
      const was = n.blockedFor;
      n.blockedFor += dt;
      n.blockedReason = reason;
      if (was < JAM_SECONDS && n.blockedFor >= JAM_SECONDS && reason !== 'Waiting for space downstream' && reason !== 'Waiting to merge') {
        this.events.push({ type: 'jam', node: n.def.id, reason });
      }
    }
    for (const n of nodes) {
      const holding = (n.candy && n.progress >= 1) || (n.out && n.outProgress >= 1);
      if (!holding) { n.blockedFor = 0; n.blockedReason = null; }
      // tentative visual exit for splitters
      if (n.def.kind === 'split' && n.candy && !n.exit) n.exit = this.exitOrder(n)[0];
      if (n.def.kind === 'split' && n.candy && n.progress < 1) {
        // re-evaluate tentative exit toward an accepting branch while still travelling
        const order = this.exitOrder(n);
        const free = order.find((d) => { const t = this.neighbor(n, d); return t && this.acceptReason(t, opposite(d), n.candy!) === null; });
        if (free && n.progress < 0.5) n.exit = free;
      }
      this.updateMachineState(n);
    }

    // 8. completion
    if (Object.keys(this.goals).length > 0 && Object.entries(this.goals).every(([id, goal]) => (this.byId.get(id)?.count ?? 0) >= goal)) {
      this.complete = true;
      this.events.push({ type: 'complete' });
    }
  }

  /** Output preference order for a node: splitters alternate starting at splitPref. */
  exitOrder(n: NodeRT): Dir[] {
    const outs = n.def.outputs;
    if (outs.length <= 1) return outs;
    return outs.map((_, i) => outs[(n.splitPref + i) % outs.length]);
  }

  private updateMachineState(n: NodeRT) {
    const k = n.def.kind;
    if (!['mixer', 'star_press', 'cooler', 'cube_press', 'source', 'bin'].includes(k)) return;
    if (k === 'bin') {
      n.state = n.count >= (this.goals[n.def.id] ?? 0) ? 'completed' : 'idle';
      return;
    }
    if (n.out && n.blockedFor >= JAM_SECONDS) n.state = 'blocked';
    else if (n.processing) n.state = 'processing';
    else if (n.completedFlash > 0) n.state = 'completed';
    else if (k !== 'source' && n.def.inputs.some((p) => (n.buffers[p]?.length ?? 0) > 0)) n.state = 'awaiting';
    else n.state = 'idle';
  }

  goalCount(id: string) { return this.byId.get(id)?.count ?? 0; }
}

export function machineInputSpec(def: NodeDef, port: Dir): { color: CandyColor; temp: Temp; shape: Shape; hint: string } | null {
  switch (def.kind) {
    case 'mixer': {
      const c = def.inputColors?.[port] ?? 'red';
      return { color: c, temp: 'warm', shape: 'unformed', hint: `Mixer ${port} port needs ${c.toUpperCase()} gummies` };
    }
    case 'star_press': return { color: 'orange', temp: 'warm', shape: 'unformed', hint: 'Star mold needs ORANGE gummies' };
    case 'cooler': return { color: 'blue', temp: 'warm', shape: 'unformed', hint: 'Cooler only chills warm BLUE gummies' };
    case 'cube_press': return { color: 'blue', temp: 'cooled', shape: 'unformed', hint: 'Cube mold needs COOLED blue — route through the cooler' };
    default: return null;
  }
}

function recipeIdFor(kind: string): string {
  return ({ mixer: 'mix-orange', star_press: 'star', cooler: 'cool', cube_press: 'cube' } as Record<string, string>)[kind];
}

function applyRecipe(kind: string, inputs: Candy[]): Candy {
  // the first input's ID continues as the product so each product keeps a stable unique ID
  const base = inputs[0];
  const hist = inputs.flatMap((c) => c.history);
  switch (kind) {
    case 'mixer': return { id: base.id, color: 'orange', temp: 'warm', shape: 'unformed', history: [...hist, `mix+${inputs[1].id}`] };
    case 'star_press': return { ...base, shape: 'star', history: [...base.history, 'star'] };
    case 'cooler': return { ...base, temp: 'cooled', history: [...base.history, 'cool'] };
    case 'cube_press': return { ...base, shape: 'cube', history: [...base.history, 'cube'] };
  }
  return base;
}
