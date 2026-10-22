import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Zap,
  Target,
  Activity,
  Cpu,
  Coins,
  MoveVertical,
  X
} from 'lucide-react';
import { TowerInstance, GameState, TowerType, TargetingMode } from '../types';
import { TOWER_STATS, RELOCATION_FEE, CANVAS_WIDTH, CANVAS_HEIGHT, getSellValue, getUpgradeCost, getMaxLevel, isBaseTower, SPECIALIZATIONS } from '../constants';
import { DMG_STYLE } from './uiStyles';
import { toIso } from '../lib/iso';
import { towerDamage } from '../game/sim';

interface TowerModuleProps {
  tower: TowerInstance;
  gameState: GameState;
  onUpgrade: (id: string) => void;
  onSpecialize: (id: string, type: TowerType) => void;
  onSell: (id: string) => void;
  onStartRelocation: (id: string) => void;
  onSetTargetingMode: (id: string, mode: TargetingMode) => void;
  onClose: () => void;
}

const TARGETING_LABELS: Record<TargetingMode, string> = {
  [TargetingMode.FIRST]:    'FIRST',
  [TargetingMode.LAST]:     'LAST',
  [TargetingMode.STRONGEST]:'STRONG',
  [TargetingMode.WEAKEST]:  'WEAK',
  [TargetingMode.CLOSEST]:  'NEAR',
};

