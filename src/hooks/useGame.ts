import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  TowerInstance,
  EnemyInstance,
  Projectile,
  GameState,
  TowerType,
  TargetingMode,
  WaveModifier,
  Particle,
  FloatingText,
} from '../types';
import { 
  CANVAS_WIDTH, 
  CANVAS_HEIGHT, 
  INITIAL_MONEY, 
  INITIAL_LIVES, 
  PATH, 
  TOWER_STATS, 
  RELOCATION_FEE,
  getSellValue,
  getWaveConfig,
  getWaveBonus,
  getFireInterval,
  getMaxLevel,
  getUpgradeCost,
} from '../constants';
import { loadRun, saveRun, clearRun, loadBest, saveBest, hydrateTowers } from '../lib/storage';
import { checkPlacement } from '../lib/placement';
import { playSound } from '../lib/audio';
import { step, startWaveRun, idleWave, SimEvents, SimState, WaveRun } from '../game/sim';

// Stereo position of a world point: left/right across the isometric screen
const panAt = (x: number, y: number) => Math.max(-1, Math.min(1, ((x - y) * 0.6) / 500)) * 0.7;

// Reward labels merge when a new one spawns this close to one still young enough
const MONEY_MERGE_RADIUS = 60;
const MONEY_MERGE_MIN_LIFE = 0.4;

