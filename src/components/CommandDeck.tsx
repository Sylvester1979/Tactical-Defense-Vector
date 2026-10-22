import React from 'react';
import { Crosshair, Target, Bomb, Lock, Radar, Layers, Zap, AlertTriangle, ChevronRight } from 'lucide-react';
import { DamageType, GameState, TowerInstance, TowerStats, TowerType, WaveModifier } from '../types';
import {
  BASE_TOWERS, ENEMY_TYPES, SPECIALIZATIONS, TOWER_STATS,
  getEnemyHealth, getFireInterval, getSellValue, getWaveBonus, getWaveConfig,
} from '../constants';
import { towerDamage } from '../game/sim';
import { DMG_STYLE, MODIFIER_HEX, MODIFIER_STYLE } from './uiStyles';

// The sidebar: what to build, what is coming and how well the grid answers it, and what the
// grid is made of. Everything here is derived from the game rules, so it can't drift from them.

interface CommandDeckProps {
  gameState: GameState;
  towers: TowerInstance[];
  placingType: TowerType | null;
  setPlacingType: (type: TowerType | null) => void;
  // Enemies of the running wave still to beat (alive or yet to spawn), by kind; null between waves
  waveRemaining: Record<string, number> | null;
}

type IconProps = { className?: string; style?: React.CSSProperties };
const TOWER_ICON: Record<string, React.ComponentType<IconProps>> = {
  [TowerType.BASIC]: Crosshair,
  [TowerType.SNIPER]: Target,
  [TowerType.SPLASH]: Bomb,
};

const ROLE: Record<string, string> = {
  [TowerType.BASIC]: 'Light & fast targets',
  [TowerType.SNIPER]: 'Armour & bosses',
  [TowerType.SPLASH]: 'Packed crowds',
};

const SPEC_TRAIT: Partial<Record<TowerType, string>> = {
  [TowerType.VULCAN_TITAN]: 'armour-piercing',
  [TowerType.VULCAN_STING]: 'hyper-rate, longer reach',
  [TowerType.RAILGUN_PIERCER]: 'pierces whole lines',
  [TowerType.RAILGUN_HYPER]: 'boss killer',
  [TowerType.MORTAR_CRYO]: 'slows 50%',
  [TowerType.MORTAR_BOMBER]: 'sets crowds ablaze',
};

const FAMILY: Record<string, string> = {
  [TowerType.BASIC]: 'Vulcan',
  [TowerType.SNIPER]: 'Railgun',
  [TowerType.SPLASH]: 'Mortar',
};

const DAMAGE_TYPES = Object.values(DamageType) as DamageType[];

// Damage per second against one target: direct hits plus burn, at the tower's level
const towerDps = (t: TowerInstance) => {
  const s = TOWER_STATS[t.type];
  const scale = towerDamage(t) / s.damage;
  return towerDamage(t) / getFireInterval(t.type, t.level) + (s.burnDamage ? s.burnDamage * scale : 0);
};

// How hard a tower's damage lands on an enemy kind (resistances, weaknesses, armour-piercing)
const damageMult = (kind: string, s: TowerStats) => {
  const r = ENEMY_TYPES[kind].resistances?.[s.damageType] ?? 1;
  return s.armorPiercing ? Math.max(1, r) : r;
};

// Damage types worth bringing against a kind: its weaknesses, or failing that whatever it doesn't resist
const counters = (kind: string) => {
  const res = ENEMY_TYPES[kind].resistances ?? {};
  const weak = DAMAGE_TYPES.filter(d => (res[d] ?? 1) > 1);
  return weak.length ? weak : DAMAGE_TYPES.filter(d => (res[d] ?? 1) >= 1);
};

const panelCls = 'relative shrink-0 rounded-xl bg-white/[0.025] border border-white/[0.07] backdrop-blur-xl shadow-[0_12px_34px_-14px_rgba(0,0,0,0.8)] overflow-hidden';

const SectionHeader: React.FC<{ icon: React.ComponentType<IconProps>; label: string; accent?: string; right?: React.ReactNode }> =
  ({ icon: Icon, label, accent = '#00f2ff', right }) => (
    <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-white/[0.06] bg-white/[0.015]">
      <span className="h-3.5 w-[3px] rounded-full" style={{ backgroundColor: accent, boxShadow: `0 0 8px ${accent}` }} />
      <Icon className="w-3.5 h-3.5" style={{ color: accent }} />
      <span className="font-display font-semibold text-[12px] uppercase tracking-[0.16em] text-white/80">{label}</span>
      {right && <div className="ml-auto flex items-center">{right}</div>}
    </div>
  );

