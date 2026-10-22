import React, { useState } from 'react';
import { GameCanvas } from './components/GameCanvas';
import { UIOverlay } from './components/UIOverlay';
import { useGame } from './hooks/useGame';
import { TowerType, TargetingMode } from './types';
import { TOWER_STATS, GAME_SPEEDS, getSellValue, INITIAL_LIVES, CANVAS_WIDTH, CANVAS_HEIGHT } from './constants';
import { toIso } from './lib/iso';
import { unlockAudio, isMuted, setMuted } from './lib/audio';

// The battlefield renders in WebGL (3D models, lighting, post-processing). ?renderer=2d, or a
// browser without WebGL2, falls back to the original Canvas 2D renderer. Three.js is code-split
// so the 2D path never downloads it.
const GameView3D = React.lazy(() => import('./components/GameView3D').then(m => ({ default: m.GameView3D })));
const use3D = (() => {
  if (new URLSearchParams(location.search).get('renderer') === '2d') return false;
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
})();

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
    setTowerTargetingMode,
    createFloatingText,
    bestWaves,
    newRecord,
    restart,
    waveRemaining,
    stats,
  } = useGame();

  const [placingType, setPlacingType] = useState<TowerType | null>(null);
  // The 3D view reports when its models are loaded; until then a wave can't start
  const [assetsReady, setAssetsReady] = useState(!use3D);
  const onAssetsReady = React.useCallback(() => setAssetsReady(true), []);
  const [muted, setMutedState] = useState(isMuted);
  const toggleMute = React.useCallback(() => {
    setMutedState(m => { setMuted(!m); return !m; });
  }, []);

  // Browsers only start audio after a user gesture
  React.useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  const cycleSpeed = React.useCallback(() => setGameState(s => ({
    ...s,
    gameSpeed: GAME_SPEEDS[(GAME_SPEEDS.indexOf(s.gameSpeed) + 1) % GAME_SPEEDS.length],
  })), [setGameState]);

  // Keyboard shortcuts. The handler is refreshed every render so it always sees
  // current state, while the window listener itself is registered only once.
  const keyHandlerRef = React.useRef<(e: KeyboardEvent) => void>(() => {});
  // Selling by keyboard needs a second S press within this window, so a stray key can't sell
  const SELL_CONFIRM_MS = 2000;
  const sellArmedRef = React.useRef<{ id: string; until: number } | null>(null);
  keyHandlerRef.current = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;

    const selected = towers.find(t => t.id === gameState.selectedTowerId);
    const key = e.key.toLowerCase();

    if (key === 'escape') {
      // Esc first backs out of whatever is in hand; with nothing to cancel it pauses a running wave
      // (while paused, the pause menu takes Esc itself and resumes)
      if (placingType || gameState.relocatingTowerId || gameState.selectedTowerId) {
        setPlacingType(null);
        cancelRelocation();
        setGameState(s => ({ ...s, selectedTowerId: null }));
      } else if (!gameState.isWaveReady && !gameState.isGameOver) {
        setGameState(s => ({ ...s, isPaused: !s.isPaused }));
      }
      return;
    }
    if (e.repeat) return;

    const baseTypes = [TowerType.BASIC, TowerType.SNIPER, TowerType.SPLASH];
    const slot = ['1', '2', '3'].indexOf(key);
    if (slot !== -1) {
      const type = baseTypes[slot];
      if (placingType === type) setPlacingType(null);
      else if (gameState.money >= TOWER_STATS[type].cost) {
        setPlacingType(type);
        cancelRelocation();
        setGameState(s => ({ ...s, selectedTowerId: null }));
      }
      return;
    }

    switch (key) {
      case ' ':
        e.preventDefault();
        // Don't let a focused button also receive the Space activation
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        if (gameState.isWaveReady && !gameState.isGameOver && assetsReady) startWave();
        return;
      case 'p':
        setGameState(s => ({ ...s, isPaused: !s.isPaused }));
        return;
      case 'f':
        cycleSpeed();
        return;
      case 'm':
        toggleMute();
        return;
    }

    if (!selected) return;
    switch (key) {
      case 'u':
        upgradeTower(selected.id);
        return;
      case 's': {
        const armed = sellArmedRef.current;
        if (armed && armed.id === selected.id && performance.now() < armed.until) {
          sellArmedRef.current = null;
          sellTower(selected.id);
        } else {
          sellArmedRef.current = { id: selected.id, until: performance.now() + SELL_CONFIRM_MS };
          createFloatingText(selected.x, selected.y - 30, `S again: sell +$${getSellValue(selected)}`, '#ffb800');
        }
        return;
      }
      case 'r':
        startRelocation(selected.id);
        return;
      case 't': {
        const modes = Object.values(TargetingMode) as TargetingMode[];
        setTowerTargetingMode(selected.id, modes[(modes.indexOf(selected.targetingMode) + 1) % modes.length]);
        return;
      }
    }
  };

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => keyHandlerRef.current(e);
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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

  // The shake decays only while the game runs, so a stopped game (paused, lost) mustn't shake
  const shakeTime = gameState.isPaused || gameState.isGameOver ? 0 : gameState.shakeTime;

  const canvasProps = {
    towers,
    enemies,
    projectiles,
    particles,
    floatingTexts,
    selectedTowerId: gameState.selectedTowerId,
    relocatingTowerId: gameState.relocatingTowerId,
    placingType,
    shakeTime,
    coreIntegrity: gameState.lives / INITIAL_LIVES,
    onCanvasClick: handleCanvasClick,
  };

  // Damage shake: the 2D view shakes the whole page; the 3D view shakes only its camera
  return (
    <div className={`min-h-screen bg-dark-bg flex flex-col overflow-hidden font-sans relative ${shakeTime > 0 && !use3D ? 'jitter-effect' : ''}`}>
      
      <UIOverlay 
        gameState={gameState}
        towers={towers}
        onStartWave={() => { if (assetsReady) startWave(); }}
        onPauseToggle={() => setGameState(s => ({ ...s, isPaused: !s.isPaused }))}
        onRestart={restart}
        onCycleSpeed={cycleSpeed}
        muted={muted}
        onToggleMute={toggleMute}
        bestWaves={bestWaves}
        newRecord={newRecord}
        screenGrid={!use3D}
        assetsReady={assetsReady}
        waveRemaining={waveRemaining}
        stats={stats}
        onUpgradeTower={upgradeTower}
        onSpecializeTower={specializeTower}
        onSellTower={sellTower}
        onStartRelocation={startRelocation}
        onCancelRelocation={cancelRelocation}
        onSelectTower={(id) => setGameState(s => ({ ...s, selectedTowerId: id }))}
        onSetTargetingMode={setTowerTargetingMode}
        placingType={placingType}
        setPlacingType={setPlacingType}
        renderCanvas={use3D ? (
          <React.Suspense fallback={<div style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }} className="bg-dark-bg" />}>
            <GameView3D {...canvasProps} onReady={onAssetsReady} />
          </React.Suspense>
        ) : (
          <GameCanvas {...canvasProps} />
        )
        }
      />
    </div>
  );
}
