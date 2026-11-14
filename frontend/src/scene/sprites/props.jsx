import PixelSprite from './PixelSprite'

// Small decorative sprites. Each one is a text grid; see pixel.js.

const CARROT = [
  'G...........',
  'GG.KKKK.....',
  '.GKOOOOKKK..',
  'GGKOoOOOOOKK',
  '.GKOOOOoKK..',
  'GG.KKKKK....',
  'G...........',
]
const CARROT_PALETTE = {
  G: 'var(--leaf)',
  K: 'var(--ink)',
  O: 'var(--carrot)',
  o: 'var(--carrot-dark)',
}

export function Carrot({ scale = 3, className = '' }) {
  return <PixelSprite rows={CARROT} palette={CARROT_PALETTE} scale={scale} className={className} />
}

const BURROW = [
  '....kkkkkkkk....',
  '..kkSSSSSSSSkk..',
  '.kSSKKKKKKKKSSk.',
  'kSSKDDDDDDDDKSSk',
  'kSKDDDDDDDDDDKSk',
]
const BURROW_PALETTE = {
  k: 'var(--ink)',
  S: 'var(--soil-1)',
  K: 'var(--soil-3)',
  D: '#1d130c',
}

export function Burrow({ scale = 4, className = '' }) {
  return <PixelSprite rows={BURROW} palette={BURROW_PALETTE} scale={scale} className={className} />
}

const TUFT = [
  '..g...g.',
  '.gG..gG.',
  'gGGggGGg',
]
const TUFT_PALETTE = { g: 'var(--grass-dark)', G: 'var(--grass)' }

export function GrassTuft({ scale = 3, className = '', style }) {
  return <PixelSprite rows={TUFT} palette={TUFT_PALETTE} scale={scale} className={className} style={style} />
}