const Chip: React.FC<{ cls: string; children: React.ReactNode }> = ({ cls, children }) => (
  <span className={`text-[10px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border ${cls}`}>{children}</span>
);

export const CommandDeck: React.FC<CommandDeckProps> = ({ gameState, towers, placingType, setPlacingType, waveRemaining }) => {
  // ── The grid: total damage and its split by damage type ──
  const grid = React.useMemo(() => {
    const byType = Object.fromEntries(DAMAGE_TYPES.map(d => [d, 0])) as Record<DamageType, number>;
    const dps = towers.map(t => towerDps(t));
    towers.forEach((t, i) => { byType[TOWER_STATS[t.type].damageType] += dps[i]; });
    const total = dps.reduce((a, b) => a + b, 0);
    // Share of the grid's damage that lands on a kind, after resistances (1 = full)
    const fit = (kind: string) => total > 0
      ? towers.reduce((a, t, i) => a + dps[i] * damageMult(kind, TOWER_STATS[t.type]), 0) / total
      : 0;
    return { total, byType, fit, value: towers.reduce((a, t) => a + getSellValue(t), 0) };
  }, [towers]);

  // ── The threat: the next wave between waves, what's left of the current one during it ──
  const live = !gameState.isWaveReady && waveRemaining !== null;
  const threatWave = live ? gameState.waveNumber : gameState.waveNumber + 1;
  const cfg = getWaveConfig(threatWave);
  const counts = live ? waveRemaining! : cfg.counts;
  const remaining = Object.values(counts).reduce((a, b) => a + b, 0);
  const kinds = cfg.enemyTypes.filter(k => (counts[k] ?? 0) > 0);
  // The kind the grid answers worst, if it answers it badly
  const weakest = towers.length && kinds.length
    ? kinds.reduce((a, b) => (grid.fit(b) < grid.fit(a) ? b : a))
    : null;
  const warn = weakest && grid.fit(weakest) < 0.8 ? weakest : null;
  const modHex = MODIFIER_HEX[cfg.modifier];

  return (
    <aside className="w-[336px] shrink-0 bg-gradient-to-b from-[#15181e] via-[#111419] to-[#0d0f13] border-l border-white/[0.06] flex flex-col gap-3 overflow-y-auto p-3.5 relative">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-accent-cyan/[0.05] to-transparent" />

      {/* ── BUILD ── */}
      <section className={panelCls}>
        <SectionHeader icon={Crosshair} label="Build" right={<span className="text-[11px] font-mono text-white/50 tracking-wider">KEYS 1–3</span>} />
        <div className="p-2 space-y-1.5">
          {BASE_TOWERS.map((type, idx) => {
            const stats = TOWER_STATS[type];
            const affordable = gameState.money >= stats.cost;
            const selected = placingType === type;
            const locked = !affordable && !selected;
            const Icon = TOWER_ICON[type];
            return (
              <button
                key={type}
                onClick={() => setPlacingType(selected ? null : type)}
                disabled={locked}
                className={`group relative w-full rounded-lg px-2.5 py-1.5 text-left transition-all duration-150 overflow-hidden border ${
                  selected ? 'border-transparent' : 'border-white/[0.07] hover:border-white/[0.18]'
                } ${locked ? 'opacity-50 cursor-not-allowed' : ''}`}
                style={{
                  background: selected ? `linear-gradient(135deg, ${stats.color}26, ${stats.color}05)` : 'rgba(255,255,255,0.02)',
                  boxShadow: selected ? `0 0 0 1px ${stats.color}, 0 10px 30px -14px ${stats.color}` : undefined,
                }}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className="relative w-9 h-9 shrink-0 flex items-center justify-center rounded-lg border"
                    style={{ background: `radial-gradient(circle at 35% 30%, ${stats.color}33, ${stats.color}0a 70%)`, borderColor: `${stats.color}3d` }}
                  >
                    <Icon className="w-5 h-5" style={{ color: stats.color, filter: `drop-shadow(0 0 4px ${stats.color}99)` }} />
                    <kbd className="absolute -bottom-1.5 -right-1.5 min-w-[15px] h-[15px] px-1 rounded bg-[#0d1117] border border-white/15 text-[10px] font-mono font-bold text-white/60 flex items-center justify-center leading-none">
                      {idx + 1}
                    </kbd>
                    {locked && (
                      <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/55">
                        <Lock className="w-3.5 h-3.5 text-white/70" />
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-display font-semibold text-[14px] tracking-[0.02em] leading-tight truncate text-white">{stats.name}</span>
                      <span
                        className="text-[11px] font-bold font-mono shrink-0 px-1.5 py-0.5 rounded tabular-nums"
                        style={{ color: affordable ? stats.color : '#ff4d4d', backgroundColor: affordable ? `${stats.color}1f` : 'rgba(255,77,77,0.12)' }}
                      >
                        ${stats.cost}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <Chip cls={DMG_STYLE[stats.damageType].cls}>{DMG_STYLE[stats.damageType].label}</Chip>
                      <span className="text-[11px] font-mono text-white/45 truncate">{ROLE[type]}</span>
                    </div>
                  </div>
                </div>

                {selected && (
                  <div className="mt-2.5 space-y-2">
                    <div className="grid grid-cols-3 gap-1.5 text-center">
                      {[
                        ['DMG', `${stats.damage}`],
                        ['RANGE', `${stats.range}`],
                        ['RATE', `${stats.fireRate}/s`],
                      ].map(([k, v]) => (
                        <div key={k} className="rounded bg-black/30 py-1">
                          <div className="text-[10px] font-mono text-white/50 tracking-widest">{k}</div>
                          <div className="text-[11px] font-mono font-bold text-white/85 tabular-nums">{v}</div>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-1">
                      <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/50">Level 3 specializes into</div>
                      {SPECIALIZATIONS[type].map(spec => (
                        <div key={spec} className="flex items-center gap-1.5 text-[11px] font-mono">
                          <ChevronRight className="w-3 h-3 shrink-0" style={{ color: TOWER_STATS[spec].color }} />
                          <span className="font-bold" style={{ color: TOWER_STATS[spec].color }}>{TOWER_STATS[spec].name}</span>
                          <span className="text-white/45 truncate">{SPEC_TRAIT[spec]}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* ── THREAT ── */}
      {!gameState.isGameOver && (
        <section className={panelCls}>
          <SectionHeader
            icon={Radar}
            label={live ? `Wave ${threatWave} · Live` : `Next · Wave ${threatWave}`}
            accent={live ? '#ff4d4d' : '#ffb800'}
            right={
              <span className="text-[10px] font-mono font-bold tabular-nums" style={{ color: live ? '#ff4d4d' : '#ffb800' }}>
                {live ? `${remaining} left` : `×${cfg.count}`}
                <span className="text-white/50 font-normal"> · </span>
                <span className="text-accent-amber" title="Credits for clearing the wave">+${getWaveBonus(threatWave)}</span>
              </span>
            }
          />
          {live && (
            <div className="h-1 bg-white/[0.06]">
              <div className="h-full bg-accent-red/80 transition-all duration-300" style={{ width: `${(1 - remaining / cfg.count) * 100}%` }} />
            </div>
          )}
          {cfg.modifier !== WaveModifier.NONE && (
            <div className="px-3.5 py-1.5 flex items-center gap-2" style={{ backgroundColor: `${modHex}10`, borderBottom: `1px solid ${modHex}30` }}>
              <Zap className="w-3 h-3 shrink-0" style={{ color: modHex }} />
              <span className="text-[11px] font-black font-mono uppercase" style={{ color: modHex }}>{MODIFIER_STYLE[cfg.modifier].label}</span>
              <span className="text-[10px] font-mono opacity-70 ml-auto" style={{ color: modHex }}>{MODIFIER_STYLE[cfg.modifier].desc}</span>
            </div>
          )}
          <div className="p-2 space-y-1">
            {kinds.map(kind => {
              const e = ENEMY_TYPES[kind];
              const hp = Math.round(getEnemyHealth(kind, threatWave, cfg.healthMult));
              const res = Object.entries(e.resistances ?? {}) as [DamageType, number][];
              const leak = e.leakDamage ?? 1;
              const fit = grid.fit(kind);
              const fitCol = fit >= 1 ? '#34d399' : fit >= 0.8 ? '#ffb800' : '#ff4d4d';
              return (
                <div key={kind} className="rounded-lg bg-black/30 border border-white/[0.05] px-2.5 py-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: e.color, boxShadow: `0 0 6px ${e.color}` }} />
                    <span className="text-[10px] font-bold text-white/85 truncate">{e.name}</span>
                    <span className="text-[11px] font-mono font-bold text-accent-amber tabular-nums">×{counts[kind]}</span>
                    <span className="ml-auto text-[11px] font-mono text-white/45 tabular-nums whitespace-nowrap">{hp} HP · {Math.round(e.speed * cfg.speedMult)} SPD</span>
                  </div>
                  <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                    {res.map(([dt, mult]) => (
                      <Chip key={dt} cls={mult > 1 ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300' : 'bg-red-500/10 border-red-500/25 text-red-300'}>
                        {mult > 1 ? 'Weak' : 'Resists'} {dt.slice(0, 4)} ×{mult}
                      </Chip>
                    ))}
                    {leak > 1 && <Chip cls="bg-amber-500/10 border-amber-500/25 text-amber-300">Leak −{leak}</Chip>}
                    {towers.length > 0 && (
                      <span className="ml-auto text-[10px] font-mono font-bold tabular-nums" style={{ color: fitCol }} title="Share of your grid's damage that lands on this enemy after resistances">
                        GRID {Math.round(fit * 100)}%
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {warn && (
            <div className="mx-2 mb-2 rounded-lg border border-accent-red/30 bg-accent-red/[0.07] px-2.5 py-1.5 flex gap-2 items-start">
              <AlertTriangle className="w-3.5 h-3.5 text-accent-red shrink-0 mt-0.5" />
              <div className="text-[11px] font-mono leading-snug text-white/70">
                Your grid is weak against <span className="text-white font-bold">{ENEMY_TYPES[warn].name}</span>. Counter with{' '}
                {counters(warn).map((d, i) => (
                  <React.Fragment key={d}>
                    {i > 0 && ' · '}
                    <span className="font-bold" style={{ color: DMG_STYLE[d].hex }}>{DMG_STYLE[d].label}</span>
                  </React.Fragment>
                ))}
                {(ENEMY_TYPES[warn].resistances?.[DamageType.KINETIC] ?? 1) < 1 && <> or a {TOWER_STATS[TowerType.VULCAN_TITAN].name}</>}.
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── GRID ── */}
      <section className={panelCls}>
        <SectionHeader icon={Layers} label="Defense Grid" right={<span className="text-[11px] font-mono text-white/50 tracking-wider">{towers.length} UNITS</span>} />
        {towers.length === 0 ? (
          <p className="px-3.5 py-3 text-[11px] font-mono text-white/50 leading-relaxed">No towers yet. Pick one above and click the map — anywhere off the road.</p>
        ) : (
          <div className="p-3 space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-black/30 border border-white/[0.05] px-2.5 py-1.5">
                <div className="text-[10px] uppercase tracking-widest text-white/50 font-mono">Damage / s</div>
                <div className="text-[15px] font-black font-mono tabular-nums text-accent-cyan leading-tight">{Math.round(grid.total).toLocaleString()}</div>
              </div>
              <div className="rounded-lg bg-black/30 border border-white/[0.05] px-2.5 py-1.5">
                <div className="text-[10px] uppercase tracking-widest text-white/50 font-mono">Resale value</div>
                <div className="text-[15px] font-black font-mono tabular-nums text-white/80 leading-tight">${grid.value.toLocaleString()}</div>
              </div>
            </div>
            <div>
              <div className="flex h-2 rounded-full overflow-hidden bg-white/[0.06]">
                {DAMAGE_TYPES.filter(d => grid.byType[d] > 0).map(d => (
                  <div key={d} style={{ width: `${(grid.byType[d] / grid.total) * 100}%`, backgroundColor: DMG_STYLE[d].hex }} />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 mt-1.5">
                {DAMAGE_TYPES.filter(d => grid.byType[d] > 0).map(d => (
                  <span key={d} className="flex items-center gap-1 text-[10px] font-mono text-white/50">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: DMG_STYLE[d].hex }} />
                    {DMG_STYLE[d].label} {Math.round((grid.byType[d] / grid.total) * 100)}%
                  </span>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              {BASE_TOWERS.map(base => {
                const family = towers.filter(t => t.baseType === base);
                if (!family.length) return null;
                const parts = [base, ...SPECIALIZATIONS[base]]
                  .map(type => ({ type, n: family.filter(t => t.type === type).length }))
                  .filter(p => p.n > 0);
                return (
                  <div key={base} className="flex items-center gap-2 text-[11px] font-mono">
                    <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: TOWER_STATS[base].color }} />
                    <span className="text-white/70 w-12">{FAMILY[base]}</span>
                    <span className="text-white/40 truncate">
                      {parts.map((p, i) => (
                        <React.Fragment key={p.type}>
                          {i > 0 && ' · '}
                          <span style={{ color: p.type === base ? undefined : TOWER_STATS[p.type].color }}>
                            {p.type === base ? 'Base' : TOWER_STATS[p.type].name.split(' ')[0]} {p.n}
                          </span>
                        </React.Fragment>
                      ))}
                    </span>
                    <span className="ml-auto text-white/55 tabular-nums">{family.length}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </aside>
  );
};
