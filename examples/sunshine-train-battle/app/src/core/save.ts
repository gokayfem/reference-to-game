// Versioned localStorage save: best completed score + settings. Corrupt data falls back to defaults.
export interface Settings { volume: number; music: number; sfx: number; muted: boolean; shake: number; sens: number; quality: 'high' | 'low' }
export interface SaveData { version: 1; best: number; bestTime: number; settings: Settings }
const KEY = 'sunshine-train-battle.save';
export const DEFAULT_SETTINGS: Settings = { volume: 0.8, music: 0.5, sfx: 0.9, muted: false, shake: 0.6, sens: 1, quality: 'high' };
export function defaults(): SaveData { return { version: 1, best: 0, bestTime: 0, settings: { ...DEFAULT_SETTINGS } }; }

export function parseSave(raw: string | null): SaveData {
  if (!raw) return defaults();
  try {
    const d = JSON.parse(raw);
    if (!d || d.version !== 1 || typeof d.best !== 'number' || !isFinite(d.best)) return defaults();
    const s = { ...DEFAULT_SETTINGS, ...(typeof d.settings === 'object' && d.settings ? d.settings : {}) };
    for (const k of ['volume', 'music', 'sfx', 'shake', 'sens'] as const) if (typeof s[k] !== 'number' || !isFinite(s[k])) s[k] = DEFAULT_SETTINGS[k];
    if (s.quality !== 'high' && s.quality !== 'low') s.quality = 'high';
    return { version: 1, best: Math.max(0, d.best), bestTime: Number(d.bestTime) || 0, settings: s };
  } catch { return defaults(); }
}
export function load(): SaveData { try { return parseSave(localStorage.getItem(KEY)); } catch { return defaults(); } }
export function store(d: SaveData) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* storage unavailable */ } }
