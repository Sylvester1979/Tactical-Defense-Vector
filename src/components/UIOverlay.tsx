import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Play,
  Pause,
  RotateCcw,
  Zap,
  Shield,
  CreditCard,
  Activity,
  MoveVertical,
  Crosshair,
  Volume2,
  VolumeX,
  HelpCircle,
} from 'lucide-react';
import { TowerModule } from './TowerModule';
import { CommandDeck } from './CommandDeck';
import { MODIFIER_HEX, MODIFIER_STYLE } from './uiStyles';
import { GameState, TowerType, TowerInstance, WaveModifier, TargetingMode } from '../types';
import { TOWER_STATS, INITIAL_LIVES, WAVES, CANVAS_WIDTH, CANVAS_HEIGHT, RELOCATION_FEE, getWaveConfig } from '../constants';

interface UIOverlayProps {
  gameState: GameState;
  towers: TowerInstance[];
  onStartWave: () => void;
  onPauseToggle: () => void;
  onRestart: () => void;
  onCycleSpeed: () => void;
  muted: boolean;
  onToggleMute: () => void;
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
  bestWaves: number;
  newRecord: boolean;
  // Flat screen-space grid over the arena; it suits the 2D renderer but not the 3D scene's perspective
  screenGrid: boolean;
  // False while the 3D models are still loading: starting a wave waits for them
  assetsReady: boolean;
  // Enemies of the running wave still to beat, by kind; null between waves
  waveRemaining: Record<string, number> | null;
}

const CONTROLS: [string, string][] = [
  ['1 · 2 · 3', 'Pick a tower to build'],
  ['Click', 'Place / inspect a tower'],
  ['Right-click · Esc', 'Cancel placing or moving'],
  ['U', 'Upgrade selected tower'],
  ['R', 'Move selected tower'],
  ['S S', 'Sell selected tower'],
  ['T', 'Cycle targeting'],
  ['Space', 'Start next wave'],
  ['F', 'Game speed'],
  ['P', 'Pause'],
  ['M', 'Mute'],
  ['?', 'This help'],
];

// How long the wave-start banner stays up
const WAVE_BANNER_MS = 2600;

