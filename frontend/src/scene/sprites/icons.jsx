import { inCircle, rasterize } from './generate'
import PixelSprite from './PixelSprite'

// The 12 artifact icons the backend can send (artifact.icon). Unknown
// keywords fall back to "gem". Hand-drawn ones are text grids; round ones
// are generated from circles.

const K = 'var(--ink)'

const c = 6.5 // centre of the 13×13 generated icons
const dist = (x, y) => Math.hypot(x + 0.5 - c, y + 0.5 - c)
const angle = (x, y) => Math.atan2(y + 0.5 - c, x + 0.5 - c)

const ICONS = {
  coin: {
    rows: rasterize(13, 13, (x, y) => {
      if (!inCircle(x, y, c, c, 5.6)) return null
      if (inCircle(x, y, c - 1.6, c - 1.6, 1.4)) return 'y'
      const d = dist(x, y)
      return d > 3.2 && d < 4.3 ? 'O' : 'Y'
    }, 'K'),
    palette: { K, Y: '#f2c25c', O: '#c98f1c', y: '#fff0a6' },
  },

  gear: {
    rows: rasterize(13, 13, (x, y) => {
      const d = dist(x, y)
      const deg = ((angle(x, y) * 180) / Math.PI + 360 + 11) % 45
      const tooth = d <= 5.9 && deg < 22
      if (d < 1.8) return null
      if (d <= 4.2 || tooth) return x + y > 13 ? 'g' : 'G'
      return null
    }, 'K'),
    palette: { K, G: '#a3acb6', g: '#727c88' },
  },

  atom: {
    rows: rasterize(13, 13, (x, y) => {
      if (inCircle(x, y, c, c, 1.6)) return 'R'
      const px = x + 0.5 - c
      const py = y + 0.5 - c
      for (const rot of [0, Math.PI / 3, (2 * Math.PI) / 3]) {
        const u = px * Math.cos(rot) + py * Math.sin(rot)
        const v = -px * Math.sin(rot) + py * Math.cos(rot)
        const e = (u / 5.8) ** 2 + (v / 2.2) ** 2
        if (Math.abs(e - 1) < 0.28) return 'B'
      }
      return null
    }),
    palette: { R: 'var(--berry)', B: '#3f7fc0' },
  },

  fossil: {
    rows: rasterize(13, 13, (x, y) => {
      if (!inCircle(x, y, c, c, 5.6)) return null
      const d = dist(x, y)
      const turn = (angle(x, y) + Math.PI) / (2 * Math.PI) // 0..1 around the shell
      return (d - turn * 2.1 + 10) % 2.1 < 0.75 ? 'k' : 's'
    }, 'K'),
    palette: { K, s: '#e2d2b0', k: '#9a8160' },
  },

  gem: {
    rows: [
      '...KKKKKK...',
      '..KcCCCCcK..',
      '.KcCCcCCCcK.',
      'KKKKKKKKKKKK',
      'KcCCCCCCCCcK',
      '.KcCCCCCCcK.',
      '..KcCCCCcK..',
      '...KcCCcK...',
      '....KccK....',
      '.....KK.....',
    ],
    palette: { K, C: '#e0565b', c: '#f5a3a5' },
  },

  leaf: {
    rows: [
      '........KKK.',
      '......KKGGK.',
      '....KKGGGGK.',
      '...KGGGlGGK.',
      '..KGGGlGGGK.',
      '..KGGlGGGK..',
      '.KGGlGGGGK..',
      '.KGlGGGKK...',
      '.KlGGKK.....',
      'KlKKK.......',
      'K...........',
    ],
    palette: { K, G: 'var(--leaf)', l: '#a6dc86' },
  },

  flask: {
    rows: [
      '....KKKK....',
      '....KWWK....',
      '....KWWK....',
      '....KWWK....',
      '...KWWWWK...',
      '..KWWWWWWK..',
      '.KWWWWWWWWK.',
      '.KPPPPPPPPK.',
      'KPPpPPPPpPPK',
      'KPPPPPpPPPPK',
      '.KKKKKKKKKK.',
    ],
    palette: { K, W: '#e9f6fb', P: '#9b6bd6', p: '#d2b6f5' },
  },

  book: {
    rows: [
      '.KKKKKKKKKK.',
      'KRRRRRRRRRKK',
      'KRRyyyyyRRKW',
      'KRRRRRRRRRKW',
      'KRRyyyyRRRKW',
      'KRRRRRRRRRKW',
      'KRRRRRRRRRKW',
      'KRRRRRRRRRKW',
      'KrrrrrrrrrKW',
      'KKKKKKKKKKKK',
    ],
    palette: { K, R: 'var(--berry)', r: '#8f2f29', y: 'var(--gold)', W: '#fff4dc' },
  },

  scroll: {
    rows: [
      '..KKKKKKKKK.',
      '.KppppppppKK',
      'KpKKKKKKKKpK',
      '.KPPPPPPPPK.',
      '.KPkkkkkPPK.',
      '.KPPPPPPPPK.',
      '.KPkkkkPPPK.',
      '.KPPPPPPPPK.',
      'KpKKKKKKKKpK',
      '.KppppppppK.',
      '..KKKKKKKK..',
    ],
    palette: { K, P: '#f3dfae', p: '#d9b87a', k: '#8a6a4a' },
  },

  map: {
    rows: [
      'KKKKKKKKKKKK',
      'KMMMmMMMMmMK',
      'KMkMmMMMMmMK',
      'KMMkmMMMMmMK',
      'KMMMmkkMMmMK',
      'KMMMmMMkMmMK',
      'KMMMmMMMkmMK',
      'KMMMmMMMXmXK',
      'KMMMmMMMMXMK',
      'KMMMmMMMXmXK',
      'KKKKKKKKKKKK',
    ],
    palette: { K, M: '#f3dfae', m: '#d9b87a', k: '#8a6a4a', X: 'var(--berry)' },
  },

  telescope: {
    rows: [
      '.........KKK',
      '........KBBK',
      '.......KBbK.',
      '......KBbK..',
      '.....KBbK...',
      '....KBbK....',
      '...KBbK.....',
      '....KK......',
      '...KKK......',
      '..K.K.K.....',
      '.K..K..K....',
      'K...K...K...',
    ],
    palette: { K, B: '#6b7fa8', b: '#9fb2d6' },
  },

  camera: {
    rows: [
      '...KKKK.....',
      '..KggggK....',
      'KKKKKKKKKKKK',
      'KgggKKKKgggK',
      'KggKLLLLKggK',
      'KggKLlLLKggK',
      'KggKLLLLKggK',
      'KgggKKKKgggK',
      'KKKKKKKKKKKK',
    ],
    palette: { K, g: '#5a6170', L: '#6fb1d6', l: '#ffffff' },
  },
}

export default function ArtifactIcon({ name, scale = 4, className = '' }) {
  const icon = ICONS[name] ?? ICONS.gem
  return <PixelSprite rows={icon.rows} palette={icon.palette} scale={scale} className={`icon ${className}`} />
}
