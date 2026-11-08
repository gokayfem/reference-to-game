/** Versioned localStorage save with corruption recovery. */
export interface SaveData {
  version: 1;
  levels: Record<string, { completed: boolean; stars: number; bestMoves: number }>;
  settings: { muted: boolean; music: number; sfx: number; quality: 'high' | 'low' };
}
const KEY = 'jellyworks.save.v1';

export function defaultSave(): SaveData {
  return { version: 1, levels: {}, settings: { muted: false, music: 0.5, sfx: 0.8, quality: 'high' } };
}

export function loadSave(storage: Pick<Storage, 'getItem'> | null = safeStorage()): SaveData {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return defaultSave();
    const d = JSON.parse(raw);
    if (!d || d.version !== 1 || typeof d.levels !== 'object' || typeof d.settings !== 'object') return defaultSave();
    const def = defaultSave();
    return { version: 1, levels: d.levels ?? {}, settings: { ...def.settings, ...d.settings } };
  } catch {
    return defaultSave();
  }
}

export function writeSave(data: SaveData, storage: Pick<Storage, 'setItem'> | null = safeStorage()) {
  try { storage?.setItem(KEY, JSON.stringify(data)); } catch { /* storage unavailable */ }
}

export function recordCompletion(data: SaveData, levelId: string, stars: number, moves: number): SaveData {
  const prev = data.levels[levelId];
  data.levels[levelId] = {
    completed: true,
    stars: Math.max(stars, prev?.stars ?? 0),
    bestMoves: Math.min(moves, prev?.bestMoves ?? Infinity),
  };
  return data;
}

function safeStorage(): Storage | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}