export const UIOverlay: React.FC<UIOverlayProps> = ({
  gameState,
  towers,
  onStartWave,
  onPauseToggle,
  onRestart,
  onCycleSpeed,
  muted,
  onToggleMute,
  onUpgradeTower,
  onSpecializeTower,
  onSellTower,
  onStartRelocation,
  onCancelRelocation,
  onSelectTower,
  onSetTargetingMode,
  placingType,
  setPlacingType,
  renderCanvas,
  bestWaves,
  newRecord,
  screenGrid,
  assetsReady,
  waveRemaining,
}) => {
  const selectedTower = towers.find(t => t.id === gameState.selectedTowerId);

  // Controls reference: the ? button or key opens it, Esc or a click anywhere closes it
  const [showHelp, setShowHelp] = React.useState(false);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '?') setShowHelp(v => !v);
      else if (e.key === 'Escape') setShowHelp(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const relocatingTower = towers.find(t => t.id === gameState.relocatingTowerId);

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


  const prevWaveRef = React.useRef(gameState.waveNumber);
  const prevLivesRef = React.useRef(gameState.lives);

  // Transient arena callouts: wave-start banner and core-hit flash (keys retrigger animations)
  const [waveBanner, setWaveBanner] = React.useState<{ key: number; wave: number; count: number; modifier: WaveModifier; boss: boolean } | null>(null);
  const [coreHit, setCoreHit] = React.useState<{ key: number; lost: number } | null>(null);
  const bannerTimerRef = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(bannerTimerRef.current), []);

  React.useEffect(() => {
    if (gameState.waveNumber !== prevWaveRef.current && gameState.waveNumber > 0) {
      const cfg = getWaveConfig(gameState.waveNumber);
      setWaveBanner({
        key: Date.now(), wave: gameState.waveNumber, count: cfg.count,
        modifier: gameState.currentWaveModifier, boss: cfg.enemyTypes.includes('COLOSSUS'),
      });
      window.clearTimeout(bannerTimerRef.current);
      bannerTimerRef.current = window.setTimeout(() => setWaveBanner(null), WAVE_BANNER_MS);
    }
    prevWaveRef.current = gameState.waveNumber;
  }, [gameState.waveNumber, gameState.currentWaveModifier]);

  React.useEffect(() => {
    if (gameState.lives < prevLivesRef.current) setCoreHit({ key: Date.now(), lost: prevLivesRef.current - gameState.lives });
    prevLivesRef.current = gameState.lives;
  }, [gameState.lives]);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-dark-bg text-text-primary">
      {/* TOP BAR */}
      <header
        className="h-14 shrink-0 relative z-[80] flex items-center px-5 gap-3 border-b border-white/[0.06]"
        style={{ background: 'linear-gradient(to bottom, rgba(20,23,30,0.98), rgba(14,17,23,0.99))', backdropFilter: 'blur(24px)' }}
      >
        {/* hairline cyan glow along the bottom edge */}
        <div className="pointer-events-none absolute bottom-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-accent-cyan/20 to-transparent" />

        {/* ── CENTER TITLE ── absolutely centered so side groups never shift it */}
        <div className="pointer-events-none select-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-4">
          {/* left decorative rule */}
          <div className="hidden xl:flex items-center gap-2">
            <span className="h-px w-12 bg-gradient-to-r from-transparent to-accent-cyan/45" />
            <span className="w-[7px] h-[7px] rotate-45 bg-accent-cyan/80" style={{ boxShadow: '0 0 10px #00f2ff' }} />
          </div>

          <div className="flex flex-col items-center leading-none">
            <h1 className="relative whitespace-nowrap">
              {/* glow underlay */}
              <span
                className="absolute inset-0 text-[23px] font-black italic tracking-[0.17em] text-accent-cyan blur-[10px] opacity-60"
                aria-hidden
              >
                TACTICAL DEFENSE VECTOR
              </span>
              {/* chrome→cyan gradient face */}
              <span
                className="relative text-[23px] font-black italic tracking-[0.17em]"
                style={{
                  background: 'linear-gradient(180deg, #ffffff 0%, #d4f7ff 42%, #4fe3ff 72%, #00c8df 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                  filter: 'drop-shadow(0 1px 0 rgba(0,0,0,0.5)) drop-shadow(0 0 16px rgba(0,242,255,0.35))',
                }}
              >
                TACTICAL DEFENSE VECTOR
              </span>
            </h1>
            <span className="text-[7px] tracking-[0.62em] uppercase text-accent-cyan/45 font-mono mt-[5px] pl-[0.62em]">
              Aegis Defense Matrix
            </span>
          </div>

          {/* right decorative rule */}
          <div className="hidden xl:flex items-center gap-2">
            <span className="w-[7px] h-[7px] rotate-45 bg-accent-cyan/80" style={{ boxShadow: '0 0 10px #00f2ff' }} />
            <span className="h-px w-12 bg-gradient-to-l from-transparent to-accent-cyan/45" />
          </div>
        </div>

        {/* ── STAT PILLS (left) ── */}
        <div className="flex items-stretch gap-2 shrink-0">

          {/* Credits */}
          <div className="flex items-center gap-2.5 px-3.5 rounded-xl bg-white/[0.04] border border-white/[0.06]">
            <CreditCard className="w-3.5 h-3.5 text-accent-cyan/55 shrink-0" />
            <div>
              <div className="text-[7px] uppercase tracking-widest text-white/28 font-mono leading-none">Credits</div>
              <div
                className="text-[17px] font-black font-mono text-accent-cyan tabular-nums leading-tight mt-0.5"
                style={{ textShadow: '0 0 16px rgba(0,242,255,0.55)' }}
              >
                ${gameState.money.toLocaleString()}
              </div>
            </div>
          </div>

          {/* Core Integrity */}
          {(() => {
            const col = gameState.lives > 10 ? '#00f2ff' : gameState.lives > 5 ? '#ffb800' : '#ff4d4d';
            const pct = (gameState.lives / INITIAL_LIVES) * 100;
            return (
              <div className="flex items-center gap-2.5 px-3.5 rounded-xl bg-white/[0.04] border border-white/[0.06]">
                <Shield className="w-3.5 h-3.5 shrink-0" style={{ color: col, filter: `drop-shadow(0 0 4px ${col}80)` }} />
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-[7px] uppercase tracking-widest text-white/28 font-mono leading-none">Integrity</span>
                    <span className="text-[11px] font-black font-mono tabular-nums leading-none" style={{ color: col }}>{gameState.lives}</span>
                  </div>
                  <div className="mt-1.5 w-24 h-[4px] rounded-full bg-white/[0.08] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${pct}%`, backgroundColor: col, boxShadow: `0 0 8px ${col}99` }}
                    />
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Wave Progress */}
          <div className="flex items-center gap-2.5 px-3.5 rounded-xl bg-white/[0.04] border border-white/[0.06]">
            <Activity className="w-3.5 h-3.5 text-accent-amber/55 shrink-0" />
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-[7px] uppercase tracking-widest text-white/28 font-mono leading-none">Wave</span>
                <span className="text-[11px] font-black font-mono text-accent-amber tabular-nums leading-none">
                  {gameState.waveNumber.toString().padStart(2, '0')}
                  {/* Past the scripted waves the run goes on endlessly */}
                  <span className="text-white/20 text-[9px]">{gameState.waveNumber <= WAVES.length ? `/${WAVES.length}` : ' ENDLESS'}</span>
                </span>
                {bestWaves > 0 && (
                  <span
                    className={`text-[8px] font-mono uppercase tracking-wider leading-none tabular-nums ${newRecord ? 'text-emerald-400' : 'text-white/30'}`}
                    title="Most waves cleared in a single run"
                  >
                    Best {bestWaves.toString().padStart(2, '0')}
                  </span>
                )}
              </div>
              <div className="mt-1.5 w-24 h-[4px] rounded-full bg-white/[0.08] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${Math.min(1, gameState.waveNumber / WAVES.length) * 100}%`,
                    background: 'linear-gradient(to right, #ffb800, #ff9500)',
                    boxShadow: '0 0 8px rgba(255,184,0,0.7)',
                  }}
                />
              </div>
            </div>
          </div>

          {/* Threat Modifier — only when active */}
          {gameState.currentWaveModifier !== WaveModifier.NONE && (() => {
            const m = MODIFIER_STYLE[gameState.currentWaveModifier];
            const hex = MODIFIER_HEX[gameState.currentWaveModifier];
            return (
              <div
                className="flex items-center gap-2 px-3.5 rounded-xl border"
                style={{ borderColor: `${hex}45`, backgroundColor: `${hex}10`, boxShadow: `0 0 16px ${hex}20` }}
              >
                <Zap className="w-3.5 h-3.5 shrink-0 animate-pulse" style={{ color: hex }} />
                <div>
                  <div className="text-[7px] uppercase tracking-widest text-white/28 font-mono leading-none">Threat</div>
                  <div className="text-[11px] font-black font-mono leading-tight mt-0.5" style={{ color: hex, textShadow: `0 0 10px ${hex}` }}>{m.label}</div>
                </div>
              </div>
            );
          })()}
        </div>{/* end stat pills */}

        {/* push controls to far right */}
        <div className="flex-1" />

        {/* ── CONTROLS ── */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Pause / Resume */}
          <button
            onClick={onPauseToggle}
            title={gameState.isPaused ? 'Resume (P)' : 'Pause (P)'}
            className="w-9 h-9 rounded-xl flex items-center justify-center border border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.09] hover:border-white/[0.18] transition-all group"
          >
            {gameState.isPaused
              ? <Play  className="w-4 h-4 text-white/55 group-hover:text-white transition-colors" />
              : <Pause className="w-4 h-4 text-white/55 group-hover:text-white transition-colors" />
            }
          </button>

          {/* Game speed */}
          <button
            onClick={onCycleSpeed}
            title="Game speed (F)"
            className={`w-9 h-9 rounded-xl flex items-center justify-center border font-black font-mono text-[11px] transition-all ${
              gameState.gameSpeed > 1
                ? 'border-accent-amber/40 bg-accent-amber/10 text-accent-amber'
                : 'border-white/[0.08] bg-white/[0.04] text-white/55 hover:bg-white/[0.09] hover:border-white/[0.18] hover:text-white'
            }`}
          >
            {gameState.gameSpeed}×
          </button>

          {/* Sound */}
          <button
            onClick={onToggleMute}
            title={muted ? 'Unmute (M)' : 'Mute (M)'}
            className="w-9 h-9 rounded-xl flex items-center justify-center border border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.09] hover:border-white/[0.18] transition-all group"
          >
            {muted
              ? <VolumeX className="w-4 h-4 text-white/35 group-hover:text-white transition-colors" />
              : <Volume2 className="w-4 h-4 text-white/55 group-hover:text-white transition-colors" />
            }
          </button>

          {/* Controls reference */}
          <div className="relative">
            <button
              onClick={() => setShowHelp(v => !v)}
              title="Controls (?)"
              className={`w-9 h-9 rounded-xl flex items-center justify-center border transition-all group ${
                showHelp ? 'border-accent-cyan/50 bg-accent-cyan/10' : 'border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.09] hover:border-white/[0.18]'
              }`}
            >
              <HelpCircle className={`w-4 h-4 transition-colors ${showHelp ? 'text-accent-cyan' : 'text-white/55 group-hover:text-white'}`} />
            </button>
            {showHelp && (
              <>
                <div className="fixed inset-0 z-[90]" onClick={() => setShowHelp(false)} />
                <div className="absolute right-0 top-full mt-2 z-[100] w-72 rounded-xl border border-white/[0.1] bg-[#11151b]/95 backdrop-blur-xl shadow-[0_18px_50px_-12px_rgba(0,0,0,0.9)] overflow-hidden">
                  <div className="px-3.5 py-2.5 border-b border-white/[0.06] text-[10px] font-black uppercase tracking-[0.18em] text-white/75 font-mono">Controls</div>
                  <div className="px-3.5 py-2.5 space-y-1.5">
                    {CONTROLS.map(([k, v]) => (
                      <div key={k} className="flex items-center justify-between gap-3 text-[10px] font-mono">
                        <span className="text-white/55">{v}</span>
                        <kbd className="shrink-0 px-1.5 py-0.5 rounded border border-white/15 bg-white/[0.05] text-[9px] font-bold text-white/75">{k}</kbd>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Restart */}
          <button
            onClick={onRestart}
            title="Restart"
            className="w-9 h-9 rounded-xl flex items-center justify-center border border-white/[0.08] bg-white/[0.04] hover:bg-accent-red/12 hover:border-accent-red/35 transition-all group"
          >
            <RotateCcw className="w-4 h-4 text-white/45 group-hover:text-accent-red transition-colors" />
          </button>

          {/* Deploy CTA */}
          <button
            onClick={onStartWave}
            title="Start wave (Space)"
            disabled={gameState.isGameOver || !gameState.isWaveReady || !assetsReady}
            className="relative h-9 pl-4 pr-5 rounded-xl font-black text-[11px] uppercase tracking-[0.14em] font-mono flex items-center gap-2 overflow-hidden transition-all disabled:opacity-35 disabled:cursor-not-allowed"
            style={gameState.isWaveReady && !gameState.isGameOver ? {
              background: 'linear-gradient(135deg, #ffb800 0%, #ff9200 100%)',
              color: '#0d0f13',
              boxShadow: '0 0 22px rgba(255,184,0,0.5), inset 0 1px 0 rgba(255,255,255,0.28)',
            } : {
              background: 'rgba(255,184,0,0.07)',
              color: 'rgba(255,184,0,0.4)',
              border: '1px solid rgba(255,184,0,0.18)',
            }}
          >
            {/* shimmer sweep while ready */}
            {gameState.isWaveReady && !gameState.isGameOver && (
              <span
                className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent"
                style={{ animation: 'shimmer 2.4s ease-in-out infinite' }}
              />
            )}
            <Zap className="w-3.5 h-3.5 relative z-10 shrink-0" />
            <span className="relative z-10 whitespace-nowrap">
              {gameState.isWaveReady ? `Wave ${gameState.waveNumber + 1}` : 'Active'}
            </span>
          </button>
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
              onContextMenu={e => {
                if (!placingType && !gameState.relocatingTowerId) return;
                e.preventDefault(); // right-click cancels placing or relocating
                setPlacingType(null);
                onCancelRelocation();
              }}
            >
            {renderCanvas}

            {/* Tower Module Overlay */}
            {selectedTower && !gameState.relocatingTowerId && (
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

            {/* Grid Overlay simulation */}
            {screenGrid && (
              <div className="absolute inset-0 pointer-events-none grid grid-cols-[repeat(20,minmax(0,1fr))] grid-rows-[repeat(15,minmax(0,1fr))] opacity-10">
                 {[...Array(300)].map((_, i) => (
                   <div key={i} className="border-[0.5px] border-border-dim" />
                 ))}
              </div>
            )}

            {/* Core breach flash — red edges, stronger the more lives were lost */}
            <AnimatePresence>
              {coreHit && (
                <motion.div
                  key={coreHit.key}
                  className="absolute inset-0 pointer-events-none z-40"
                  initial={{ opacity: Math.min(0.9, 0.35 + coreHit.lost * 0.12) }}
                  animate={{ opacity: 0 }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                  onAnimationComplete={() => setCoreHit(c => (c && c.key === coreHit.key ? null : c))}
                  style={{ background: 'radial-gradient(ellipse at center, transparent 62%, rgba(239,68,68,0.45) 100%)', boxShadow: 'inset 0 0 0 2px rgba(239,68,68,0.6)' }}
                />
              )}
            </AnimatePresence>

            {/* Wave start banner */}
            <AnimatePresence>
              {waveBanner && (() => {
                const mod = waveBanner.modifier;
                const accent = mod === WaveModifier.NONE ? '#ffb800' : MODIFIER_HEX[mod];
                return (
                  <motion.div
                    key={waveBanner.key}
                    className="absolute left-0 right-0 bottom-[16%] flex justify-center pointer-events-none z-40"
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    transition={{ duration: 0.35, ease: 'easeOut' }}
                  >
                    <div
                      className="px-10 py-3 flex flex-col items-center bg-[#0d1117]/75 backdrop-blur-sm border-y"
                      style={{ borderColor: `${accent}66`, boxShadow: `0 0 40px ${accent}22` }}
                    >
                      <span className="text-[10px] font-mono uppercase tracking-[0.5em]" style={{ color: `${accent}cc` }}>
                        Incoming · {waveBanner.count} {waveBanner.count === 1 ? 'hostile' : 'hostiles'}
                      </span>
                      <span className="text-4xl font-black italic tracking-tighter text-white leading-tight">
                        WAVE {waveBanner.wave}
                      </span>
                      {mod !== WaveModifier.NONE && (
                        <span className="text-xs font-black font-mono uppercase tracking-[0.3em]" style={{ color: accent }}>
                          {MODIFIER_STYLE[mod].label} · {MODIFIER_STYLE[mod].desc}
                        </span>
                      )}
                      {waveBanner.boss && (
                        <span className="mt-1 text-[11px] font-black font-mono uppercase tracking-[0.3em] text-accent-red animate-pulse">
                          ⚠ Dreadnought inbound
                        </span>
                      )}
                    </div>
                  </motion.div>
                );
              })()}
            </AnimatePresence>

            {/* Wave cleared: a compact card along the top edge, so the field stays visible while building */}
            <AnimatePresence>
              {gameState.isWaveReady && !gameState.isGameOver && gameState.waveNumber > 0 && (() => {
                const mod = getWaveConfig(gameState.waveNumber + 1).modifier;
                return (
                  <motion.div
                    key="wave-cleared"
                    className="absolute inset-x-0 top-3 flex justify-center pointer-events-none z-[60]"
                    initial={{ opacity: 0, y: -14 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -14 }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                  >
                    <div className="pointer-events-auto flex items-center gap-5 pl-5 pr-2.5 py-2.5 bg-[#0d1117]/85 backdrop-blur-md border border-accent-amber/50 rounded-lg shadow-[0_0_40px_rgba(255,191,0,0.12)] whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="text-[9px] uppercase tracking-[0.45em] text-accent-amber font-black">Aegis Matrix Stable</span>
                        <span className="text-2xl font-black text-white italic tracking-tighter leading-none mt-1">
                          WAVE {gameState.waveNumber} CLEARED
                        </span>
                      </div>
                      {newRecord && gameState.waveNumber === bestWaves && (
                        <span className="px-2.5 py-1 rounded-full border border-emerald-400/40 bg-emerald-400/10 text-emerald-300 text-[9px] font-black font-mono uppercase tracking-[0.25em]">
                          ★ New record
                        </span>
                      )}
                      {mod !== WaveModifier.NONE && (
                        <div className={`px-3 py-1 border rounded-md flex flex-col items-center leading-tight ${
                          mod === WaveModifier.RUSH  ? 'border-accent-amber/40 bg-accent-amber/5' :
                          mod === WaveModifier.SWARM ? 'border-accent-red/40 bg-accent-red/5' :
                          'border-purple-400/40 bg-purple-400/5'
                        }`}>
                          <span className={`text-[10px] font-black uppercase tracking-widest ${MODIFIER_STYLE[mod].color}`}>⚠ {MODIFIER_STYLE[mod].label} incoming</span>
                          <span className={`text-[9px] font-mono ${MODIFIER_STYLE[mod].color} opacity-70`}>{MODIFIER_STYLE[mod].desc}</span>
                        </div>
                      )}
                      <button
                        onClick={onStartWave}
                        disabled={!assetsReady}
                        className="px-5 py-2.5 bg-accent-amber text-dark-bg font-black uppercase tracking-widest text-sm hover:brightness-110 active:scale-95 transition-all flex items-center gap-2 rounded-md disabled:opacity-40 disabled:cursor-wait disabled:active:scale-100"
                      >
                        <Zap className="w-4 h-4 fill-current" />
                        {assetsReady ? `Initiate Wave ${gameState.waveNumber + 1}` : 'Loading assets…'}
                        <kbd className="ml-1 px-1.5 py-0.5 rounded border border-dark-bg/30 text-[9px] font-mono font-bold opacity-70">SPACE</kbd>
                      </button>
                    </div>
                  </motion.div>
                );
              })()}
            </AnimatePresence>

            {/* Placement / relocation hint: a corner strip, so the whole field stays clickable */}
            {(placingType || relocatingTower) && (() => {
              const relocating = !!relocatingTower;
              const accent = relocating ? '#ffb800' : '#00f2ff';
              return (
                <div
                  className="absolute bottom-3 left-3 z-50 flex items-center gap-3 pl-3 pr-1.5 py-1.5 rounded-lg bg-[#0d1117]/85 backdrop-blur-md border font-mono text-[10px] uppercase tracking-wider pointer-events-none"
                  style={{ borderColor: `${accent}66`, color: accent }}
                >
                  {relocating ? <MoveVertical className="w-3.5 h-3.5 animate-pulse" /> : <Crosshair className="w-3.5 h-3.5 animate-pulse" />}
                  <span>
                    {relocating
                      ? <>Relocating {TOWER_STATS[relocatingTower!.type].name} · ${RELOCATION_FEE} · click a free spot</>
                      : <>Placing {TOWER_STATS[placingType!].name} · click a free spot</>}
                  </span>
                  <button
                    onClick={() => { setPlacingType(null); onCancelRelocation(); }}
                    className="pointer-events-auto px-2 py-1 rounded border border-white/15 text-white/60 hover:text-white hover:border-white/40 transition-colors"
                  >
                    Cancel · Esc
                  </button>
                </div>
              );
            })()}
            </div>{/* end scale-inner */}
          </div>{/* end layout-outer */}
        </section>

        <CommandDeck
          gameState={gameState}
          towers={towers}
          placingType={placingType}
          setPlacingType={setPlacingType}
          waveRemaining={waveRemaining}
        />
      </main>

      {/* OVERLAYS */}
      <AnimatePresence>
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
               Waves survived: {Math.max(0, gameState.waveNumber - 1)} · Best: {bestWaves}
            </p>
            {newRecord && (
              <span className="-mt-8 mb-10 px-4 py-1.5 rounded-full border border-emerald-400/40 bg-emerald-400/10 text-emerald-300 text-xs font-black font-mono uppercase tracking-[0.3em]">
                ★ New record
              </span>
            )}
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
