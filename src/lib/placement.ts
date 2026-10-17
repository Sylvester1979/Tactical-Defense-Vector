import { Point, TowerInstance } from '../types';
import { PATH } from '../constants';

const PATH_BUFFER = 40;     // Towers can't sit on or right next to the road
const TOWER_SPACING = 35;   // Minimum distance between tower centres

export type PlacementCheck = 'OK' | 'PATH' | 'OCCUPIED';

export const isNearPath = (x: number, y: number, buffer: number = PATH_BUFFER) => {
  for (let i = 0; i < PATH.length - 1; i++) {
    const p1 = PATH[i];
    const p2 = PATH[i + 1];
    const l2 = (p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2;
    if (l2 === 0) continue;
    const t = Math.max(0, Math.min(1, ((x - p1.x) * (p2.x - p1.x) + (y - p1.y) * (p2.y - p1.y)) / l2));
    if (Math.hypot(x - (p1.x + t * (p2.x - p1.x)), y - (p1.y + t * (p2.y - p1.y))) < buffer) return true;
  }
  return false;
};

// Single rule shared by placement, relocation and the ghost preview
export const checkPlacement = (pos: Point, towers: TowerInstance[], ignoreId?: string): PlacementCheck => {
  if (isNearPath(pos.x, pos.y)) return 'PATH';
  if (towers.some(t => t.id !== ignoreId && Math.hypot(t.x - pos.x, t.y - pos.y) < TOWER_SPACING)) return 'OCCUPIED';
  return 'OK';
};