export function useGame() {
  // Resume the last run (saved between waves) if there is one
  const [initialRun] = useState(loadRun);
  const restoredFromSave = !!initialRun && (initialRun.waveNumber > 0 || initialRun.towers.length > 0);

  const [gameState, setGameState] = useState<GameState>({
    money: initialRun?.money ?? INITIAL_MONEY,
    lives: initialRun?.lives ?? INITIAL_LIVES,
    waveNumber: initialRun?.waveNumber ?? 0,
    isPaused: true,
    isGameOver: false,
    isWaveReady: true,
    selectedTowerId: null,
    relocatingTowerId: null,
    shakeTime: 0,
    currentWaveModifier: WaveModifier.NONE,
    gameSpeed: initialRun?.gameSpeed ?? 1,
  });

  const [towers, setTowers] = useState<TowerInstance[]>(() => initialRun ? hydrateTowers(initialRun.towers) : []);

  // Best run = most waves cleared; newRecord flags that this run beat the best it started against
  const [bestWaves, setBestWaves] = useState(() => loadBest()?.waves ?? 0);
  const [newRecord, setNewRecord] = useState(false);
  const runStartBestRef = useRef(bestWaves);
  const [enemies, setEnemies] = useState<EnemyInstance[]>([]);
  const [projectiles, setProjectiles] = useState<Projectile[]>([]);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [floatingTexts, setFloatingTexts] = useState<FloatingText[]>([]);
  const [waveActive, setWaveActive] = useState(false);

  // --- REFS FOR ENGINE STABILITY (Prevents stuttering from constant dependency shifts) ---
  const enemiesRef = useRef<EnemyInstance[]>([]);
  const towersRef = useRef<TowerInstance[]>([]);
  const projectilesRef = useRef<Projectile[]>([]);
  const gameStateRef = useRef<GameState>(gameState);

  // Sync refs with state for the engine loop
  useEffect(() => { enemiesRef.current = enemies; }, [enemies]);
  useEffect(() => { towersRef.current = towers; }, [towers]);
  useEffect(() => { projectilesRef.current = projectiles; }, [projectiles]);
  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);

  const requestRef = useRef<number>(null);
  const lastTimeRef = useRef<number>(0);
  // Spawn queue and progress of the current wave (synchronous, so several sim steps per frame
  // can't double-award the wave bonus)
  const waveRef = useRef<WaveRun>(idleWave());

  // Helper: Create particles
  const createExplosion = useCallback((x: number, y: number, color: string, count: number = 10) => {
    const newParticles: Particle[] = [];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 100 + 50;
      newParticles.push({
        id: `p-${Math.random().toString(36).substr(2, 5)}-${Date.now()}`,
        x,
        y,
        z: 10,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        maxLife: 1,
        color,
        size: Math.random() * 3 + 1,
      });
    }
    setParticles(prev => [...prev.slice(-60), ...newParticles]);
  }, []);

  const createFloatingText = useCallback((x: number, y: number, text: string, color: string) => {
    setFloatingTexts(prev => {
      // Kill rewards landing close together roll up into one "+$N" instead of a pile of labels
      const amount = /^\+\$(\d+)$/.exec(text);
      if (amount) {
        const idx = prev.findIndex(t =>
          t.color === color && t.life > MONEY_MERGE_MIN_LIFE &&
          /^\+\$\d+$/.test(t.text) && Math.hypot(t.x - x, t.y - y) < MONEY_MERGE_RADIUS);
        if (idx !== -1) {
          const merged = prev[idx];
          const total = Number(merged.text.slice(2)) + Number(amount[1]);
          const next = [...prev];
          next[idx] = { ...merged, text: `+$${total}`, life: 1 };
          return next;
        }
      }
      const newText: FloatingText = {
        id: `t-${Math.random().toString(36).substr(2, 5)}-${Date.now()}`,
        x,
        y,
        text,
        life: 1,
        color,
      };
      return [...prev.slice(-20), newText];
    });
  }, []);

  // Sounds, particles and labels the simulation asks for
  const simEvents = useMemo<SimEvents>(() => ({
    sound: (name, x, y) => playSound(name, x === undefined || y === undefined ? 0 : panAt(x, y)),
    explosion: createExplosion,
    text: createFloatingText,
  }), [createExplosion, createFloatingText]);

  const startWave = useCallback(() => {
    if (waveActive || gameState.isGameOver) return;
    
    const waveNumber = (gameState.waveNumber || 0) + 1;
    const wave = getWaveConfig(waveNumber);

    waveRef.current = startWaveRun(waveNumber);
    setWaveActive(true);
    playSound('waveStart');
    if (wave.enemyTypes.includes('COLOSSUS')) window.setTimeout(() => playSound('bossWarn'), 650);
    setGameState(prev => ({ ...prev, isPaused: false, isWaveReady: false, waveNumber, currentWaveModifier: wave.modifier }));
  }, [waveActive, gameState.waveNumber, gameState.isGameOver]);

  const placeTower = useCallback((type: TowerType, x: number, y: number) => {
    const stats = TOWER_STATS[type];
    if (gameState.money < stats.cost) { playSound('error'); return; }

    const check = checkPlacement({ x, y }, towers);
    if (check !== 'OK') {
      createFloatingText(x, y, check === 'PATH' ? "INVALID TERRAIN" : "SPACE OCCUPIED", "#ff4d4d");
      playSound('error');
      return;
    }

    const newTower: TowerInstance = {
      id: Math.random().toString(36).substr(2, 9),
      type,
      x,
      y,
      level: 1,
      lastFired: getFireInterval(type, 1), // ready to fire
      targetId: null,
      currentAngle: -Math.PI / 2,
      baseType: type,
      targetingMode: TargetingMode.FIRST,
      invested: stats.cost,
    };

    setTowers(prev => [...prev, newTower]);
    playSound('place', panAt(x, y));
    setGameState(prev => ({ ...prev, money: prev.money - stats.cost }));
  }, [gameState.money, towers, createFloatingText]);

  const upgradeTower = useCallback((id: string) => {
    const tower = towers.find(t => t.id === id);
    if (!tower) return;
    
    if (tower.level >= getMaxLevel(tower.type)) return;
    const upgradeCost = getUpgradeCost(tower.type, tower.level);
    
    if (gameState.money >= upgradeCost) {
      setTowers(prev => prev.map(t => t.id === id ? { ...t, level: t.level + 1, invested: t.invested + upgradeCost } : t));
      setGameState(prev => ({ ...prev, money: prev.money - upgradeCost }));
      createFloatingText(tower.x, tower.y - 20, "UPGRADED!", "#00f2ff");
      playSound('upgrade', panAt(tower.x, tower.y));
    } else {
      playSound('error');
    }
  }, [towers, gameState.money, createFloatingText]);

  const specializeTower = useCallback((id: string, newType: TowerType) => {
    const tower = towers.find(t => t.id === id);
    if (!tower) return;

    const stats = TOWER_STATS[newType];
    const cost = stats.cost; // Branching cost

    if (gameState.money >= cost) {
      // The tower keeps its level: specializing is a step up, not a restart
      setTowers(prev => prev.map(t => t.id === id ? { ...t, type: newType, invested: t.invested + cost } : t));
      setGameState(prev => ({ ...prev, money: prev.money - cost }));
      createExplosion(tower.x, tower.y, stats.color, 20);
      playSound('specialize', panAt(tower.x, tower.y));
      createFloatingText(tower.x, tower.y - 20, stats.name.toUpperCase(), stats.color);
    }
  }, [towers, gameState.money, createFloatingText, createExplosion]);

  const sellTower = useCallback((id: string) => {
    const tower = towers.find(t => t.id === id);
    if (!tower) return;
    
    const sellValue = getSellValue(tower);
    
    setTowers(prev => prev.filter(t => t.id !== id));
    setGameState(prev => ({ ...prev, money: prev.money + sellValue, selectedTowerId: null, relocatingTowerId: null }));
    createFloatingText(tower.x, tower.y, `+$${sellValue}`, "#ffb800");
    playSound('sell', panAt(tower.x, tower.y));
  }, [towers, createFloatingText]);

  const startRelocation = useCallback((id: string) => {
    if (gameState.money < RELOCATION_FEE) {
      createFloatingText(CANVAS_WIDTH/2, CANVAS_HEIGHT/2, "NOT ENOUGH ENERGY", "#ff4d4d");
      return;
    }
    setGameState(prev => ({ ...prev, relocatingTowerId: id }));
  }, [gameState.money, createFloatingText]);

  const cancelRelocation = useCallback(() => {
    setGameState(prev => ({ ...prev, relocatingTowerId: null }));
  }, []);

  const confirmRelocation = useCallback((id: string, x: number, y: number) => {
    const tower = towers.find(t => t.id === id);
    if (!tower) return;

    const check = checkPlacement({ x, y }, towers, id);
    if (check !== 'OK') {
      createFloatingText(x, y, check === 'PATH' ? "INVALID TERRAIN" : "SPACE OCCUPIED", "#ff4d4d");
      playSound('error');
      return;
    }

    setTowers(prev => prev.map(t => t.id === id ? { ...t, x, y } : t));
    setGameState(prev => ({ 
      ...prev, 
      money: prev.money - RELOCATION_FEE,
      relocatingTowerId: null,
      selectedTowerId: id 
    }));
    createExplosion(x, y, "#00f2ff", 15);
    playSound('place', panAt(x, y));
    createFloatingText(x, y - 20, "REDEPLOYED", "#00f2ff");
  }, [towers, createFloatingText, createExplosion]);

  const update = useCallback((time: number) => {
    if (lastTimeRef.current !== undefined) {
      const dt = Math.min(0.05, (time - lastTimeRef.current) / 1000); // Bulletproof dt cap
      // Fast-forward runs several fixed steps per frame instead of a bigger dt,
      // so fast projectiles can't tunnel past their collision radius
      const steps = gameStateRef.current.gameSpeed || 1;

      for (let i = 0; i < steps; i++) {
        const currentGameState = gameStateRef.current;
      
        if (!currentGameState.isPaused && !currentGameState.isGameOver) {
          const sim: SimState = {
            waveNumber: currentGameState.waveNumber,
            enemies: enemiesRef.current,
            towers: towersRef.current,
            projectiles: projectilesRef.current,
            wave: waveRef.current,
          };
          const { moneyEarned, livesLost, waveCleared } = step(sim, dt, simEvents);
          let newShake = currentGameState.shakeTime;
          if (livesLost > 0) newShake = 0.3;
          if (newShake > 0) newShake = Math.max(0, newShake - dt);

          // Refs first, so the next step this frame sees the result (no React lag)
          enemiesRef.current = sim.enemies;
          towersRef.current = sim.towers;
          projectilesRef.current = sim.projectiles;
          setEnemies(sim.enemies);
          setTowers(sim.towers);
          setProjectiles(sim.projectiles);

          if (moneyEarned !== 0 || livesLost !== 0 || newShake !== currentGameState.shakeTime) {
            const nextLives = Math.max(0, currentGameState.lives - livesLost);
            const updatedGameState = {
              ...currentGameState,
              money: currentGameState.money + moneyEarned,
              lives: nextLives,
              shakeTime: newShake,
              isGameOver: nextLives <= 0,
            };
            setGameState(updatedGameState);
            gameStateRef.current = updatedGameState;
          }

          if (waveCleared) {
            const waveBonus = getWaveBonus(currentGameState.waveNumber);
            const updatedState = {
              ...gameStateRef.current,
              money: gameStateRef.current.money + waveBonus,
              isWaveReady: true,
              currentWaveModifier: WaveModifier.NONE,
            };
            setWaveActive(false);
            setGameState(updatedState);
            gameStateRef.current = updatedState;
            createFloatingText(PATH[PATH.length - 1].x, PATH[PATH.length - 1].y, `Wave Bonus: +$${waveBonus}`, "#10b981");
            playSound('waveClear');
          }

          // Ephemeral Update
          setParticles(prev => prev.map(p => ({
              ...p,
              x: p.x + p.vx * dt,
              y: p.y + (p.vy || 0) * dt,
              z: (p.z || 10) + (Math.random() - 0.5) * 15 * dt,
              life: p.life - dt * 2.2
            })).filter(p => p.life > 0));

          setFloatingTexts(prev => prev.map(t => ({
              ...t,
              y: t.y - dt * 50,
              life: t.life - dt * 1.5
            })).filter(t => t.life > 0));
        }
      }
    }
    lastTimeRef.current = time;
    requestRef.current = requestAnimationFrame(update);
  }, [simEvents, createFloatingText]); // Stable dependencies


  useEffect(() => {
    requestRef.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(requestRef.current!);
  }, [update]);

  const setTowerTargetingMode = useCallback((id: string, mode: TargetingMode) => {
    setTowers(prev => prev.map(t => t.id === id ? { ...t, targetingMode: mode } : t));
  }, []);

  // --- PERSISTENCE ---
  // Autosave only between waves: the field is empty then, so the run is fully described
  // by economy + towers. Mid-wave reloads resume from the start of that wave.
  const towerSignature = towers
    .map(t => `${t.id}:${t.type}:${t.level}:${t.x}:${t.y}:${t.targetingMode}:${t.invested}`)
    .join('|');
  useEffect(() => {
    const { isWaveReady, isGameOver, waveNumber, money, lives, gameSpeed } = gameState;
    if (!isWaveReady || isGameOver) return;
    if (waveNumber === 0 && towersRef.current.length === 0) return; // nothing worth saving yet
    saveRun({
      money, lives, waveNumber, gameSpeed,
      towers: towersRef.current.map(({ id, type, baseType, x, y, level, targetingMode, invested }) =>
        ({ id, type, baseType, x, y, level, targetingMode, invested })),
    });
  }, [gameState.isWaveReady, gameState.isGameOver, gameState.waveNumber, gameState.money, gameState.lives, gameState.gameSpeed, towerSignature]);

  // A lost run can't be resumed
  useEffect(() => {
    if (gameState.isGameOver) {
      clearRun();
      playSound('gameOver');
    }
  }, [gameState.isGameOver]);

  useEffect(() => {
    const cleared = gameState.isWaveReady ? gameState.waveNumber : gameState.waveNumber - 1;
    if (cleared > bestWaves) {
      setBestWaves(cleared);
      saveBest(cleared);
    }
    if (cleared > runStartBestRef.current) setNewRecord(true);
  }, [gameState.isWaveReady, gameState.waveNumber, bestWaves]);

  const restart = () => {
    clearRun();
    runStartBestRef.current = bestWaves;
    setNewRecord(false);
    setGameState({
      money: INITIAL_MONEY,
      lives: INITIAL_LIVES,
      waveNumber: 0,
      isPaused: false,
      isGameOver: false,
      isWaveReady: true,
      selectedTowerId: null,
      relocatingTowerId: null,
      shakeTime: 0,
      currentWaveModifier: WaveModifier.NONE,
      gameSpeed: gameStateRef.current.gameSpeed,
    });
    setTowers([]);
    setEnemies([]);
    setProjectiles([]);
    setParticles([]);
    setFloatingTexts([]);
    setWaveActive(false);
    waveRef.current = idleWave();
  };

  // What's left of the running wave, by kind: alive now plus still to spawn (re-derived every tick)
  let waveRemaining: Record<string, number> | null = null;
  const run = waveRef.current;
  if (waveActive && run.config) {
    waveRemaining = {};
    for (const kind of run.config.spawns.slice(run.config.count - run.toSpawn)) waveRemaining[kind] = (waveRemaining[kind] ?? 0) + 1;
    for (const e of enemies) waveRemaining[e.type] = (waveRemaining[e.type] ?? 0) + 1;
  }

  return {
    gameState,
    setGameState,
    waveRemaining,
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
    waveActive,
    createFloatingText,
    bestWaves,
    newRecord,
    restoredFromSave,
    restart
  };
}
