import { TowerType } from '../types';

// What a run did, for the summary at its end. The simulation fills in the battle (shots, hits,
// damage, kills, leaks, time under fire); the game adds the economy and the clock.

export interface TowerRecord {
  type: TowerType; // what the tower was when it last dealt damage
  level: number;
  dealt: number;   // health actually removed (no overkill)
  kills: number;
}

export interface RunStats {
  shotsFired: number;
  shotsHit: number;    // shots that damaged at least one enemy
  shotsMissed: number; // shots that landed or flew out without touching anyone
  damage: number;      // health actually removed, burn included
  biggestHit: number;  // the most health one hit took off one enemy
  kills: number;
  killsByType: Record<string, number>;
  livesLostByType: Record<string, number>;
  towers: Record<string, TowerRecord>; // by tower id, sold towers included
  creditsEarned: number; // kill rewards and wave bonuses
  creditsSpent: number;  // building, upgrading, specializing, moving
  towersBuilt: number;
  battleTime: number;    // game seconds with a wave on the field
  runTime: number;       // real seconds played (pauses excluded)
}

export const newStats = (): RunStats => ({
  shotsFired: 0, shotsHit: 0, shotsMissed: 0, damage: 0, biggestHit: 0,
  kills: 0, killsByType: {}, livesLostByType: {}, towers: {},
  creditsEarned: 0, creditsSpent: 0, towersBuilt: 0, battleTime: 0, runTime: 0,
});

// A save from before stats existed, or a damaged one, starts the count over
export const restoreStats = (saved: unknown): RunStats => {
  const base = newStats();
  if (!saved || typeof saved !== 'object') return base;
  const s = saved as Partial<RunStats>;
  for (const key of Object.keys(base) as (keyof RunStats)[]) {
    const v = s[key];
    if (typeof base[key] === 'number' && Number.isFinite(v)) (base as unknown as Record<string, unknown>)[key] = v;
    if (typeof base[key] === 'object' && v && typeof v === 'object') (base as unknown as Record<string, unknown>)[key] = v;
  }
  return base;
};

export const creditDamage = (stats: RunStats | undefined, towerId: string | undefined, type: TowerType, level: number, dealt: number) => {
  if (!stats || dealt <= 0) return;
  stats.damage += dealt;
  if (!towerId) return;
  const rec = stats.towers[towerId] ?? (stats.towers[towerId] = { type, level, dealt: 0, kills: 0 });
  rec.type = type;
  rec.level = level;
  rec.dealt += dealt;
};

export const formatDuration = (seconds: number) => {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
};

export const formatBig = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : Math.round(n).toLocaleString();
