import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Play,
  Pause,
  RotateCcw,
  Zap,
  CreditCard,
  Activity,
  MoveVertical,
  Crosshair,
  Volume2,
  VolumeX,
  HelpCircle,
  Heart,
  Keyboard,
} from 'lucide-react';
import { TowerModule } from './TowerModule';
import { CommandDeck } from './CommandDeck';
import { RunSummary } from './RunSummary';
import type { RunStats } from '../game/stats';
import { FRAME_VIEW, Insets, View, fitView, frameStyle, visibleFrame } from '../lib/view';
import { MODIFIER_HEX, MODIFIER_STYLE } from './uiStyles';
import { Button } from './ui/Button';
import { Kbd } from './ui/Kbd';
import { Modal } from './ui/Modal';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { GameState, TowerType, TowerInstance, WaveModifier, TargetingMode } from '../types';
import { TOWER_STATS, INITIAL_LIVES, WAVES, RELOCATION_FEE, getWaveConfig } from '../constants';

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
  // The battlefield, framed by the view the layout works out (it fills the window behind the HUD)
  renderCanvas: (view: View) => React.ReactNode;
  bestWaves: number;
  newRecord: boolean;
  // Flat screen-space grid over the arena; it suits the 2D renderer but not the 3D scene's perspective
  screenGrid: boolean;
  // False while the 3D models are still loading: starting a wave waits for them
  assetsReady: boolean;
  // Enemies of the running wave still to beat, by kind; null between waves
  waveRemaining: Record<string, number> | null;
  // The run's statistics, for the summary when it ends
  stats: RunStats;
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

const ControlsList: React.FC = () => (
  <div className="space-y-1.5">
    {CONTROLS.map(([k, v]) => (
      <div key={k} className="flex items-center justify-between gap-3 text-[12px]">
        <span className="text-white/65">{v}</span>
        <Kbd className="shrink-0">{k}</Kbd>
      </div>
    ))}
  </div>
);

// A wave modifier as a two-line chip: what it is, and what it does
const ModifierChip: React.FC<{ modifier: WaveModifier; next?: boolean }> = ({ modifier, next }) => {
  const hex = MODIFIER_HEX[modifier];
  return (
    <div
      className="flex items-center gap-2 h-10 px-3 rounded-lg border whitespace-nowrap"
      style={{ borderColor: `${hex}55`, backgroundColor: `${hex}12` }}
    >
      <Zap className="w-3.5 h-3.5 shrink-0" style={{ color: hex }} />
      <div className="leading-tight">
        <div className="font-display font-semibold text-[12px] uppercase tracking-[0.1em]" style={{ color: hex }}>
          {MODIFIER_STYLE[modifier].label}{next ? ' next' : ''}
        </div>
        <div className="text-[10px] font-mono" style={{ color: `${hex}cc` }}>{MODIFIER_STYLE[modifier].desc}</div>
      </div>
    </div>
  );
};

