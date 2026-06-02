import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Play,
  Pause,
  RotateCcw,
  Zap,
  Target,
  Shield,
  CreditCard,
  Layers,
  Activity,
  ArrowUp,
  XCircle,
  Terminal,
  Cpu,
  MoveVertical,
  Crosshair,
  Bomb,
  Lock
} from 'lucide-react';
import { TowerModule } from './TowerModule';
import { GameState, TowerType, TowerInstance, WaveModifier, TargetingMode, DamageType } from '../types';
import { TOWER_STATS, INITIAL_LIVES, WAVES, CANVAS_WIDTH, CANVAS_HEIGHT } from '../constants';

interface UIOverlayProps {
  gameState: GameState;
  towers: TowerInstance[];
  onStartWave: () => void;
  onPauseToggle: () => void;
  onRestart: () => void;
  onPlaceTower: (type: TowerType) => void;
  onUpgradeTower: (id: string) => void;
  onSpecializeTower: (id: string, type: TowerType) => void;
  onSellTower: (id: string) => void;
  onStartRelocation: (id: string) => void;
  onCancelRelocation: () => void;
  onSelectTower: (id: string | null) => void;
  onSetTargetingMode: (id: string, mode: TargetingMode) => void;
  placingType: TowerType | null;
  setPlacingType: (type: TowerType | null) => void;
  renderCanvas: React.ReactNode;
}

const MODIFIER_STYLE: Record<WaveModifier, { label: string; color: string; desc: string }> = {
  [WaveModifier.NONE]:  { label: '',      color: '',                desc: '' },
  [WaveModifier.RUSH]:  { label: 'RUSH',  color: 'text-accent-amber', desc: '1.6× SPEED' },
  [WaveModifier.SWARM]: { label: 'SWARM', color: 'text-accent-red',   desc: '2× COUNT / ½ HP' },
  [WaveModifier.ELITE]: { label: 'ELITE', color: 'text-purple-400',   desc: '½ COUNT / 2× HP / 1.5× ₢' },
};

