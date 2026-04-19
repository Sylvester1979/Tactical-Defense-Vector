import { CANVAS_WIDTH } from "../constants";

export const ISO_SCALE = 0.6;
export const OFFSET_X = CANVAS_WIDTH / 2;
export const OFFSET_Y = 80;

/**
 * Converts game coordinates (x, y, z) to screen coordinates.
 */
export const toIso = (x: number, y: number, z: number = 0) => ({
  x: (x - y) * ISO_SCALE + OFFSET_X,
  y: (x + y) * ISO_SCALE * 0.5 + OFFSET_Y - z
});

/**
 * Converts screen coordinates to game coordinates.
 */
export const fromIso = (screenX: number, screenY: number) => {
  const x_rel = (screenX - OFFSET_X) / ISO_SCALE;
  const y_rel = (screenY - OFFSET_Y) / (ISO_SCALE * 0.5);
  return {
    x: (x_rel + y_rel) / 2,
    y: (y_rel - x_rel) / 2
  };
};