export const TowerModule: React.FC<TowerModuleProps> = ({
  tower,
  gameState,
  onUpgrade,
  onSpecialize,
  onSell,
  onStartRelocation,
  onSetTargetingMode,
  onClose
}) => {
  const stats = TOWER_STATS[tower.type];
  const towerH = 40 + tower.level * 2;
  const screenPos = toIso(tower.x, tower.y, towerH + 15);
  const upgradeCost = getUpgradeCost(tower.type, tower.level);

  // Placement: above the tower when it fits, else below, and always wholly inside the frame.
  // The panel's height changes with its content (specialization choices, etc.), so it's measured.
  const MODULE_WIDTH = 280;
  const MARGIN = 8;
  const CONNECTOR = 48; // gap between the tower and the panel, bridged by the connector line
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [panelH, setPanelH] = React.useState(440);
  React.useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const measure = () => setPanelH(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Above or below the tower when the panel fits there, otherwise beside it, never over it
  const clampX = (x: number) => Math.max(MARGIN, Math.min(CANVAS_WIDTH - MODULE_WIDTH - MARGIN, x));
  const clampY = (y: number) => Math.max(MARGIN, Math.min(CANVAS_HEIGHT - MARGIN - panelH, y));
  const SIDE_GAP = 36;
  const placement: 'above' | 'below' | 'right' | 'left' =
    screenPos.y - CONNECTOR - panelH >= MARGIN ? 'above'
    : screenPos.y + CONNECTOR + panelH <= CANVAS_HEIGHT - MARGIN ? 'below'
    : screenPos.x + SIDE_GAP + MODULE_WIDTH <= CANVAS_WIDTH - MARGIN ? 'right'
    : 'left';
  const showBelow = placement === 'below';
  const left = placement === 'right' ? screenPos.x + SIDE_GAP
    : placement === 'left' ? Math.max(MARGIN, screenPos.x - SIDE_GAP - MODULE_WIDTH)
    : clampX(screenPos.x - MODULE_WIDTH / 2);
  const top = placement === 'above' ? screenPos.y - CONNECTOR - panelH
    : placement === 'below' ? screenPos.y + CONNECTOR
    : clampY(screenPos.y - panelH / 2);
  // Vertical connector from the panel's near edge to the tower (above/below placements only)
  const connectorLen = placement === 'above' ? screenPos.y - (top + panelH) : placement === 'below' ? top - screenPos.y : 0;
  const anchorX = Math.max(12, Math.min(MODULE_WIDTH - 12, screenPos.x - left));
  
  // Specialization Logic
  const isBaseType = isBaseTower(tower.type);
  const isSpecialized = !isBaseType;
  const showSpecialization = tower.level >= 3 && isBaseType;
  

  const sellValue = getSellValue(tower);
  const canAffordUpgrade = gameState.money >= upgradeCost;
  const canAffordRelocation = gameState.money >= RELOCATION_FEE;
  const levelCap = tower.level >= getMaxLevel(tower.type); // base towers specialize from here, specializations are done
  const maxed = isSpecialized && levelCap;
  
  // Next-level preview using the same coefficients as the game engine
  const nextDamage = stats.damage * (1 + tower.level * 0.45);
  const nextRange = stats.range * (1 + tower.level * 0.1);

  return (
    <div
      className="absolute pointer-events-none cursor-crosshair z-[70]"
      style={{ left, top, width: MODULE_WIDTH }}
    >
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, scale: 0.8, y: showBelow ? -20 : 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.8, y: showBelow ? -20 : 20 }}
          className="relative pointer-events-none"
        >
          {/* Connector line to the tower — pointer-events-none so clicks pass through */}
          {connectorLen > 4 && (
            <>
              <div
                className="absolute pointer-events-none w-[2px] bg-accent-cyan/40 -translate-x-1/2"
                style={{ left: anchorX, height: connectorLen, ...(showBelow ? { top: -connectorLen } : { top: panelH }) }}
              />
              <div
                className="absolute pointer-events-none w-2 h-2 bg-accent-cyan rounded-full -translate-x-1/2 shadow-[0_0_10px_#00f2ff]"
                style={{ left: anchorX, top: showBelow ? -connectorLen - 4 : panelH + connectorLen - 4 }}
              />
            </>
          )}

          {/* Main Container — pointer-events-auto only on the visible panel */}
          <div ref={panelRef} className="w-[280px] pointer-events-auto bg-panel-bg/90 backdrop-blur-xl border border-white/20 rounded-xl overflow-hidden shadow-2xl">
            {/* Header */}
            <header 
              className="p-3 border-b border-white/10 flex items-center justify-between"
              style={{ backgroundColor: `${stats.color}22` }}
            >
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-accent-cyan" />
                <span className="font-display font-semibold text-[13px] uppercase tracking-[0.08em] text-white/90">
                  {stats.name} <span className="text-accent-amber">Lv {tower.level}</span>
                </span>
              </div>
              <button
                onClick={onClose}
                className="hover:bg-white/10 p-1 rounded transition-colors"
              >
                <X className="w-3.5 h-3.5 text-white/55" />
              </button>
            </header>

            {/* Content */}
            <div className="p-4 space-y-4">
              {/* Weapon Profile */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1 flex-wrap">
                  <span className={`text-[10px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border ${DMG_STYLE[stats.damageType].cls}`}>
                    {DMG_STYLE[stats.damageType].label}
                  </span>
                  {stats.splashRadius && (
                    <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border bg-white/5 border-white/10 text-white/60">
                      SPLASH {stats.splashRadius}px
                    </span>
                  )}
                  {stats.isPiercing && (
                    <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border bg-white/5 border-white/10 text-white/60">
                      PIERCE
                    </span>
                  )}
                  {stats.armorPiercing && (
                    <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border bg-white/5 border-white/10 text-white/60">
                      ARMOUR-PIERCING
                    </span>
                  )}
                  {stats.slowEffect && (
                    <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border bg-cyan-500/10 border-cyan-500/20 text-cyan-400/70">
                      SLOW {stats.slowEffect * 100}%
                    </span>
                  )}
                  {stats.burnDamage && (
                    <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border bg-orange-500/10 border-orange-500/20 text-orange-400/70">
                      BURN {Math.round(stats.burnDamage * towerDamage(tower) / stats.damage)}/s·{stats.burnDuration}s
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-white/60 leading-relaxed">{stats.description}</p>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                <div className="bg-black/40 p-2 rounded border border-white/5 space-y-1">
                  <div className="flex justify-between text-white/55 uppercase">
                    <span>Damage</span>
                    <Activity className="w-2.5 h-2.5" />
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-sm font-bold text-accent-red">{(stats.damage * (1 + (tower.level - 1) * 0.45)).toFixed(1)}</span>
                    {!levelCap && <span className="text-white/45">→ {nextDamage.toFixed(1)}</span>}
                  </div>
                </div>
                <div className="bg-black/40 p-2 rounded border border-white/5 space-y-1">
                  <div className="flex justify-between text-white/55 uppercase">
                    <span>Range</span>
                    <Target className="w-2.5 h-2.5" />
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-sm font-bold text-accent-cyan">{(stats.range * (1 + (tower.level - 1) * 0.1)).toFixed(0)}</span>
                    {!levelCap && <span className="text-white/45">→ {nextRange.toFixed(0)}</span>}
                  </div>
                </div>
              </div>

              {/* Targeting Mode */}
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-[0.12em] text-white/55 font-display font-semibold">Targeting</div>
                <div className="flex gap-1">
                  {(Object.values(TargetingMode) as TargetingMode[]).map(mode => (
                    <button
                      key={mode}
                      onClick={() => onSetTargetingMode(tower.id, mode)}
                      title="Cycle targeting (T)"
                      className={`flex-1 py-1 rounded text-[10px] font-mono uppercase transition-all ${
                        tower.targetingMode === mode
                          ? 'bg-accent-cyan text-dark-bg font-black'
                          : 'bg-white/5 border border-white/10 text-white/55 hover:text-white/85 hover:bg-white/10'
                      }`}
                    >
                      {TARGETING_LABELS[mode]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Progress Level */}
              {(() => {
                const maxLevel = getMaxLevel(tower.type);
                const atCap = tower.level >= maxLevel;
                const capLabel = isBaseType && atCap ? 'Ready to specialize' : isSpecialized && atCap ? 'Max level' : `${tower.level}/${maxLevel}`;
                return (
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] uppercase tracking-[0.12em] text-white/55 font-display font-semibold">
                      <span>Level</span>
                      <span className={atCap ? (isBaseType ? 'text-accent-amber' : 'text-accent-cyan') : ''}>{capLabel}</span>
                    </div>
                    <div className="flex gap-1 h-1">
                      {[...Array(maxLevel)].map((_, i) => (
                        <div
                          key={i}
                          className={`flex-1 rounded-full transition-all duration-500 ${
                            i < tower.level
                              ? atCap && isBaseType
                                ? 'bg-accent-amber shadow-[0_0_5px_rgba(255,184,0,0.6)]'
                                : 'bg-accent-cyan shadow-[0_0_5px_#00f2ff]'
                              : 'bg-white/10'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Actions: the level-up (upgrade, or the two specializations at the base cap), then move and sell */}
              <div className="flex flex-col gap-2 pt-1">
                {showSpecialization ? (
                  <div className="grid grid-cols-2 gap-2">
                    {SPECIALIZATIONS[tower.type]?.map(specType => {
                      const specStats = TOWER_STATS[specType];
                      const canAffordSpec = gameState.money >= specStats.cost;
                      return (
                        <button
                          key={specType}
                          onClick={() => onSpecialize(tower.id, specType)}
                          disabled={!canAffordSpec}
                          className={`py-2.5 px-2 flex flex-col items-center justify-center rounded-lg transition-all text-center gap-1 ${
                            canAffordSpec
                              ? 'bg-accent-amber hover:brightness-110 active:scale-95 text-dark-bg'
                              : 'bg-white/5 text-white/40 cursor-not-allowed border border-white/10'
                          }`}
                        >
                          <span className="font-display font-semibold text-[12px] uppercase tracking-[0.06em] leading-none">{specStats.name}</span>
                          <span className="text-[11px] font-mono opacity-80">${specStats.cost}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <button
                    onClick={() => onUpgrade(tower.id)}
                    title="Upgrade (U)"
                    disabled={!canAffordUpgrade || maxed}
                    className={`h-9 px-3 flex items-center justify-between rounded-lg transition-all font-display font-semibold uppercase tracking-[0.08em] text-[12px] ${
                      canAffordUpgrade && !maxed
                        ? 'bg-accent-cyan hover:brightness-110 active:scale-95 text-dark-bg'
                        : 'bg-white/5 text-white/40 cursor-not-allowed border border-white/10'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <Zap className={`w-3.5 h-3.5 ${canAffordUpgrade && !maxed ? 'fill-current' : ''}`} />
                      {maxed ? 'Max level' : 'Upgrade'}
                    </span>
                    {!maxed && <span className="font-mono text-[12px]">${upgradeCost}</span>}
                  </button>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => onStartRelocation(tower.id)}
                    disabled={!canAffordRelocation}
                    title={`Move ($${RELOCATION_FEE}) (R)`}
                    className={`h-8 px-2 flex items-center justify-center gap-1.5 rounded-lg border transition-all active:scale-95 font-display font-semibold uppercase tracking-[0.08em] text-[11px] ${
                      canAffordRelocation
                        ? 'bg-white/5 border-white/10 text-white/70 hover:bg-accent-amber/15 hover:border-accent-amber/40 hover:text-accent-amber'
                        : 'bg-white/5 border-white/5 text-white/30 cursor-not-allowed'
                    }`}
                  >
                    <MoveVertical className="w-3.5 h-3.5" />Move · ${RELOCATION_FEE}
                  </button>
                  <button
                    onClick={() => onSell(tower.id)}
                    title={`Sell for $${sellValue} (S twice)`}
                    className="h-8 px-2 flex items-center justify-center gap-1.5 rounded-lg bg-white/5 border border-white/10 text-white/70 hover:bg-accent-red/15 hover:border-accent-red/40 hover:text-accent-red transition-all active:scale-95 font-display font-semibold uppercase tracking-[0.08em] text-[11px]"
                  >
                    <Coins className="w-3.5 h-3.5" />Sell · ${sellValue}
                  </button>
                </div>
              </div>
            </div>

            {/* Footer Scanning Detail */}
            <div className="h-1 bg-gradient-to-r from-transparent via-accent-cyan to-transparent opacity-20 animate-[scan_2s_linear_infinite]" />
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
};
