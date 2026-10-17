import * as THREE from 'three';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../constants';

// Game world is 1000×800 "px" on the ground plane with z up. The 3D scene uses 1 unit = 10 px,
// centred on the field, with Y up: game x → +X, game y → +Z.
export const UNIT = 10;
export const FIELD_W = CANVAS_WIDTH / UNIT;   // 100
export const FIELD_D = CANVAS_HEIGHT / UNIT;  // 80

export const toWorld = (x: number, y: number, z = 0) =>
  new THREE.Vector3(x / UNIT - FIELD_W / 2, z / UNIT, y / UNIT - FIELD_D / 2);

// Road surface height (game roadHeight 15px)
export const ROAD_H = 1.5;
export const ROAD_W = 5.5;
