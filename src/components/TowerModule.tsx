import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ArrowUp, 
  Trash2, 
  Zap, 
  Shield, 
  Target, 
  Activity,
  Cpu,
  Unplug,
  MoveVertical
} from 'lucide-react';
import { TowerInstance, GameState, TowerType } from '../types';
import { TOWER_STATS, RELOCATION_FEE } from '../constants';
import { toIso } from '../lib/iso';

interface TowerModuleProps {
  tower: TowerInstance;
  gameState: GameState;
  onUpgrade: (id: string) => void;
  onSpecialize: (id: string, type: TowerType) => void;
  onSell: (id: string) => void;
  onStartRelocation: (id: string) => void;
  onClose: () => void;
}

export const TowerModule: React.FC<TowerModuleProps> = ({
  tower,
  gameState,
  onUpgrade,
  onSpecialize,
  onSell,
  onStartRelocation,
  onClose
}) => {
  const stats = TOWER_STATS[tower.type];
  const towerH = 40 + tower.level * 2;
  const screenPos = toIso(tower.x, tower.y, towerH + 15); // Adjust for taller architectural design
  const upgradeCost = Math.floor(stats.cost * 0.7 * tower.level);
  
  // Specialization Logic
  const isBaseType = [TowerType.BASIC, TowerType.SNIPER, TowerType.SPLASH].includes(tower.type);
  const isSpecialized = !isBaseType;
  const showSpecialization = tower.level >= 3 && isBaseType;
  
  const specOptions: Record<string, TowerType[]> = {
    [TowerType.BASIC]: [TowerType.VULCAN_TITAN, TowerType.VULCAN_STING],
    [TowerType.SNIPER]: [TowerType.RAILGUN_PIERCER, TowerType.RAILGUN_HYPER],
    [TowerType.SPLASH]: [TowerType.MORTAR_CRYO, TowerType.MORTAR_BOMBER],
  };

  const sellValue = Math.floor(stats.cost * 0.5 + (tower.level - 1) * stats.cost * 0.3);
  const canAffordUpgrade = gameState.money >= upgradeCost;
  const canAffordRelocation = gameState.money >= RELOCATION_FEE;
  
  // Calculate next level stats
  const nextDamage = stats.damage * (1 + tower.level * 0.5);
  const nextRange = stats.range * (1 + tower.level * 0.1);
  const nextFireRate = stats.fireRate * (1 + tower.level * 0.2);

  return (
    <div 
      className="absolute pointer-events-none"
      style={{ left: screenPos.x, top: screenPos.y }}
    >
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, scale: 0.8, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.8, y: 20 }}
          className="relative pointer-events-auto"
        >
          {/* Connector Line Design */}
          <div className="absolute w-[2px] h-12 bg-accent-cyan/40 left-1/2 -bottom-12 -translate-x-1/2" />
          <div className="absolute w-2 h-2 bg-accent-cyan rounded-full left-1/2 -bottom-[50px] -translate-x-1/2 shadow-[0_0_10px_#00f2ff]" />

          {/* Main Container */}
          <div className="w-[280px] -translate-x-1/2 -translate-y-full mb-12 bg-panel-bg/90 backdrop-blur-xl border border-white/20 rounded-xl overflow-hidden shadow-2xl">
            {/* Header */}
            <header 
              className="p-3 border-b border-white/10 flex items-center justify-between"
              style={{ backgroundColor: `${stats.color}22` }}
            >
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-accent-cyan" />
                <span className="text-[10px] font-black uppercase tracking-widest text-white/90">
                  {stats.name} <span className="text-accent-amber">MK.{tower.level}</span>
                </span>
              </div>
              <button 
                onClick={onClose}
                className="hover:bg-white/10 p-1 rounded transition-colors"
              >
                <Target className="w-3 h-3 text-white/40" />
              </button>
            </header>

            {/* Content */}
            <div className="p-4 space-y-4">
              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-2 text-[9px] font-mono">
                <div className="bg-black/40 p-2 rounded border border-white/5 space-y-1">
                  <div className="flex justify-between text-white/40 uppercase">
                    <span>Lethality</span>
                    <Activity className="w-2 h-2" />
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-sm font-bold text-accent-red">{(stats.damage * (1 + (tower.level - 1) * 0.5)).toFixed(1)}</span>
                    <span className="text-white/20">→ {nextDamage.toFixed(1)}</span>
                  </div>
                </div>
                <div className="bg-black/40 p-2 rounded border border-white/5 space-y-1">
                  <div className="flex justify-between text-white/40 uppercase">
                    <span>Aperture</span>
                    <Target className="w-2 h-2" />
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-sm font-bold text-accent-cyan">{(stats.range * (1 + (tower.level - 1) * 0.1)).toFixed(0)}</span>
                    <span className="text-white/20">→ {nextRange.toFixed(0)}</span>
                  </div>
                </div>
              </div>

              {/* Progress Level */}
              <div className="space-y-1">
                <div className="flex justify-between text-[8px] uppercase tracking-tighter text-white/40">
                  <span>Evolution Path</span>
                  <span>{tower.level}/5</span>
                </div>
                <div className="flex gap-1 h-1">
                  {[...Array(5)].map((_, i) => (
                    <div 
                      key={i} 
                      className={`flex-1 rounded-full transition-all duration-500 ${
                        i < tower.level ? 'bg-accent-cyan shadow-[0_0_5px_#00f2ff]' : 'bg-white/10'
                      }`} 
                    />
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-2 pt-2">
                {showSpecialization ? (
                  <div className="grid grid-cols-2 gap-2">
                    {specOptions[tower.type]?.map(specType => {
                      const specStats = TOWER_STATS[specType];
                      const canAffordSpec = gameState.money >= specStats.cost;
                      return (
                        <button
                          key={specType}
                          onClick={() => onSpecialize(tower.id, specType)}
                          disabled={!canAffordSpec}
                          className={`py-3 px-2 flex flex-col items-center justify-center rounded-lg transition-all text-center gap-1 ${
                            canAffordSpec
                              ? 'bg-accent-amber hover:brightness-110 active:scale-95 text-dark-bg'
                              : 'bg-white/5 text-white/20 cursor-not-allowed border border-white/5'
                          }`}
                        >
                          <span className="text-[10px] font-black uppercase leading-none">{specStats.name}</span>
                          <span className="text-[9px] opacity-70 font-mono">${specStats.cost}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={() => onUpgrade(tower.id)}
                      disabled={!canAffordUpgrade || (tower.level >= 5 && isSpecialized)}
                      className={`flex-[2] py-2 px-3 flex items-center justify-between rounded-lg transition-all group ${
                        canAffordUpgrade && !(tower.level >= 5 && isSpecialized)
                          ? 'bg-accent-cyan hover:brightness-110 active:scale-95 text-dark-bg font-black uppercase text-[10px]'
                          : 'bg-white/5 text-white/20 cursor-not-allowed text-[10px] uppercase border border-white/5'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Zap className={`w-3 h-3 ${canAffordUpgrade ? 'fill-current' : ''}`} />
                        <span>{(tower.level >= 5 && isSpecialized) ? 'Maxed' : 'Overclock'}</span>
                      </div>
                      {!(tower.level >= 5 && isSpecialized) && <span className="opacity-80">${upgradeCost}</span>}
                    </button>

                    <button
                      onClick={() => onStartRelocation(tower.id)}
                      disabled={!canAffordRelocation}
                      className={`flex-1 py-2 px-3 flex items-center justify-center rounded-lg border transition-all active:scale-95 group ${
                        canAffordRelocation 
                        ? 'bg-white/5 hover:bg-accent-amber/20 border-white/5 hover:border-accent-amber/40 text-white/40 hover:text-accent-amber'
                        : 'bg-white/5 border-white/5 text-white/10 cursor-not-allowed'
                      }`}
                      title={`Relocate ($${RELOCATION_FEE})`}
                    >
                      <MoveVertical className="w-3 h-3" />
                    </button>

                    <button
                      onClick={() => onSell(tower.id)}
                      className="flex-1 py-2 px-3 flex items-center justify-center rounded-lg bg-white/5 hover:bg-accent-red/20 border border-white/5 hover:border-accent-red/40 text-white/40 hover:text-accent-red transition-all active:scale-95 group"
                    >
                      <Unplug className="w-3 h-3 group-hover:animate-pulse" />
                    </button>
                  </div>
                )}
                
                {showSpecialization && (
                   <div className="flex gap-2">
                      <button
                        onClick={() => onStartRelocation(tower.id)}
                        disabled={!canAffordRelocation}
                        className={`flex-1 py-2 px-3 flex items-center justify-center rounded-lg border transition-all active:scale-95 font-mono text-[9px] uppercase ${
                          canAffordRelocation 
                          ? 'bg-white/5 hover:border-accent-amber/40 text-white/40'
                          : 'bg-white/5 border-white/5 text-white/10 cursor-not-allowed'
                        }`}
                      >
                        Relocate
                      </button>
                      <button
                        onClick={() => onSell(tower.id)}
                        className="flex-1 py-2 px-3 flex items-center justify-center rounded-lg bg-white/5 hover:border-accent-red/40 text-white/40 transition-all font-mono text-[9px] uppercase"
                      >
                        Deconstruct
                      </button>
                   </div>
                )}
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
