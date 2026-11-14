import { inCircle, rasterize } from './generate'
import { mirror, overlay, pixelRects } from './pixel'
import PixelSprite from './PixelSprite'

// Background sprites for the surface: tree, sun, cloud and bird.

// Deterministic pseudo-random value in [0, 1) per pixel, for scattered texture.
const speckle = (x, y) => {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return n - Math.floor(n)
}

/* ---------- Tree: lumpy round canopy, outlined, with a trunk ---------- */
const TREE = rasterize(
  31,
  42,
  (x, y) => {
    const canopy =
      inCircle(x, y, 15.5, 12, 11) || inCircle(x, y, 8.5, 18, 7) || inCircle(x, y, 22.5, 18, 7)
    if (canopy) {
      if (inCircle(x, y, 11, 8, 4.5)) return 'l' // highlight, upper left
      if (x - 15.5 + (y - 12) > 10) return 'g' // shade, lower right
      if (speckle(x, y) < 0.09) return 'g' // scattered leaf texture
      if (speckle(x, y) > 0.96) return 'l'
      return 'G'
    }
    const trunk = (y >= 22 && x >= 13 && x <= 17) || (y >= 39 && x >= 11 && x <= 19)
    if (trunk) return x >= 16 ? 't' : 'T'
    return null
  },
  'K',
)
const TREE_PALETTE = {
  K: 'var(--ink)',
  G: 'var(--grass)',
  g: 'var(--grass-dark)',
  l: '#8fd06f',
  T: '#7a5232',
  t: '#5a3a22',
}
const TREE_MIRRORED = mirror(TREE)

export function Tree({ scale = 3, mirrored = false, className = '' }) {
  return (
    <PixelSprite
      rows={mirrored ? TREE_MIRRORED : TREE}
      palette={TREE_PALETTE}
      scale={scale}
      className={className}
    />
  )
}

/* ---------- Sun: outlined disc with two alternating ray sets ---------- */
const SUN_SIZE = 30
const SUN_C = SUN_SIZE / 2
const SUN_BODY = rasterize(
  SUN_SIZE,
  SUN_SIZE,
  (x, y) => {
    if (!inCircle(x, y, SUN_C, SUN_C, 8.5)) return null
    return inCircle(x, y, SUN_C - 2.5, SUN_C - 2.5, 3.5) ? 'y' : 'Y'
  },
  'O',
)
const sunRays = (offsetDeg) =>
  rasterize(SUN_SIZE, SUN_SIZE, (x, y) => {
    const dx = x + 0.5 - SUN_C
    const dy = y + 0.5 - SUN_C
    const d = Math.hypot(dx, dy)
    if (d < 11 || d > 14.2) return null
    const angle = ((Math.atan2(dy, dx) * 180) / Math.PI - offsetDeg + 360) % 45
    return angle < 6 || angle > 39 ? 'R' : null
  })
const SUN_RAYS_A = sunRays(0)
const SUN_RAYS_B = sunRays(22.5)
const SUN_PALETTE = { O: '#e99a2c', Y: '#ffd24d', y: '#fff0a6', R: '#ffc93d' }

export function Sun({ scale = 4, className = '' }) {
  return (
    <svg
      className={`sprite sun ${className}`}
      viewBox={`0 0 ${SUN_SIZE} ${SUN_SIZE}`}
      width={SUN_SIZE * scale}
      height={SUN_SIZE * scale}
      aria-hidden="true"
      focusable="false"
    >
      <g className="sun__rays sun__rays--a">{pixelRects(SUN_RAYS_A, SUN_PALETTE, 'a')}</g>
      <g className="sun__rays sun__rays--b">{pixelRects(SUN_RAYS_B, SUN_PALETTE, 'b')}</g>
      <g>{pixelRects(SUN_BODY, SUN_PALETTE, 's')}</g>
    </svg>
  )
}

/* ---------- Cloud: puffy blob, white with a shaded base, no outline ---------- */
const CLOUD = rasterize(40, 14, (x, y) => {
  const puff =
    inCircle(x, y, 11, 9, 5) ||
    inCircle(x, y, 18, 6.5, 6.5) ||
    inCircle(x, y, 27, 8, 5.5) ||
    inCircle(x, y, 33, 10, 4) ||
    (y >= 9 && y <= 13 && x >= 7 && x <= 35)
  if (!puff) return null
  return y >= 12 ? 'c' : 'W'
})
const CLOUD_PALETTE = { W: '#ffffff', c: '#d6e8f3' }

export function Cloud({ scale = 4, className = '' }) {
  return <PixelSprite rows={CLOUD} palette={CLOUD_PALETTE} scale={scale} className={className} />
}

/* ---------- Bird: two-frame flap ---------- */
const BIRD_W = 9
const BIRD_H = 5
const WINGS_UP = overlay(BIRD_W, BIRD_H, {
  0: 'K.......K',
  1: '.K.....K.',
  2: '..K...K..',
  3: '...KKK...',
})
const WINGS_DOWN = overlay(BIRD_W, BIRD_H, {
  2: '...KKK...',
  3: '.KK...KK.',
  4: 'K.......K',
})
const BIRD_PALETTE = { K: 'var(--ink-soft)' }

export function Bird({ scale = 3, className = '', style }) {
  return (
    <svg
      className={`sprite bird ${className}`}
      viewBox={`0 0 ${BIRD_W} ${BIRD_H}`}
      width={BIRD_W * scale}
      height={BIRD_H * scale}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      <g className="bird__up">{pixelRects(WINGS_UP, BIRD_PALETTE, 'u')}</g>
      <g className="bird__down">{pixelRects(WINGS_DOWN, BIRD_PALETTE, 'd')}</g>
    </svg>
  )
}