const DMG_STYLE: Record<DamageType, { label: string; cls: string }> = {
  [DamageType.KINETIC]:   { label: 'KINETIC',   cls: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
  [DamageType.ENERGY]:    { label: 'ENERGY',    cls: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
  [DamageType.EXPLOSIVE]: { label: 'EXPLOSIVE', cls: 'bg-red-500/20 text-red-300 border-red-500/30' },
  [DamageType.FROST]:     { label: 'FROST',     cls: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' },
  [DamageType.FIRE]:      { label: 'FIRE',      cls: 'bg-orange-500/20 text-orange-300 border-orange-500/30' },
};

const MODIFIER_HEX: Record<WaveModifier, string> = {
  [WaveModifier.NONE]:  '#8b949e',
  [WaveModifier.RUSH]:  '#ffb800',
  [WaveModifier.SWARM]: '#ef4444',
  [WaveModifier.ELITE]: '#c084fc',
};

const BASE_TOWER_TYPES = [TowerType.BASIC, TowerType.SNIPER, TowerType.SPLASH] as const;

type IconProps = { className?: string; style?: React.CSSProperties };
const TOWER_ICON: Partial<Record<TowerType, React.ComponentType<IconProps>>> = {
  [TowerType.BASIC]: Crosshair,
  [TowerType.SNIPER]: Target,
  [TowerType.SPLASH]: Bomb,
};

export const UIOverlay: React.FC<UIOverlayProps> = ({
  gameState,
  towers,
  onStartWave,
  onPauseToggle,
  onRestart,
  onUpgradeTower,
  onSpecializeTower,
  onSellTower,
  onStartRelocation,
  onCancelRelocation,
  onSelectTower,
  onSetTargetingMode,
  placingType,
  setPlacingType,
  renderCanvas
}) => {
  const selectedTower = towers.find(t => t.id === gameState.selectedTowerId);

  // --- Responsive arena scaling: grow the fixed-resolution canvas to fill
  //     the available viewport while preserving its 1000×800 aspect ratio. ---
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const [arenaScale, setArenaScale] = React.useState(1);
  React.useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const recompute = () => {
      const k = Math.min(
        el.clientWidth / CANVAS_WIDTH,
        el.clientHeight / CANVAS_HEIGHT
      );
      setArenaScale(Math.max(0.4, k));
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const buildDate = new Date(__BUILD_TIME__);
  const buildLabel = buildDate.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + buildDate.toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' });

  // --- Live log feed ---
  const [logEntries, setLogEntries] = React.useState<{id: number; time: string; text: string; color: string}[]>([
    { id: 0, time: '00:00', text: 'Defense matrix online.', color: '#00f2ff' },
    { id: 1, time: '00:00', text: 'Integrity nominal. Standby.', color: '#8b949e' },
  ]);
  const logRef = React.useRef<HTMLDivElement>(null);
  const logIdRef = React.useRef(2);
  const prevWaveRef = React.useRef(gameState.waveNumber);
  const prevLivesRef = React.useRef(gameState.lives);
  const prevWaveReadyRef = React.useRef(gameState.isWaveReady);

  const addLog = React.useCallback((text: string, color: string) => {
    const now = new Date();
    const time = `${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
    setLogEntries(prev => [...prev.slice(-29), { id: logIdRef.current++, time, text, color }]);
  }, []);

  React.useEffect(() => {
    if (gameState.waveNumber !== prevWaveRef.current && gameState.waveNumber > 0) {
      addLog(`Wave ${gameState.waveNumber} ingress confirmed.`, '#ffb800');
      if (gameState.currentWaveModifier !== WaveModifier.NONE) {
        const m = MODIFIER_STYLE[gameState.currentWaveModifier];
        addLog(`Threat modifier: ${m.label} — ${m.desc}`, MODIFIER_HEX[gameState.currentWaveModifier]);
      }
    }
    prevWaveRef.current = gameState.waveNumber;
  }, [gameState.waveNumber, gameState.currentWaveModifier, addLog]);

  React.useEffect(() => {
    if (gameState.lives < prevLivesRef.current) {
      const lost = prevLivesRef.current - gameState.lives;
      addLog(`Core breach! −${lost} integrity unit${lost > 1 ? 's' : ''}.`, '#ef4444');
      if (gameState.lives <= 5) addLog('CRITICAL: Core integrity failing!', '#ef4444');
    }
    prevLivesRef.current = gameState.lives;
  }, [gameState.lives, addLog]);

  React.useEffect(() => {
    if (gameState.isWaveReady && !prevWaveReadyRef.current && gameState.waveNumber > 0) {
      addLog(`Wave ${gameState.waveNumber} neutralized. Standby.`, '#10b981');
    }
    prevWaveReadyRef.current = gameState.isWaveReady;
  }, [gameState.isWaveReady, addLog]);

  React.useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logEntries]);

  // Per-stat maxima across base towers — used to draw comparative stat bars.
  const baseStatList = BASE_TOWER_TYPES.map(t => TOWER_STATS[t]);
  const maxDmg = Math.max(...baseStatList.map(s => s.damage));
  const maxRange = Math.max(...baseStatList.map(s => s.range));
  const maxRof = Math.max(...baseStatList.map(s => s.fireRate));

  // Tower breakdown by base type
  const towerBreakdown = BASE_TOWER_TYPES.map(base => ({
    base,
    label: base === TowerType.BASIC ? 'Vulcan' : base === TowerType.SNIPER ? 'Rail' : 'Mortar',
    count: towers.filter(t => t.baseType === base).length,
    color: TOWER_STATS[base].color,
  }));

  // Shared glass-panel styling for the modern command-deck sidebar.
  const panelCls = "relative rounded-xl bg-white/[0.025] border border-white/[0.07] backdrop-blur-xl shadow-[0_12px_34px_-14px_rgba(0,0,0,0.8)] overflow-hidden";

  const SectionHeader: React.FC<{
    icon: React.ComponentType<IconProps>;
    label: string;
    accent?: string;
    right?: React.ReactNode;
  }> = ({ icon: Icon, label, accent = '#00f2ff', right }) => (
    <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-white/[0.06] bg-white/[0.015]">
      <span className="h-3.5 w-[3px] rounded-full" style={{ backgroundColor: accent, boxShadow: `0 0 8px ${accent}` }} />
      <Icon className="w-3.5 h-3.5" style={{ color: accent }} />
      <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white/75 font-mono">{label}</span>
      {right && <div className="ml-auto flex items-center">{right}</div>}
    </div>
  );

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-dark-bg text-text-primary">
      {/* TOP BAR */}
      <header className="h-[60px] bg-panel-bg border-b-2 border-border-dim flex items-center px-6 justify-between shrink-0">
        <div className="flex items-center gap-6">
          {/* Credits */}
          <div className="flex flex-col">
            <span className="text-[9px] uppercase tracking-wider text-text-secondary font-mono flex items-center gap-1">
              <CreditCard className="w-3 h-3" /> Credits
            </span>
            <span className="text-xl font-bold font-mono text-accent-cyan drop-shadow-[0_0_8px_rgba(0,242,255,0.5)]">
              ${gameState.money.toLocaleString()}
            </span>
          </div>

          <div className="w-px h-8 bg-border-dim" />

          {/* Core Integrity — segmented bar */}
          <div className="flex flex-col gap-1">
            <span className="text-[9px] uppercase tracking-wider text-text-secondary font-mono flex items-center gap-1">
              <Shield className="w-3 h-3" /> Core Integrity
            </span>
            <div className="flex items-center gap-2">
              <span className={`text-sm font-bold font-mono w-6 tabular-nums ${
                gameState.lives > 10 ? 'text-accent-cyan' : gameState.lives > 5 ? 'text-accent-amber' : 'text-accent-red'
              }`}>{gameState.lives}</span>
              <div className="flex gap-[2px]">
                {Array.from({ length: INITIAL_LIVES }).map((_, i) => (
                  <div
                    key={i}
                    className={`w-[6px] h-[14px] rounded-[2px] transition-all duration-300 ${
                      i < gameState.lives
                        ? gameState.lives > 10
                          ? 'bg-accent-cyan shadow-[0_0_4px_rgba(0,242,255,0.6)]'
                          : gameState.lives > 5
                            ? 'bg-accent-amber shadow-[0_0_4px_rgba(255,184,0,0.6)]'
                            : 'bg-accent-red shadow-[0_0_4px_rgba(239,68,68,0.8)] animate-pulse'
                        : 'bg-white/10'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="w-px h-8 bg-border-dim" />

          {/* Wave Progress — segmented bar */}
          <div className="flex flex-col gap-1">
            <span className="text-[9px] uppercase tracking-wider text-text-secondary font-mono flex items-center gap-1">
              <Activity className="w-3 h-3" /> Wave
            </span>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold font-mono text-accent-amber tabular-nums">
                {gameState.waveNumber.toString().padStart(2, '0')}<span className="text-white/20 text-xs">/{WAVES.length}</span>
              </span>
              <div className="flex gap-[2px]">
                {Array.from({ length: WAVES.length }).map((_, i) => (
                  <div
                    key={i}
                    className={`w-[5px] h-[14px] rounded-[2px] transition-all duration-500 ${
                      i < gameState.waveNumber ? 'bg-accent-amber shadow-[0_0_3px_rgba(255,184,0,0.5)]' : 'bg-white/10'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Wave modifier badge */}
          {gameState.currentWaveModifier !== WaveModifier.NONE && (() => {
            const m = MODIFIER_STYLE[gameState.currentWaveModifier];
            const borderCls = gameState.currentWaveModifier === WaveModifier.RUSH ? 'border-accent-amber/50 bg-accent-amber/5'
              : gameState.currentWaveModifier === WaveModifier.SWARM ? 'border-accent-red/50 bg-accent-red/5'
              : 'border-purple-400/50 bg-purple-400/5';
            return (
              <div className={`flex flex-col justify-center px-3 py-1 border rounded ${borderCls}`}>
                <span className={`text-[8px] uppercase tracking-wider font-mono text-white/40`}>Threat Mode</span>
                <span className={`text-sm font-black font-mono ${m.color} animate-pulse`}>{m.label}</span>
                <span className={`text-[8px] font-mono ${m.color} opacity-60`}>{m.desc}</span>
              </div>
            );
          })()}
        </div>

        <div className="flex gap-3">
          <button 
            onClick={onPauseToggle}
            className="border border-border-dim px-4 py-2 text-xs uppercase font-mono hover:bg-border-dim transition-colors flex items-center gap-2"
          >
            {gameState.isPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
            {gameState.isPaused ? 'Resume' : 'Pause'}
          </button>
          <button 
            onClick={onRestart}
            className="border border-border-dim px-4 py-2 text-xs uppercase font-mono hover:bg-border-dim transition-colors flex items-center gap-2 text-accent-red"
          >
            <RotateCcw className="w-3 h-3" /> Restart
          </button>
          <button
            onClick={onStartWave}
            disabled={gameState.isGameOver || !gameState.isWaveReady}
            className="bg-accent-amber text-dark-bg px-5 py-2 text-xs uppercase font-bold font-mono hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {gameState.isWaveReady ? `Initiate Wave ${gameState.waveNumber + 1}` : 'Wave Active'}
          </button>
          <div className="border-l border-border-dim pl-3 flex flex-col justify-center">
            <span className="text-[8px] uppercase tracking-widest text-white/20 font-mono">Build</span>
            <span className="text-[9px] font-mono text-white/30">{buildLabel}</span>
          </div>
        </div>
      </header>

      {/* MAIN LAYOUT */}
      <main className="flex flex-1 overflow-hidden">
        {/* GAME VIEWPORT */}
        <section
          ref={viewportRef}
          className="flex-1 overflow-hidden flex items-center justify-center bg-[radial-gradient(circle_at_50%_50%,#161b22_0%,#0d1117_100%)]"
        >
          {/*
            Two-div scaling trick:
            - Outer div claims the correct LAYOUT space (scaled dimensions) so
              no overflow / clipping occurs and flex centering works.
            - Inner div contains the raw 1000×800 content and CSS-scales it
              from the top-left corner to visually fill the outer box.
              All overlays (TowerModule, relocation, grid) live here so they
              scale together and stay pixel-aligned with the canvas.
          */}
          <div style={{
            width: CANVAS_WIDTH * arenaScale,
            height: CANVAS_HEIGHT * arenaScale,
            position: 'relative',
            flexShrink: 0,
          }}>
            <div
              className="absolute top-0 left-0 border border-border-dim"
              style={{ transform: `scale(${arenaScale})`, transformOrigin: 'top left' }}
            >
            {renderCanvas}

            {/* Tower Module Overlay */}
            {selectedTower && (
              <TowerModule
                tower={selectedTower}
                gameState={gameState}
                onUpgrade={onUpgradeTower}
                onSpecialize={onSpecializeTower}
                onSell={onSellTower}
                onStartRelocation={onStartRelocation}
                onSetTargetingMode={onSetTargetingMode}
                onClose={() => onSelectTower(null)}
              />
            )}

            {/* Relocation Mode Overlay */}
            {gameState.relocatingTowerId && (
              <div className="absolute inset-0 z-50 bg-accent-amber/5 pointer-events-none flex flex-col items-center justify-center">
                 <div className="bg-panel-bg/90 border-2 border-accent-amber p-6 rounded-xl flex flex-col items-center gap-4 text-center shadow-[0_0_50px_rgba(255,191,0,0.2)] pointer-events-auto">
                    <div className="w-12 h-12 bg-accent-amber/10 rounded-full flex items-center justify-center animate-pulse">
                      <MoveVertical className="w-6 h-6 text-accent-amber" />
                    </div>
                    <div>
                      <h3 className="text-xl font-black text-white uppercase tracking-tighter italic">Relocation Active</h3>
                      <p className="text-xs text-text-secondary font-mono mt-1">Specify new tactical coordinates or abort operation.</p>
                    </div>
                    <button 
                      onClick={onCancelRelocation}
                      className="mt-2 text-[10px] uppercase font-bold text-accent-red hover:text-white transition-colors"
                    >
                      [ Abort Relocation ]
                    </button>
                 </div>
              </div>
            )}

            {/* Grid Overlay simulation */}
            <div className="absolute inset-0 pointer-events-none grid grid-cols-[repeat(20,minmax(0,1fr))] grid-rows-[repeat(15,minmax(0,1fr))] opacity-10">
               {[...Array(300)].map((_, i) => (
                 <div key={i} className="border-[0.5px] border-border-dim" />
               ))}
            </div>

            {/* Placement Indicator Overlay */}
            {placingType && (
              <div className="absolute top-2 left-2 bg-accent-cyan/10 border border-accent-cyan p-2 text-[10px] uppercase tracking-tighter text-accent-cyan font-mono animate-pulse">
                Placing: {TOWER_STATS[placingType].name} | ESC to Cancel
              </div>
            )}
            </div>{/* end scale-inner */}
          </div>{/* end layout-outer */}
        </section>

        {/* SIDEBAR — Command Deck */}
        <aside className="w-[336px] shrink-0 bg-gradient-to-b from-[#15181e] via-[#111419] to-[#0d0f13] border-l border-white/[0.06] flex flex-col gap-4 overflow-y-auto p-4 relative">
          {/* ambient top glow */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-accent-cyan/[0.05] to-transparent" />

          {/* ARSENAL */}
          <section className={panelCls}>
            <SectionHeader
              icon={Crosshair}
              label="Arsenal"
              right={<span className="text-[9px] font-mono text-white/30 tracking-wider">{BASE_TOWER_TYPES.length} UNITS</span>}
            />
            <div className="p-3 space-y-2.5">
              {BASE_TOWER_TYPES.map(type => {
                const stats = TOWER_STATS[type];
                const isAffordable = gameState.money >= stats.cost;
                const isSelected = placingType === type;

                const dmg = DMG_STYLE[stats.damageType];
                const Icon = TOWER_ICON[type] ?? Target;
                const locked = !isAffordable && !isSelected;
                const statRows = [
                  { k: 'DMG', v: `${stats.damage}`, pct: stats.damage / maxDmg },
                  { k: 'RNG', v: `${stats.range}`, pct: stats.range / maxRange },
                  { k: 'ROF', v: `${stats.fireRate}/s`, pct: stats.fireRate / maxRof },
                ];
                return (
                  <button
                    key={type}
                    onClick={() => setPlacingType(isSelected ? null : type)}
                    disabled={locked}
                    className={`group relative w-full rounded-xl p-3 pl-4 text-left transition-all duration-200 overflow-hidden ${
                      isSelected ? 'border border-transparent' : 'border border-white/[0.07] hover:border-white/[0.16] hover:-translate-y-0.5'
                    } ${locked ? 'opacity-55 cursor-not-allowed' : ''}`}
                    style={{
                      background: isSelected
                        ? `linear-gradient(135deg, ${stats.color}26, ${stats.color}05)`
                        : 'rgba(255,255,255,0.02)',
                      boxShadow: isSelected ? `0 0 0 1px ${stats.color}, 0 10px 30px -12px ${stats.color}, inset 0 1px 0 0 rgba(255,255,255,0.06)` : undefined,
                    }}
                  >
                    {/* selected: ambient corner glow */}
                    {isSelected && (
                      <span
                        className="pointer-events-none absolute -right-8 -top-8 w-24 h-24 rounded-full blur-2xl"
                        style={{ backgroundColor: `${stats.color}40` }}
                      />
                    )}
                    {/* color rail */}
                    <span
                      className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-full transition-all"
                      style={{ backgroundColor: stats.color, opacity: isSelected ? 1 : 0.4, boxShadow: isSelected ? `0 0 10px ${stats.color}` : undefined }}
                    />

                    {/* HEADER ROW */}
                    <div className="relative flex gap-3 items-start">
                      <div
                        className="relative w-12 h-12 shrink-0 flex items-center justify-center rounded-xl border transition-transform group-hover:scale-105"
                        style={{
                          background: `radial-gradient(circle at 35% 30%, ${stats.color}33, ${stats.color}0a 70%)`,
                          borderColor: `${stats.color}3d`,
                          boxShadow: `inset 0 0 12px ${stats.color}1f`,
                        }}
                      >
                        <Icon className="w-6 h-6" style={{ color: stats.color, filter: `drop-shadow(0 0 4px ${stats.color}99)` }} />
                        {locked && (
                          <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/55">
                            <Lock className="w-4 h-4 text-white/70" />
                          </span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[15px] font-bold leading-tight truncate text-white tracking-tight">{stats.name}</p>
                          <span
                            className="text-[11px] font-bold font-mono shrink-0 px-2 py-0.5 rounded-md tabular-nums"
                            style={{
                              color: isAffordable ? stats.color : '#ff4d4d',
                              backgroundColor: isAffordable ? `${stats.color}1f` : 'rgba(255,77,77,0.12)',
                              boxShadow: isAffordable ? `0 0 0 1px ${stats.color}33` : '0 0 0 1px rgba(255,77,77,0.25)',
                            }}
                          >
                            ${stats.cost}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                          <span className={`text-[8px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border ${dmg.cls}`}>
                            {dmg.label}
                          </span>
                          {stats.splashRadius && (
                            <span className="text-[8px] font-mono uppercase px-1.5 py-0.5 rounded border bg-white/5 border-white/10 text-white/55">
                              SPLASH {stats.splashRadius}px
                            </span>
                          )}
                          {stats.isPiercing && (
                            <span className="text-[8px] font-mono uppercase px-1.5 py-0.5 rounded border bg-white/5 border-white/10 text-white/55">
                              PIERCE
                            </span>
                          )}
                          {stats.slowEffect && (
                            <span className="text-[8px] font-mono uppercase px-1.5 py-0.5 rounded border bg-cyan-500/10 border-cyan-500/20 text-cyan-400/75">
                              SLOW {stats.slowEffect * 100}%
                            </span>
                          )}
                          {stats.burnDamage && (
                            <span className="text-[8px] font-mono uppercase px-1.5 py-0.5 rounded border bg-orange-500/10 border-orange-500/20 text-orange-400/75">
                              BURN {stats.burnDamage}/s
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* EXPANDED DETAIL — selected only: stat bars + full description.
                        Collapsed cards stay compact so all weapons fit without scrolling. */}
                    {isSelected && (
                      <>
                        <div className="grid grid-cols-3 gap-2.5 mt-3">
                          {statRows.map(({ k, v, pct }) => (
                            <div key={k}>
                              <div className="flex items-baseline justify-between">
                                <span className="text-[7px] font-mono text-white/35 tracking-[0.1em]">{k}</span>
                                <span className="text-[10px] font-mono font-bold text-white/85 tabular-nums leading-none">{v}</span>
                              </div>
                              <div className="mt-1 h-[3px] rounded-full bg-white/[0.08] overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all duration-300"
                                  style={{ width: `${Math.max(8, Math.min(100, pct * 100))}%`, backgroundColor: stats.color, boxShadow: `0 0 6px ${stats.color}aa` }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                        <p className="text-[10px] text-white/50 font-mono mt-3 leading-relaxed">{stats.description}</p>
                        <div className="mt-2.5 flex items-center gap-1.5 text-[8px] font-mono uppercase tracking-[0.12em]" style={{ color: stats.color }}>
                          <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: stats.color, boxShadow: `0 0 6px ${stats.color}` }} />
                          Click map to deploy · ESC to cancel
                        </div>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          {/* BATTLEFIELD INTEL */}
          <section className={panelCls}>
            <SectionHeader
              icon={Layers}
              label="Battlefield Intel"
              right={<Activity className="w-3 h-3 animate-pulse text-accent-cyan" />}
            />

            {/* Stat tiles 2×2 */}
            <div className="grid grid-cols-2 gap-2 p-3">
              {[
                { label: 'Deployed', value: towers.length.toString(), color: '#00f2ff', icon: Cpu },
                { label: 'Status', value: gameState.isWaveReady ? 'STANDBY' : 'ACTIVE', color: gameState.isWaveReady ? '#8b949e' : '#ff4d4d', pulse: !gameState.isWaveReady, icon: Activity },
                { label: 'Wave Bonus', value: `$${gameState.isWaveReady ? 120 + gameState.waveNumber * 25 : 120 + (gameState.waveNumber - 1) * 25}`, color: '#ffb800', icon: CreditCard },
                { label: 'Integrity', value: `${Math.round((gameState.lives / INITIAL_LIVES) * 100)}%`, color: gameState.lives > 10 ? '#00f2ff' : gameState.lives > 5 ? '#ffb800' : '#ff4d4d', pulse: gameState.lives <= 5, icon: Shield },
              ].map(({ label, value, color, pulse, icon: Icon }) => (
                <div key={label} className="relative rounded-lg bg-black/30 border border-white/[0.05] px-3 py-2.5 overflow-hidden">
                  <Icon className="absolute -right-2.5 -top-2.5 w-12 h-12 opacity-[0.06]" style={{ color }} />
                  <span className="text-[8px] uppercase tracking-wider text-white/35 font-mono">{label}</span>
                  <div className={`text-base font-black font-mono tabular-nums leading-tight mt-0.5 ${pulse ? 'animate-pulse' : ''}`} style={{ color }}>{value}</div>
                </div>
              ))}
            </div>

            {/* Tower type breakdown */}
            <div className="px-4 pb-3 space-y-2">
              <span className="text-[8px] uppercase tracking-widest text-white/30 font-mono">Defense Grid</span>
              {towerBreakdown.map(({ base, label, count, color }) => (
                <div key={base} className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: color, opacity: 0.85, boxShadow: count > 0 ? `0 0 6px ${color}80` : undefined }} />
                  <span className="text-[9px] font-mono text-white/50 w-12">{label}</span>
                  <div className="flex-1 flex gap-0.5 h-1.5">
                    {count > 0
                      ? Array.from({ length: count }).map((_, i) => (
                          <div key={i} className="flex-1 rounded-full" style={{ backgroundColor: color, opacity: 0.65 }} />
                        ))
                      : <div className="flex-1 rounded-full bg-white/5" />
                    }
                  </div>
                  <span className="text-[9px] font-mono text-white/40 w-3 text-right tabular-nums">{count}</span>
                </div>
              ))}
            </div>

            {/* Active modifier strip */}
            {gameState.currentWaveModifier !== WaveModifier.NONE && (() => {
              const m = MODIFIER_STYLE[gameState.currentWaveModifier];
              const hex = MODIFIER_HEX[gameState.currentWaveModifier];
              return (
                <div className="px-4 py-2 flex items-center gap-2" style={{ backgroundColor: `${hex}10`, borderTop: `1px solid ${hex}30` }}>
                  <Zap className="w-3 h-3 shrink-0" style={{ color: hex }} />
                  <span className="text-[9px] font-black font-mono uppercase" style={{ color: hex }}>{m.label}</span>
                  <span className="text-[8px] font-mono opacity-60 ml-auto" style={{ color: hex }}>{m.desc}</span>
                </div>
              );
            })()}

            {/* Neural link hint when nothing selected */}
            {!selectedTower && (
              <div className="px-4 py-3 flex items-center gap-3 opacity-30 border-t border-white/[0.04]">
                <Cpu className="w-4 h-4 shrink-0 animate-[spin_8s_linear_infinite]" />
                <p className="text-[9px] text-text-secondary font-mono leading-relaxed">Select a unit on the map to inspect and control it.</p>
              </div>
            )}
          </section>

          {/* SYSTEM FEED — scrolling log */}
          <section className={`${panelCls} h-[150px] flex flex-col shrink-0`}>
            <SectionHeader
              icon={Terminal}
              label="System Feed"
              right={<div className="w-1.5 h-1.5 rounded-full bg-accent-cyan animate-pulse shadow-[0_0_6px_#00f2ff]" />}
            />
            <div ref={logRef} className="flex-1 overflow-y-auto px-3.5 py-2 space-y-0.5 scrollbar-none bg-black/30">
              {logEntries.map(entry => (
                <div key={entry.id} className="flex gap-2 items-baseline font-mono text-[9px] leading-relaxed">
                  <span className="text-white/20 shrink-0 tabular-nums">{entry.time}</span>
                  <span style={{ color: entry.color }}>{'>'} {entry.text}</span>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </main>

      {/* OVERLAYS */}
      <AnimatePresence>
        {gameState.isWaveReady && !gameState.isGameOver && gameState.waveNumber > 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.05 }}
            className="absolute inset-x-0 top-1/2 -translate-y-1/2 z-[500] flex flex-col items-center justify-center p-12 bg-[#0d1117]/80 backdrop-blur-md border-y-2 border-accent-amber shadow-[0_0_100px_rgba(255,191,0,0.15)]"
          >
            {/* Static accent lines — top and bottom */}
            <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-accent-amber to-transparent opacity-50" />
            <div className="absolute bottom-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-accent-amber to-transparent opacity-50" />

            <div className="flex flex-col items-center max-w-xl text-center">
              <span className="text-[10px] uppercase tracking-[0.5em] text-accent-amber mb-4 font-black">
                Aegis Matrix Stable
              </span>
              <h2 className="text-6xl font-black text-white italic tracking-tighter mb-2">
                WAVE {gameState.waveNumber} CLEARED
              </h2>
              <p className="text-text-secondary font-mono text-sm leading-relaxed mb-8">
                Defensive protocols verified. Threat level currently neutralized. 
                Prepare resources and authorize the initiation of the next encounter cycle.
              </p>
              
              {(() => {
                const upcoming = WAVES[gameState.waveNumber];
                const mod = upcoming?.modifier;
                if (!mod || mod === WaveModifier.NONE) return null;
                const m = MODIFIER_STYLE[mod];
                return (
                  <div className={`mb-4 px-5 py-2 border rounded-lg flex flex-col items-center gap-0.5 ${
                    mod === WaveModifier.RUSH  ? 'border-accent-amber/40 bg-accent-amber/5' :
                    mod === WaveModifier.SWARM ? 'border-accent-red/40 bg-accent-red/5' :
                    'border-purple-400/40 bg-purple-400/5'
                  }`}>
                    <span className={`text-xs font-black uppercase tracking-widest ${m.color}`}>⚠ {m.label} WAVE INCOMING</span>
                    <span className={`text-[10px] font-mono ${m.color} opacity-70`}>{m.desc}</span>
                  </div>
                );
              })()}
              <div className="flex gap-4">
                <button
                  onClick={onStartWave}
                  className="group relative px-10 py-3 bg-accent-amber text-dark-bg font-black uppercase tracking-widest text-lg hover:brightness-110 active:scale-95 transition-all flex items-center gap-3"
                >
                  <Zap className="w-5 h-5 fill-current" />
                  Initiate Wave {gameState.waveNumber + 1}
                </button>
              </div>
            </div>
            
          </motion.div>
        )}

        {gameState.isGameOver && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 bg-dark-bg/95 flex flex-col items-center justify-center z-[1000] border-4 border-accent-red m-10"
          >
            <div className="absolute top-0 left-0 w-full p-4 border-b border-accent-red flex justify-between uppercase font-mono text-[10px] tracking-widest text-accent-red/50">
               <span>System Failure</span>
               <span>Fatal Error : 0xDEADBEEF</span>
            </div>
            <motion.h2 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="text-8xl font-black mb-2 text-accent-red tracking-tighter italic"
            >
              BREACHED
            </motion.h2>
            <div className="w-[400px] h-[1px] bg-accent-red/30 mb-8" />
            <p className="text-text-secondary font-mono mb-12 uppercase tracking-[0.2em] text-sm">
               Wave {gameState.waveNumber} final survival record
            </p>
            <button 
              onClick={onRestart}
              className="group relative px-12 py-4 bg-accent-red text-dark-bg font-black uppercase tracking-widest text-xl hover:bg-accent-red/90 transition-all flex items-center gap-3"
            >
              Reboot Aegis
              <RotateCcw className="w-6 h-6 group-hover:rotate-180 transition-transform duration-500" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
