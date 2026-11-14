import { inCircle, rasterize } from './generate'
import { mirror } from './pixel'
import PixelSprite from './PixelSprite'

// Things buried in the strata, plus the tunnel mouth used by the tunnel picker.

const K = 'var(--ink)'

const PROPS = {
  pebble: {
    rows: ['.KKKK.', 'KggGgK', 'KgGGgK', '.KKKK.'],
    palette: { K: 'rgba(20,12,8,.55)', g: '#8b8178', G: '#a69d93' },
  },
  fossil: {
    rows: rasterize(9, 9, (x, y) => {
      if (!inCircle(x, y, 4.5, 4.5, 3.6)) return null
      const d = Math.hypot(x + 0.5 - 4.5, y + 0.5 - 4.5)
      const turn = (Math.atan2(y + 0.5 - 4.5, x + 0.5 - 4.5) + Math.PI) / (2 * Math.PI)
      return (d - turn * 1.6 + 10) % 1.6 < 0.6 ? 'k' : 's'
    }),
    palette: { s: 'rgba(226,210,176,.55)', k: 'rgba(120,98,70,.6)' },
  },
  bone: {
    rows: ['KK.....KK', 'KbKKKKKbK', '.KbbbbbK.', 'KbKKKKKbK', 'KK.....KK'],
    palette: { K: 'rgba(20,12,8,.45)', b: 'rgba(240,228,205,.6)' },
  },
  crystal: {
    rows: ['..K..', '.KcK.', '.KcK.', 'KcCcK', 'KcCcK', 'KcCcK', '.KKK.'],
    palette: { K: 'rgba(10,6,14,.6)', c: '#7fd3e6', C: '#c3f1fb' },
  },
  ember: {
    rows: ['.o.', 'oOo', '.o.'],
    palette: { o: '#e8572b', O: '#ffb347' },
  },
  worm: {
    rows: ['.KK...KK..', 'KppK.KppK.', 'KpppKpppK.', '.KK.KK.KpK', '.......KK.'],
    palette: { K: 'rgba(40,20,14,.7)', p: '#d98c86' },
  },
  root: {
    rows: rasterize(7, 22, (x, y) => {
      const center = 3 + Math.round(Math.sin(y / 3) * 1.6)
      const width = y < 8 ? 1 : 0
      return Math.abs(x - center) <= width ? 'r' : null
    }),
    palette: { r: 'rgba(150,110,70,.75)' },
  },
}

export function BuriedProp({ kind, scale = 4, flip = false, className = '', style }) {
  const prop = PROPS[kind] ?? PROPS.pebble
  return (
    <PixelSprite
      rows={flip ? mirror(prop.rows) : prop.rows}
      palette={prop.palette}
      scale={scale}
      className={className}
      style={style}
    />
  )
}

// Tunnel mouth: rocky arch around a dark hole.
const ARCH = rasterize(
  22,
  18,
  (x, y) => {
    const outer = inCircle(x, y, 11, 10, 10) || (y >= 10 && x >= 1 && x <= 20)
    if (!outer) return null
    const hole = inCircle(x, y, 11, 11, 6.6) || (y >= 11 && x >= 5 && x <= 16)
    if (hole) return y > 14 ? 'd' : 'D'
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
    return n - Math.floor(n) < 0.3 ? 's' : 'S'
  },
  'K',
)

export function TunnelArch({ scale = 4, className = '' }) {
  return (
    <PixelSprite
      rows={ARCH}
      palette={{ K, S: '#9a8f84', s: '#766c62', D: '#120c08', d: '#24170f' }}
      scale={scale}
      className={className}
    />
  )
}
