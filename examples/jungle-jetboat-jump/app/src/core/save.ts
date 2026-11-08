/** Versioned personal-best persistence. Only bests and settings are stored, never in-run pickup state. */
export const SAVE_KEY = 'jungle-jetboat-jump.save';
export interface SaveData { version: 1; bestTime: number | null; bestScore: number; bestStars: number; musicVol: number; sfxVol: number; muted: boolean; quality: 'high' | 'low' }
export const DEFAULT_SAVE: SaveData = { version: 1, bestTime: null, bestScore: 0, bestStars: 0, musicVol: 0.45, sfxVol: 0.8, muted: false, quality: 'high' };

export function loadSave(storage: Pick<Storage, 'getItem'> | null = safeStorage()): SaveData {
  try {
    const raw = storage?.getItem(SAVE_KEY);
    if (!raw) return { ...DEFAULT_SAVE };
    const d = JSON.parse(raw);
    if (!d || d.version !== 1) return { ...DEFAULT_SAVE };
    return {
      ...DEFAULT_SAVE,
      bestTime: typeof d.bestTime === 'number' && isFinite(d.bestTime) ? d.bestTime : null,
      bestScore: Number.isFinite(d.bestScore) ? d.bestScore : 0,
      bestStars: Number.isFinite(d.bestStars) ? d.bestStars : 0,
      musicVol: clamp01(d.musicVol, DEFAULT_SAVE.musicVol), sfxVol: clamp01(d.sfxVol, DEFAULT_SAVE.sfxVol),
      muted: !!d.muted, quality: d.quality === 'low' ? 'low' : 'high',
    };
  } catch { return { ...DEFAULT_SAVE }; }
}
export function writeSave(d: SaveData, storage: Pick<Storage, 'setItem'> | null = safeStorage()) {
  try { storage?.setItem(SAVE_KEY, JSON.stringify(d)); } catch { /* storage unavailable */ }
}
function clamp01(v: unknown, dflt: number) { return typeof v === 'number' && v >= 0 && v <= 1 ? v : dflt; }
function safeStorage(): Storage | null { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } }
