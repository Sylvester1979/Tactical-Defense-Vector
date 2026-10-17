import { TowerInstance, TowerType, TargetingMode } from '../types';
import { TOWER_STATS, getFireInterval } from '../constants';

// Persistence lives in localStorage, which can be missing or throw (private mode,
// blocked storage), so every access is guarded and the game works without it.

const SAVE_KEY = 'tdv.save';
const BEST_KEY = 'tdv.best';
const SAVE_VERSION = 1;

export interface SavedRun {
  v: number;
  money: number;
  lives: number;
  waveNumber: number; // last cleared wave
  gameSpeed: number;
  towers: Pick<TowerInstance, 'id' | 'type' | 'baseType' | 'x' | 'y' | 'level' | 'targetingMode' | 'invested'>[];
}

export interface BestRecord {
  waves: number; // most waves cleared in a single run
  date: string;
}

const read = <T,>(key: string): T | null => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};

const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable — the run simply won't persist
  }
};

const isTowerType = (t: unknown): t is TowerType => typeof t === 'string' && t in TOWER_STATS;
const isTargetingMode = (m: unknown): m is TargetingMode =>
  typeof m === 'string' && (Object.values(TargetingMode) as string[]).includes(m);

export const loadRun = (): SavedRun | null => {
  const run = read<SavedRun>(SAVE_KEY);
  if (!run || run.v !== SAVE_VERSION || !Array.isArray(run.towers)) return null;
  if (![run.money, run.lives, run.waveNumber].every(n => Number.isFinite(n)) || run.lives <= 0) return null;
  // Drop anything a stats change or a hand-edited save made invalid
  run.towers = run.towers.filter(t => isTowerType(t.type) && isTowerType(t.baseType) && isTargetingMode(t.targetingMode));
  return run;
};

export const saveRun = (run: Omit<SavedRun, 'v'>) => write(SAVE_KEY, { v: SAVE_VERSION, ...run });

export const clearRun = () => {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // ignore
  }
};

export const loadBest = (): BestRecord | null => {
  const best = read<BestRecord>(BEST_KEY);
  return best && Number.isFinite(best.waves) ? best : null;
};

export const saveBest = (waves: number) => write(BEST_KEY, { waves, date: new Date().toISOString() });

// Restore runtime-only tower fields that aren't worth persisting
export const hydrateTowers = (towers: SavedRun['towers']): TowerInstance[] =>
  towers.map(t => ({ ...t, lastFired: getFireInterval(t.type, t.level), targetId: null, currentAngle: -Math.PI / 2 }));
