import React from 'react';
import { motion } from 'motion/react';
import { RotateCcw } from 'lucide-react';
import { ENEMY_TYPES, TOWER_STATS } from '../constants';
import { RunStats, formatBig, formatDuration } from '../game/stats';
import { Button } from './ui/Button';

// The card at the end of a run: how long it lasted, what the grid fired and landed, which tower
// carried it and what got through.

interface RunSummaryProps {
  stats: RunStats;
  wavesHeld: number;
  bestWaves: number;
  newRecord: boolean;
  onRestart: () => void;
}

const Tile: React.FC<{ label: string; value: React.ReactNode; sub?: React.ReactNode; color?: string }> = ({ label, value, sub, color }) => (
  <div className="rounded-xl bg-black/30 border border-white/[0.06] px-3.5 py-2.5 text-left">
    <div className="text-[11px] uppercase tracking-[0.14em] text-white/55 font-display font-semibold">{label}</div>
    <div className="mt-0.5 font-mono font-bold text-[22px] leading-tight tabular-nums" style={{ color: color ?? '#ffffff' }}>{value}</div>
    {sub && <div className="mt-0.5 text-[12px] text-white/55 font-mono tabular-nums">{sub}</div>}
  </div>
);

export const RunSummary: React.FC<RunSummaryProps> = ({ stats, wavesHeld, bestWaves, newRecord, onRestart }) => {
  const resolved = stats.shotsHit + stats.shotsMissed;
  const accuracy = resolved > 0 ? Math.round((stats.shotsHit / resolved) * 100) : 0;

  // Damage and kills by tower type (sold towers included), and the single best tower
  const records = Object.values(stats.towers);
  const byType = new Map<string, { dealt: number; kills: number }>();
  for (const r of records) {
    const agg = byType.get(r.type) ?? { dealt: 0, kills: 0 };
    agg.dealt += r.dealt;
    agg.kills += r.kills;
    byType.set(r.type, agg);
  }
  const typeRows = [...byType.entries()]
    .map(([type, v]) => ({ type, ...v, share: stats.damage > 0 ? v.dealt / stats.damage : 0 }))
    .sort((a, b) => b.dealt - a.dealt)
    .slice(0, 6);
  const topShare = typeRows[0]?.share || 1;
  const mvp = records.reduce<(typeof records)[number] | null>((a, r) => (!a || r.dealt > a.dealt ? r : a), null);

  const leaks = Object.entries(stats.livesLostByType).sort((a, b) => b[1] - a[1]);

  // Every enemy kind the run met, in the game's own order: how many died and how many lives it took
  const kinds = Object.keys(ENEMY_TYPES).filter(k => stats.killsByType[k] || stats.livesLostByType[k]);

  return (
    <motion.div
      initial={{ scale: 0.94, y: 16 }}
      animate={{ scale: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="relative w-[min(820px,calc(100vw-48px))] max-h-[calc(100vh-48px)] overflow-y-auto rounded-2xl border border-accent-red/30 bg-[#11151b]/95 px-8 py-6 shadow-[0_30px_90px_-20px_rgba(255,77,77,0.35)]"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent-red/70 to-transparent" />

      <div className="flex items-end gap-4">
        <div>
          <div className="font-display font-semibold text-[12px] uppercase tracking-[0.3em] text-accent-red">Game over</div>
          <h2 className="mt-1.5 font-display font-bold text-[34px] leading-none tracking-[0.02em] text-white">Defense breached</h2>
          <p className="mt-2 text-[15px] text-white/70">
            You held <span className="text-white font-semibold">{wavesHeld} wave{wavesHeld === 1 ? '' : 's'}</span> · best {bestWaves}
          </p>
        </div>
        {newRecord && (
          <span className="ml-auto mb-1 px-3 py-1 rounded-full border border-accent-cyan/40 bg-accent-cyan/10 text-accent-cyan text-[12px] font-display font-semibold uppercase tracking-[0.2em]">
            ★ New record
          </span>
        )}
      </div>

      <div className="mt-4 grid grid-cols-4 gap-2.5">
        <Tile label="Run time" value={formatDuration(stats.runTime)} sub={`under fire ${formatDuration(stats.battleTime)}`} />
        <Tile label="Destroyed" value={stats.kills.toLocaleString()} sub={`${stats.towersBuilt} towers built`} />
        <Tile label="Damage dealt" value={formatBig(stats.damage)} sub={`biggest hit ${formatBig(stats.biggestHit)}`} color="#00f2ff" />
        <Tile label="Credits earned" value={`$${formatBig(stats.creditsEarned)}`} sub={`spent $${formatBig(stats.creditsSpent)}`} color="#ffd166" />
        <Tile label="Shots fired" value={stats.shotsFired.toLocaleString()} />
        <Tile label="Hits" value={stats.shotsHit.toLocaleString()} sub={`${accuracy}% accuracy`} color="#34d399" />
        <Tile label="Missed" value={stats.shotsMissed.toLocaleString()} sub={resolved > 0 ? `${100 - accuracy}% of shots` : undefined} color="#ff9f43" />
        <Tile label="Lives lost" value={leaks.reduce((a, [, n]) => a + n, 0)} sub={leaks[0] ? `most to ${ENEMY_TYPES[leaks[0][0]]?.name ?? leaks[0][0]}` : undefined} color="#ff6b7a" />
      </div>

      {mvp && mvp.dealt > 0 && (
        <div className="mt-4 grid grid-cols-[230px_minmax(0,1fr)] gap-5">
          <div
            className="rounded-xl border px-4 py-3.5 text-left"
            style={{ borderColor: `${TOWER_STATS[mvp.type].color}66`, background: `${TOWER_STATS[mvp.type].color}14` }}
          >
            <div className="text-[11px] uppercase tracking-[0.18em] font-display font-semibold" style={{ color: TOWER_STATS[mvp.type].color }}>MVP tower</div>
            <div className="mt-1.5 font-display font-bold text-[20px] text-white leading-tight">{TOWER_STATS[mvp.type].name}</div>
            <div className="text-[13px] text-white/60 font-mono">Level {mvp.level}</div>
            <div className="mt-2 text-[13px] text-white/80">
              {stats.damage > 0 ? Math.round((mvp.dealt / stats.damage) * 100) : 0}% of all damage · {mvp.kills} kills
            </div>
          </div>
          <div className="text-left">
            <div className="text-[11px] uppercase tracking-[0.14em] text-white/55 font-display font-semibold">Damage by tower</div>
            <div className="mt-2 space-y-1.5">
              {typeRows.map(r => (
                <div key={r.type} className="grid grid-cols-[120px_minmax(0,1fr)_118px] items-center gap-2.5">
                  <span className="text-[13px] text-white/80 truncate">{TOWER_STATS[r.type as keyof typeof TOWER_STATS].name}</span>
                  <div className="h-2 rounded-full bg-white/[0.07] overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(r.share / topShare) * 100}%`, backgroundColor: TOWER_STATS[r.type as keyof typeof TOWER_STATS].color }} />
                  </div>
                  <span className="text-[12px] font-mono text-white/70 text-right tabular-nums">{Math.round(r.share * 100)}% · {r.kills} kill{r.kills === 1 ? '' : 's'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {kinds.length > 0 && (
        <div className="mt-4 text-left">
          <div className="text-[11px] uppercase tracking-[0.14em] text-white/55 font-display font-semibold">Destroyed by type</div>
          <div className="mt-2 grid gap-2.5" style={{ gridTemplateColumns: `repeat(${kinds.length}, minmax(0, 1fr))` }}>
            {kinds.map(kind => {
              const e = ENEMY_TYPES[kind];
              const killed = stats.killsByType[kind] ?? 0;
              const lost = stats.livesLostByType[kind] ?? 0;
              return (
                <div key={kind} className="rounded-xl bg-black/30 border border-white/[0.06] px-3 py-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: e.color, boxShadow: `0 0 6px ${e.color}` }} />
                    <span className="text-[12px] text-white/80 truncate">{e.name}</span>
                  </div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="font-mono font-bold text-[20px] leading-tight text-white tabular-nums">{killed.toLocaleString()}</span>
                    <span className="text-[11px] font-mono tabular-nums text-white/55">{stats.kills > 0 ? Math.round((killed / stats.kills) * 100) : 0}%</span>
                    {lost > 0 && (
                      <span className="ml-auto text-[11px] font-mono font-bold tabular-nums text-[#ff8a95]" title={`${lost} ${lost === 1 ? 'life' : 'lives'} lost to it`}>−{lost} ♥</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-5 flex justify-end">
        <Button variant="primary" size="lg" onClick={onRestart} className="min-w-[220px]">
          <RotateCcw className="w-4 h-4" />Play again
        </Button>
      </div>
    </motion.div>
  );
};
