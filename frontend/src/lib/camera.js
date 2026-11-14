// Grass-dark strip under the sky section (the light grass is the sky's bottom 16px).
export const GROUND_H = 8

// Where the camera sits for a screen and depth: 0 shows the sky; depth d puts
// the top of stratum d at the top of the viewport.
export function cameraY({ screen, depth }, { horizon, vh }) {
  if (screen !== 'run' || depth < 1) return 0
  return horizon + GROUND_H + (depth - 1) * vh
}
