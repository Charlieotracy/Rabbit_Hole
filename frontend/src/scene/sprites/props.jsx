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