// The HUD's footprint over the battlefield: the top bar and the sidebar. The camera frames the
// platform in what's left.
const HEADER_H = 56;
const SIDEBAR_W = 336;
const HUD_INSETS: Insets = { top: HEADER_H, right: SIDEBAR_W, bottom: 0, left: 0 };

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
  stats,
}) => {
  const selectedTower = towers.find(t => t.id === gameState.selectedTowerId);

  // Controls reference: the ? button or key opens it, Esc or a click anywhere closes it
  const [showHelp, setShowHelp] = React.useState(false);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '?') setShowHelp(v => !v);
      else if (e.key === 'Escape' && showHelp) {
        e.stopImmediatePropagation(); // closing the help is all this Esc does
        setShowHelp(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [showHelp]);
  const relocatingTower = towers.find(t => t.id === gameState.relocatingTowerId);

  // Restarting throws the run away, so it always asks first
  const [confirmRestart, setConfirmRestart] = React.useState(false);
  const restart = () => { setConfirmRestart(false); onRestart(); };
  // The pause menu is up whenever a wave is paused; closing it resumes
  const pauseMenu = gameState.isPaused && !gameState.isWaveReady && !gameState.isGameOver;
  const [pauseControls, setPauseControls] = React.useState(false);
  React.useEffect(() => { if (!pauseMenu) setPauseControls(false); }, [pauseMenu]);

  // The battlefield fills the window; frame the platform in the part the HUD leaves free
  const layerRef = React.useRef<HTMLDivElement>(null);
  const [view, setView] = React.useState<View>(FRAME_VIEW);
  React.useLayoutEffect(() => {
    const el = layerRef.current;
    if (!el) return;
    const recompute = () => setView(fitView(el.clientWidth, el.clientHeight, HUD_INSETS));
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
    <div className="relative h-screen overflow-hidden bg-[#05080e] text-text-primary">
      {/* BATTLEFIELD — the whole window, behind the HUD */}
      <div
        ref={layerRef}
        className="absolute inset-0"
        onContextMenu={e => {
          if (!placingType && !gameState.relocatingTowerId) return;
          e.preventDefault(); // right-click cancels placing or relocating
          setPlacingType(null);
          onCancelRelocation();
        }}
      >
        {renderCanvas(view)}

        {/* Things drawn in frame coordinates ride on the same transform as the battlefield */}
        <div className="pointer-events-none" style={frameStyle(view)}>
          {screenGrid && (
            <div className="absolute inset-0 grid grid-cols-[repeat(20,minmax(0,1fr))] grid-rows-[repeat(15,minmax(0,1fr))] opacity-10">
              {[...Array(300)].map((_, i) => (
                <div key={i} className="border-[0.5px] border-border-dim" />
              ))}
            </div>
          )}
          {selectedTower && !gameState.relocatingTowerId && (
            <TowerModule
              tower={selectedTower}
              gameState={gameState}
              bounds={visibleFrame(view, HUD_INSETS)}
              onUpgrade={onUpgradeTower}
              onSpecialize={onSpecializeTower}
              onSell={onSellTower}
              onStartRelocation={onStartRelocation}
              onSetTargetingMode={onSetTargetingMode}
              onClose={() => onSelectTower(null)}
            />
          )}
        </div>

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

        {/* Screen-space callouts, kept inside the part of the field the HUD leaves free */}
        <div className="absolute pointer-events-none" style={{ top: HUD_INSETS.top, right: HUD_INSETS.right, bottom: HUD_INSETS.bottom, left: HUD_INSETS.left }}>
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
                    Incoming · {waveBanner.count} {waveBanner.count === 1 ? 'enemy' : 'enemies'}
                  </span>
                  <span className="font-display font-bold text-4xl tracking-[0.06em] text-white leading-tight">
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
                  ? <>Moving {TOWER_STATS[relocatingTower!.type].name} · ${RELOCATION_FEE} · click a free spot</>
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
        </div>
      </div>

      {/* TOP BAR */}
      <header
        className="absolute top-0 inset-x-0 h-14 z-[80] flex items-center px-5 gap-3 border-b border-white/[0.06]"
        style={{ background: 'linear-gradient(to bottom, rgba(16,19,25,0.86), rgba(12,15,20,0.78))', backdropFilter: 'blur(18px)' }}
      >
        {/* hairline cyan glow along the bottom edge */}
        <div className="pointer-events-none absolute bottom-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-accent-cyan/20 to-transparent" />

        {/* ── STAT PILLS (left) ── */}
        <div className="flex items-stretch gap-2 shrink-0">

          {/* Credits */}
          <div className="flex items-center gap-2.5 px-3.5 rounded-xl bg-white/[0.04] border border-white/[0.06]">
            <CreditCard className="w-3.5 h-3.5 text-accent-cyan/55 shrink-0" />
            <div>
              <div className="text-[10px] uppercase tracking-[0.14em] text-white/50 font-display font-semibold leading-none">Credits</div>
              <div
                className="text-[17px] font-black font-mono text-accent-cyan tabular-nums leading-tight mt-0.5"
                style={{ textShadow: '0 0 16px rgba(0,242,255,0.55)' }}
              >
                ${gameState.money.toLocaleString()}
              </div>
            </div>
          </div>

          {/* Lives */}
          {(() => {
            const col = gameState.lives > 10 ? '#00f2ff' : gameState.lives > 5 ? '#ffb800' : '#ff4d4d';
            const pct = (gameState.lives / INITIAL_LIVES) * 100;
            return (
              <div className="flex items-center gap-2.5 px-3.5 rounded-xl bg-white/[0.04] border border-white/[0.06]">
                <Heart className="w-3.5 h-3.5 shrink-0" style={{ color: col, filter: `drop-shadow(0 0 4px ${col}80)` }} />
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-[10px] uppercase tracking-[0.14em] text-white/50 font-display font-semibold leading-none">Lives</span>
                    <span className="text-[13px] font-bold font-mono tabular-nums leading-none" style={{ color: col }}>{gameState.lives}</span>
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
                <span className="text-[10px] uppercase tracking-[0.14em] text-white/50 font-display font-semibold leading-none">Wave</span>
                <span className="text-[13px] font-bold font-mono text-accent-amber tabular-nums leading-none">
                  {gameState.waveNumber.toString().padStart(2, '0')}
                  {/* Past the scripted waves the run goes on endlessly */}
                  <span className="text-white/45 text-[11px]">{gameState.waveNumber <= WAVES.length ? `/${WAVES.length}` : ' endless'}</span>
                </span>
                {bestWaves > 0 && (
                  <span
                    className={`text-[10px] font-mono uppercase tracking-wider leading-none tabular-nums ${newRecord ? 'text-emerald-400' : 'text-white/50'}`}
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

        </div>{/* end stat pills */}

        {/* ── WAVE CONTROL ── the one place to start a wave and follow it */}
        <div className="flex-1 min-w-0 flex justify-center">
          {!gameState.isGameOver && (gameState.isWaveReady ? (() => {
            const next = gameState.waveNumber + 1;
            const mod = getWaveConfig(next).modifier;
            return (
              <div className="flex items-center gap-3">
                {gameState.waveNumber > 0 && (
                  <div className="flex flex-col items-end leading-tight">
                    <span className="font-display font-semibold text-[13px] text-white/80 whitespace-nowrap">Wave {gameState.waveNumber} cleared</span>
                    {newRecord && gameState.waveNumber === bestWaves && (
                      <span className="text-[10px] font-display font-semibold uppercase tracking-[0.12em] text-emerald-300 whitespace-nowrap">★ New record</span>
                    )}
                  </div>
                )}
                {mod !== WaveModifier.NONE && <ModifierChip modifier={mod} next />}
                <Button variant="primary" onClick={onStartWave} disabled={!assetsReady} title="Start wave (Space)">
                  <Zap className="w-4 h-4 fill-current" />
                  {assetsReady ? `Start wave ${next}` : 'Loading assets…'}
                  {assetsReady && <Kbd tone="dark">Space</Kbd>}
                </Button>
              </div>
            );
          })() : (() => {
            const cfg = getWaveConfig(gameState.waveNumber);
            const left = waveRemaining ? Object.values(waveRemaining).reduce((a, b) => a + b, 0) : cfg.count;
            return (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-3 h-10 px-3.5 rounded-xl bg-white/[0.04] border border-white/[0.08]">
                  <span className="font-display font-semibold text-[14px] text-white whitespace-nowrap">Wave {gameState.waveNumber}</span>
                  <div className="w-32 h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
                    <div className="h-full rounded-full bg-accent-red/85 transition-all duration-300" style={{ width: `${(1 - left / cfg.count) * 100}%` }} />
                  </div>
                  <span className="font-mono text-[12px] tabular-nums text-white/70 whitespace-nowrap">{left} left</span>
                </div>
                {cfg.modifier !== WaveModifier.NONE && <ModifierChip modifier={cfg.modifier} />}
                {gameState.isPaused && (
                  <span className="h-7 px-2.5 flex items-center rounded-md border border-accent-amber/45 bg-accent-amber/15 text-accent-amber font-display font-semibold text-[12px] uppercase tracking-[0.12em]">
                    Paused
                  </span>
                )}
              </div>
            );
          })())}
        </div>

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
                  <div className="px-3.5 py-2.5 border-b border-white/[0.06] font-display font-semibold text-[12px] uppercase tracking-[0.16em] text-white/80">Controls</div>
                  <div className="px-3.5 py-3">
                    <ControlsList />
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Restart */}
          <button
            onClick={() => setConfirmRestart(true)}
            title="Restart run"
            className="w-9 h-9 rounded-xl flex items-center justify-center border border-white/[0.08] bg-white/[0.04] hover:bg-accent-red/12 hover:border-accent-red/35 transition-all group"
          >
            <RotateCcw className="w-4 h-4 text-white/45 group-hover:text-accent-red transition-colors" />
          </button>

        </div>
      </header>

      {/* SIDEBAR */}
      <div className="absolute right-0 bottom-0 z-[60] flex" style={{ top: HEADER_H, width: SIDEBAR_W }}>
        <CommandDeck
          gameState={gameState}
          towers={towers}
          placingType={placingType}
          setPlacingType={setPlacingType}
          waveRemaining={waveRemaining}
        />
      </div>

      {/* OVERLAYS */}
      <ConfirmDialog
        open={confirmRestart}
        title="Abandon this run?"
        body={`Wave ${gameState.waveNumber} progress and your towers will be lost.`}
        confirmLabel="Restart run"
        danger
        onConfirm={restart}
        onCancel={() => setConfirmRestart(false)}
      />

      <Modal open={pauseMenu} onClose={onPauseToggle} title="Paused" width={360} passKeys={['p']}>
        <p className="text-[13px] text-white/55">Wave {gameState.waveNumber} is on hold.</p>
        <div className="mt-5 flex flex-col gap-2.5">
          <Button variant="primary" size="lg" onClick={onPauseToggle} className="justify-between">
            <span className="flex items-center gap-2.5"><Play className="w-4 h-4 fill-current" />Resume</span>
            <span className="flex gap-1"><Kbd tone="dark">P</Kbd><Kbd tone="dark">Esc</Kbd></span>
          </Button>
          <Button variant="secondary" size="lg" onClick={() => setPauseControls(v => !v)} className="justify-start gap-2.5">
            <Keyboard className="w-4 h-4" />Controls
          </Button>
          {pauseControls && (
            <div className="rounded-xl border border-white/[0.08] bg-black/25 px-4 py-3">
              <ControlsList />
            </div>
          )}
          <Button variant="secondary" size="lg" onClick={() => setConfirmRestart(true)} className="justify-start gap-2.5 hover:!text-accent-red hover:!border-accent-red/40">
            <RotateCcw className="w-4 h-4" />Restart run
          </Button>
        </div>
      </Modal>

      <AnimatePresence>
        {gameState.isGameOver && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-[1000] flex items-center justify-center bg-[#05070b]/80 backdrop-blur-md"
          >
            <RunSummary
              stats={stats}
              wavesHeld={Math.max(0, gameState.waveNumber - 1)}
              bestWaves={bestWaves}
              newRecord={newRecord}
              onRestart={onRestart}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
