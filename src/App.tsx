import React, { useState } from 'react';
import { GameCanvas } from './components/GameCanvas';
import { UIOverlay } from './components/UIOverlay';
import { useGame } from './hooks/useGame';
import { TowerType } from './types';
import { TOWER_STATS } from './constants';
import { toIso } from './lib/iso';

// Helper for 2.5D hit detection: distance from point to vertical segment
const distToSegment = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
  const l2 = (x1 - x2) ** 2 + (y1 - y2) ** 2;
  if (l2 === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.sqrt((px - (x1 + t * (x2 - x1))) ** 2 + (py - (y1 + t * (y2 - y1))) ** 2);
};

export default function App() {
  const {
    gameState,
    setGameState,
    towers,
    enemies,
    projectiles,
    particles,
    floatingTexts,
    startWave,
    placeTower,
    upgradeTower,
    specializeTower,
    sellTower,
    startRelocation,
    cancelRelocation,
    confirmRelocation,
    restart
  } = useGame();

  const [placingType, setPlacingType] = useState<TowerType | null>(null);

  // Keyboard support for UX consistency
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPlacingType(null);
        cancelRelocation();
        setGameState(s => ({ ...s, selectedTowerId: null }));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cancelRelocation, setGameState]);

  const handleCanvasClick = (x: number, y: number, sx: number, sy: number) => {
    // 0. If relocating an existing tower
    if (gameState.relocatingTowerId) {
      confirmRelocation(gameState.relocatingTowerId, x, y);
      return;
    }

    // 1. Check if clicking on an existing tower
    // We check screen-space distance to the tower "pillar"
    const clickedTower = towers.find(t => {
      const towerH = 40 + t.level * 2;
      const base = toIso(t.x, t.y, 0);
      const top = toIso(t.x, t.y, towerH + 15); // include turret head in hit area
      
      const distance = distToSegment(sx, sy, base.x, base.y, top.x, top.y);
      return distance < 25; // Hit radius (generous for accessibility)
    });

    if (clickedTower) {
      setGameState(s => ({ ...s, selectedTowerId: clickedTower.id }));
      setPlacingType(null); // Cancel placement if selecting
      return;
    }

    // 2. If placing a new tower
    if (placingType) {
      const stats = TOWER_STATS[placingType];
      if (gameState.money >= stats.cost) {
        placeTower(placingType, x, y);
        setPlacingType(null);
      }
      return;
    }

    // 3. Clear selection if clicking empty space
    setGameState(s => ({ ...s, selectedTowerId: null }));
  };

  return (
    <div className={`min-h-screen bg-dark-bg flex flex-col overflow-hidden font-sans relative ${gameState.shakeTime > 0 ? 'jitter-effect' : ''}`}>
      <div className="crt-overlay" />
      <div className="scanner-line" />
      
      <UIOverlay 
        gameState={gameState}
        towers={towers}
        onStartWave={startWave}
        onPauseToggle={() => setGameState(s => ({ ...s, isPaused: !s.isPaused }))}
        onRestart={restart}
        onPlaceTower={placeTower}
        onUpgradeTower={upgradeTower}
        onSpecializeTower={specializeTower}
        onSellTower={sellTower}
        onStartRelocation={startRelocation}
        onCancelRelocation={cancelRelocation}
        onSelectTower={(id) => setGameState(s => ({ ...s, selectedTowerId: id }))}
        placingType={placingType}
        setPlacingType={setPlacingType}
        renderCanvas={
          <GameCanvas 
            towers={towers}
            enemies={enemies}
            projectiles={projectiles}
            particles={particles}
            floatingTexts={floatingTexts}
            selectedTowerId={gameState.selectedTowerId}
            relocatingTowerId={gameState.relocatingTowerId}
            placingType={placingType}
            shakeTime={gameState.shakeTime}
            onCanvasClick={handleCanvasClick}
          />
        }
      />
    </div>
  );
}
