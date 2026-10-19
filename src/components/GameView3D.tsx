import React, { useEffect, useRef, useState } from 'react';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../constants';
import { Point } from '../types';
import { fromIso, toIso } from '../lib/iso';
import { checkPlacement } from '../lib/placement';
import type { GameCanvasProps } from './GameCanvas';
import { createGameScene, SceneInputs } from '../render3d/gameScene';

// WebGL battlefield: a drop-in for GameCanvas (same props, same 1000×800 frame and click
// coordinates). The scene runs its own render loop and reads the latest props from a ref, so
// React re-rendering every game tick costs next to nothing here.

const distToSegment = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
  const l2 = (x1 - x2) ** 2 + (y1 - y2) ** 2;
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
};

interface GameView3DProps extends GameCanvasProps {
  onReady?: () => void; // models loaded and warmed up
}

export const GameView3D: React.FC<GameView3DProps> = ({ onReady, ...props }) => {
  const { towers, placingType, relocatingTowerId, onCanvasClick } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const [hoveredTowerId, setHoveredTowerId] = useState<string | null>(null);
  const [mouse, setMouse] = useState<Point | null>(null);

  const inputsRef = useRef<SceneInputs | null>(null);
  inputsRef.current = { ...props, hoveredTowerId, mouse: placingType || relocatingTowerId ? mouse : null };

  useEffect(() => {
    const scene = createGameScene(
      hostRef.current!, hudRef.current!, () => inputsRef.current!,
      () => { setReady(true); onReadyRef.current?.(); },
      setProgress,
    );
    return () => scene.dispose();
  }, []);

  // Pointer position in the fixed 1000×800 frame, whatever the arena's CSS scale
  const toFrame = (e: React.MouseEvent) => {
    const rect = hostRef.current!.getBoundingClientRect();
    return {
      sx: (e.clientX - rect.left) * (CANVAS_WIDTH / rect.width),
      sy: (e.clientY - rect.top) * (CANVAS_HEIGHT / rect.height),
    };
  };

  const handleClick = (e: React.MouseEvent) => {
    const { sx, sy } = toFrame(e);
    const g = fromIso(sx, sy);
    onCanvasClick(g.x, g.y, sx, sy);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const { sx, sy } = toFrame(e);
    // Same tower hit test as the click handler in App: distance to the tower's vertical axis
    const hovered = towers.find(t => {
      const base = toIso(t.x, t.y, 0);
      const top = toIso(t.x, t.y, 40 + t.level * 2 + 15);
      return distToSegment(sx, sy, base.x, base.y, top.x, top.y) < 25;
    });
    setHoveredTowerId(hovered?.id ?? null);
    if (placingType || relocatingTowerId) setMouse(fromIso(sx, sy));
  };

  const ghostCheck = (placingType || relocatingTowerId) && mouse
    ? checkPlacement(mouse, towers, relocatingTowerId ?? undefined)
    : 'OK';

  return (
    <div
      ref={hostRef}
      id="game-canvas"
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => { setHoveredTowerId(null); setMouse(null); }}
      style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
      className={`relative overflow-hidden bg-dark-bg rounded-lg outline outline-1 outline-slate-800 shadow-2xl ${hoveredTowerId ? 'cursor-pointer' : ghostCheck !== 'OK' ? 'cursor-not-allowed' : 'cursor-crosshair'}`}
    >
      <canvas ref={hudRef} className="absolute inset-0 pointer-events-none" style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT, zIndex: 1 }} />
      {!ready && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none" style={{ zIndex: 2 }}>
          <span className="font-mono text-xs tracking-[0.3em] text-accent-cyan animate-pulse">LOADING DEFENSE GRID…</span>
          <div className="w-64 h-1 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full bg-accent-cyan shadow-[0_0_10px_#00f2ff] transition-[width] duration-200" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <span className="font-mono text-[10px] text-white/40">{progress < 1 ? `${Math.round(progress * 100)}%` : 'PREPARING…'}</span>
        </div>
      )}
    </div>
  );
};
