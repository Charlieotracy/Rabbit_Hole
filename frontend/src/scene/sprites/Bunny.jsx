import Particles from '../../effects/Particles'
import { rasterize } from './generate'
import { overlay, pixelRects } from './pixel'
import PixelSprite from './PixelSprite'

// The guide: a small cream bunny in a miner's helmet with a headlamp.
// 24×29 art pixels, front-facing and sitting.
//
// mood: "idle"  - blinks and bobs gently
//       "talk"  - mouth opens and closes
//       "dig"   - scoops with its paws (two frames) while dirt flies
//       "cheer" - hops with an open grin
//       "dazed" - wobbles with squinty eyes and stars
// motion: "none" - stays put
//         "sink" - a hole opens and it digs itself down out of sight (then stays hidden)
//         "rise" - pops back up out of the hole
//         "drop" - drops in from above when it arrives somewhere new
// lamp: show the headlamp beam (for dark layers)

const W = 24
const H = 29

const PALETTE = {
  K: 'var(--ink)',
  W: 'var(--fur)',
  S: 'var(--fur-shade)',
  P: 'var(--blush)',
  C: '#f6c3c6', // cheeks
  N: '#e7798a', // nose
  Y: 'var(--gold)', // helmet
  O: '#d49a1f', // helmet brim
  L: '#fff6b0', // lamp
}

// Mouth row 18 is the closed smile; overlays below swap in other frames.
const BODY = [
  '......KKK......KKK......',
  '.....KWWWK....KWWWK.....',
  '.....KWPWK....KWPWK.....',
  '.....KWPWK....KWPWK.....',
  '.....KWPWK....KWPWK.....',
  '.....KWPWK....KWPWK.....',
  '.....KWPWK....KWPWK.....',
  '.....KKKKKKKKKKKKKK.....',
  '....KYYYYYKLLKYYYYYK....',
  '...KYYYYYYKLLKYYYYYYK...',
  '...KYYYYYYYKKYYYYYYYK...',
  '..KKOOOOOOOOOOOOOOOOKK..',
  '..KKKKKKKKKKKKKKKKKKKK..',
  '....KWWWWWWWWWWWWWWK....',
  '...KWWWWWWWWWWWWWWWWK...',
  '...KWWKKWWWWWWWWKKWWK...',
  '...KWWKKWWWWWWWWKKWWK...',
  '...KWCCWWWWNNWWWWCCWK...',
  '...KWWWWWWKWWKWWWWWWK...',
  '...KSWWWWWWWWWWWWWWSK...',
  '....KSSWWWWWWWWWWSSK....',
  '....KKSWWWWWWWWWWSKK....',
  '...KWWWWWWWWWWWWWWWWK...',
  '..KWWKWWWWWWWWWWWWKWWK..',
  '..KWWKWWWWWWWWWWWWKWWK..',
  '..KWKSSKWWWWWWWWKSSKWK..',
  '..KWWKKWWWWWWWWWWKKWWK..',
  '.KSSWWWWKKKKKKKKWWWWSSK.',
  '.KKKKKKKK......KKKKKKKK.',
]

// Digging pose: the body above row 22 stays; the lower body swaps between
// paws flung out (A) and paws scooping down in front (B).
const DIG_A = [
  ...BODY.slice(0, 22),
  '.KK.KWWWWWWWWWWWWWWK.KK.',
  'KWWKKWWWWWWWWWWWWWWKKWWK',
  'KWWWKWWWWWWWWWWWWWWKWWWK',
  '.KKKWWWWWWWWWWWWWWWWKKK.',
  '...KWWWWWWWWWWWWWWWWK...',
  '.KSSWWWWKKKKKKKKWWWWSSK.',
  '.KKKKKKKK......KKKKKKKK.',
]
const DIG_B = [
  ...BODY.slice(0, 22),
  '...KWWWWWWWWWWWWWWWWK...',
  '...KWWWWWWWWWWWWWWWWK...',
  '...KWWWWWWWWWWWWWWWWK...',
  '..KWWKWWWWWWWWWWWWKWWK..',
  '.KWWWKKWWWWWWWWWWKKWWWK.',
  'KSSWWKKKKKKKKKKKKKKWWSSK',
  'KKKKKK............KKKKKK',
]

// The hole it digs: a dark oval with a dirt rim, seen at ground level.
const HOLE = rasterize(
  28,
  6,
  (x, y) => {
    const ex = (x + 0.5 - 14) / 13.5
    const ey = (y + 0.5 - 3) / 3
    const d = ex * ex + ey * ey
    if (d > 1) return null
    return d < 0.5 ? 'D' : 'S'
  },
  'K',
)
const HOLE_PALETTE = { K: 'var(--ink)', S: 'var(--soil-1)', D: '#1d130c' }

const BLINK = overlay(W, H, {
  15: '......WW........WW......',
  16: '......KK........KK......',
})

const MOUTH_OPEN = overlay(W, H, {
  18: '..........KKKK..........',
  19: '..........KPPK..........',
  20: '...........KK...........',
})

// Squinty "> <" eyes for dazed.
const DAZED_EYES = overlay(W, H, {
  15: '......KW........WK......',
  16: '......WK........KW......',
})

const STAR = ['..Y..', '.YYY.', 'YYYYY', '.YYY.', '..Y..']
const STAR_PALETTE = { Y: 'var(--gold)' }

export default function Bunny({ mood = 'idle', motion = 'none', lamp = false, scale = 4, className = '' }) {
  const showHole = motion === 'sink' || motion === 'rise'
  return (
    <span
      className={`bunny bunny--${mood} bunny--motion-${motion} ${lamp ? 'bunny--lamp' : ''} ${className}`}
      aria-hidden="true"
    >
      {showHole && <PixelSprite rows={HOLE} palette={HOLE_PALETTE} scale={scale} className="bunny__hole" />}
      {/* Clipped at the feet, so sinking makes the bunny disappear into the ground. */}
      <span className="bunny__clip">
        <span className="bunny__body">
          {lamp && <span className="bunny__beam" />}
          <svg
            className="sprite bunny__sprite"
            viewBox={`0 0 ${W} ${H}`}
            width={W * scale}
            height={H * scale}
            focusable="false"
          >
            <g className="bunny__base">{pixelRects(BODY, PALETTE, 'b')}</g>
            <g className="bunny__dig-a">{pixelRects(DIG_A, PALETTE, 'da')}</g>
            <g className="bunny__dig-b">{pixelRects(DIG_B, PALETTE, 'db')}</g>
            <g className="bunny__blink">{pixelRects(BLINK, PALETTE, 'e')}</g>
            <g className="bunny__dazed">{pixelRects(DAZED_EYES, PALETTE, 'z')}</g>
            <g className="bunny__mouth">{pixelRects(MOUTH_OPEN, PALETTE, 'm')}</g>
          </svg>
        </span>
      </span>
      {mood === 'dazed' && (
        <span className="bunny__stars">
          <PixelSprite rows={STAR} palette={STAR_PALETTE} scale={Math.max(2, scale - 1)} />
          <PixelSprite rows={STAR} palette={STAR_PALETTE} scale={Math.max(2, scale - 2)} />
        </span>
      )}
      {mood === 'dig' && <Particles className="bunny__dirt" count={12} loop />}
    </span>
  )
}
