import world from '../data/world.json';
import type { Dir } from './ports';

export type CandyColor = 'red' | 'yellow' | 'blue' | 'orange';
export type NodeKind =
  | 'source' | 'straight' | 'turn' | 'split' | 'merge'
  | 'mixer' | 'star_press' | 'cooler' | 'cube_press' | 'bin';

export interface NodeDef {
  id: string;
  kind: NodeKind;
  cell: [number, number];
  inputs: Dir[];
  outputs: Dir[];
  fixed: boolean;
  color?: CandyColor;
  accepts?: { color: CandyColor; shape: 'star' | 'cube' | 'unformed' };
  inputColors?: Partial<Record<Dir, CandyColor>>;
}

export interface SolutionStep {
  action: 'place' | 'rotate_to_ports' | 'erase';
  node?: NodeDef;
  id?: string;
  inputs?: Dir[];
  outputs?: Dir[];
}

export interface LevelDef {
  id: string;
  name: string;
  size: [number, number];
  moveBudget: number;
  goals: Record<string, number>;
  initialLayout: NodeDef[];
  solvedLayout: NodeDef[];
  knownSolution: SolutionStep[];
  optimalityProven: boolean;
}

export interface RecipeDef { id: string; inputs?: string[]; input?: string; output: string; seconds: number }

export const LEVELS = (world as unknown as { levels: LevelDef[] }).levels;
export const RECIPES = (world as unknown as { recipes: RecipeDef[] }).recipes;
export const CELL = (world as unknown as { coordinates: { cellSizeMeters: number } }).coordinates.cellSizeMeters;

export const TRANSPORT_KINDS: NodeKind[] = ['straight', 'turn', 'split', 'merge'];
export const isTransport = (k: NodeKind) => TRANSPORT_KINDS.includes(k);
export const isMachine = (k: NodeKind) => k === 'mixer' || k === 'star_press' || k === 'cooler' || k === 'cube_press';

export const LEVEL_SUBTITLES: Record<string, string> = {
  connect: 'Cool, mold and deliver blue cubes',
  combine: 'Mix red and yellow into orange stars',
  optimize: 'The color exchange — split stars, ship cubes',
};

export function cloneNode(n: NodeDef): NodeDef {
  return JSON.parse(JSON.stringify(n));
}

export function recipeSeconds(id: string): number {
  return RECIPES.find((r) => r.id === id)?.seconds ?? 1;
}
