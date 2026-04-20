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
  MoveVertical
} from 'lucide-react';
import { TowerModule } from './TowerModule';
import { GameState, TowerType, TowerInstance, WaveModifier, TargetingMode } from '../types';
import { TOWER_STATS, INITIAL_LIVES, WAVES } from '../constants';

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
  [WaveModifier.RUSH]:  { label: 'RUSH',  color: 'text-accent-amber', desc: '2× SPEED' },
  [WaveModifier.SWARM]: { label: 'SWARM', color: 'text-accent-red',   desc: '2× COUNT / ½ HP' },
  [WaveModifier.ELITE]: { label: 'ELITE', color: 'text-purple-400',   desc: '½ COUNT / 2× HP / 1.5× ₢' },
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

  const buildDate = new Date(__BUILD_TIME__);
  const buildLabel = buildDate.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + buildDate.toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-dark-bg text-text-primary">
      {/* TOP BAR */}
      <header className="h-[60px] bg-panel-bg border-b-2 border-border-dim flex items-center px-6 justify-between shrink-0">
        <div className="flex gap-8">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wider text-text-secondary font-mono flex items-center gap-1">
              <CreditCard className="w-3 h-3" /> Credits
            </span>
            <span className="text-xl font-bold font-mono text-accent-cyan">${gameState.money.toLocaleString()}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wider text-text-secondary font-mono flex items-center gap-1">
              <Shield className="w-3 h-3" /> Core Integrity
            </span>
            <span className="text-xl font-bold font-mono text-accent-red">{gameState.lives}/{INITIAL_LIVES}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wider text-text-secondary font-mono flex items-center gap-1">
              <Activity className="w-3 h-3" /> Wave Progress
            </span>
            <span className="text-xl font-bold font-mono text-accent-amber">{gameState.waveNumber.toString().padStart(2, '0')}/{WAVES.length}</span>
          </div>
          {gameState.currentWaveModifier !== WaveModifier.NONE && (() => {
            const m = MODIFIER_STYLE[gameState.currentWaveModifier];
            return (
              <div className="flex flex-col justify-center">
                <span className="text-[8px] uppercase tracking-wider text-text-secondary font-mono">Threat Mode</span>
                <span className={`text-sm font-black font-mono ${m.color} animate-pulse`}>{m.label}</span>
                <span className={`text-[8px] font-mono ${m.color} opacity-70`}>{m.desc}</span>
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
            disabled={gameState.isGameOver}
            className="bg-accent-amber text-dark-bg px-5 py-2 text-xs uppercase font-bold font-mono hover:brightness-110 disabled:grayscale transition-all"
          >
            Initiate Next Wave
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
        <section className="flex-1 relative bg-[radial-gradient(circle_at_50%_50%,#161b22_0%,#0d1117_100%)] p-5 overflow-auto flex items-center justify-center">
          <div className="relative border border-border-dim">
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
          </div>
        </section>

        {/* SIDEBAR */}
        <aside className="w-[320px] bg-panel-bg border-l border-border-dim flex flex-col p-6 gap-6 overflow-y-auto">
          {/* ARSENAL */}
          <div className="flex flex-col">
            <h2 className="text-[11px] font-black uppercase tracking-widest text-text-secondary border-b border-border-dim pb-2 mb-4">
              Arsenal Selection
            </h2>
            <div className="space-y-3">
              {Object.values(TowerType).map(type => {
                const stats = TOWER_STATS[type];
                const isAffordable = gameState.money >= stats.cost;
                const isSelected = placingType === type;

                return (
                  <button
                    key={type}
                    onClick={() => setPlacingType(isSelected ? null : type)}
                    className={`w-full border p-3 flex gap-4 text-left transition-all ${
                      isSelected ? 'border-accent-cyan bg-accent-cyan/5 ring-1 ring-accent-cyan/20' : 
                      'border-border-dim bg-white/[0.02] hover:bg-white/[0.05]'
                    } ${!isAffordable && !isSelected ? 'opacity-40 grayscale cursor-not-allowed' : ''}`}
                  >
                    <div className="w-12 h-12 bg-border-dim flex items-center justify-center text-lg">
                      {type === TowerType.BASIC && '🔫'}
                      {type === TowerType.SNIPER && '🎯'}
                      {type === TowerType.SPLASH && '💣'}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-bold leading-tight">{stats.name}</p>
                      <p className="text-[10px] text-text-secondary font-mono mt-0.5">
                        DMG: {stats.damage} | RNG: {stats.range}
                      </p>
                      <span className="text-xs font-bold text-accent-cyan mt-1 block">
                        ${stats.cost}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* UNIT STATUS - MOVED TO IN-GAME MODULE */}
          <div className="flex-1 flex flex-col border border-border-dim p-5 bg-black/20 overflow-hidden relative group">
             <div className="absolute inset-0 bg-gradient-to-br from-accent-cyan/5 to-transparent pointer-events-none" />
             <div className="relative z-10 flex flex-col h-full">
                <h2 className="text-[11px] font-black uppercase tracking-widest text-text-secondary border-b border-border-dim pb-2 mb-4 flex items-center justify-between">
                  <span className="flex items-center gap-2"><Layers className="w-3 h-3" /> System Diagnostics</span>
                  <Activity className="w-3 h-3 animate-pulse text-accent-cyan" />
                </h2>
                <div className="flex-1 flex flex-col items-center justify-center opacity-40 text-center space-y-4">
                   <div className="w-16 h-16 border border-border-dim rounded-full flex items-center justify-center animate-[spin_10s_linear_infinite]">
                      <Cpu className="w-8 h-8" />
                   </div>
                   <div>
                      <p className="text-[10px] uppercase font-mono tracking-widest text-accent-cyan">Neural Link Ready</p>
                      <p className="text-[9px] text-text-secondary mt-1">Select a defensive unit on the map for manual override and biological feedback.</p>
                   </div>
                </div>
             </div>
          </div>

          {/* LOG AREA */}
          <div className="h-[120px] bg-black border border-border-dim p-3 font-mono text-[10px] text-text-secondary overflow-hidden flex flex-col gap-1">
            <p className="flex items-center gap-2 text-accent-cyan border-b border-border-dim pb-1 mb-1 opacity-80">
              <Terminal className="w-3 h-3" /> System Feed
            </p>
            <p className="animate-pulse">{'>'} Defense matrix online.</p>
            <p className="">{'>'} Integrity stable: All clear.</p>
            {gameState.waveNumber > 0 && <p className="text-accent-amber">{'>'} Wave {gameState.waveNumber} ingress detected.</p>}
            {selectedTower && <p className="text-accent-cyan">{'>'} Focus unit: {TOWER_STATS[selectedTower.type].name}.</p>}
            {gameState.lives < 10 && <p className="text-accent-red animate-bounce">{'>'} WARNING: CORE INTEGRITY CRITICAL</p>}
          </div>
        </aside>
      </main>

      {/* OVERLAYS */}
      <AnimatePresence>
        {gameState.isWaveReady && !gameState.isGameOver && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.05 }}
            className="absolute inset-x-0 top-1/2 -translate-y-1/2 z-[500] flex flex-col items-center justify-center p-12 bg-[#0d1117]/80 backdrop-blur-md border-y-2 border-accent-amber shadow-[0_0_100px_rgba(255,191,0,0.15)]"
          >
            <div className="flex flex-col items-center max-w-xl text-center">
              <span className="text-[10px] uppercase tracking-[0.5em] text-accent-amber mb-4 font-black">
                Aegis Matrix Stable
              </span>
              <h2 className="text-6xl font-black text-white italic tracking-tighter mb-2">
                WAVE COMPLETED
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
            
            {/* Background scanner lines for effect */}
            <div className="absolute top-0 left-0 w-full h-[1px] bg-accent-amber opacity-30 animate-[scan-y_2s_linear_infinite]" />
            <div className="absolute bottom-0 left-0 w-full h-[1px] bg-accent-amber opacity-30 animate-[scan-y_2s_reverse_linear_infinite]" />
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
