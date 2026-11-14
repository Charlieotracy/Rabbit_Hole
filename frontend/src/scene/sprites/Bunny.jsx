import Particles from '../../effects/Particles'
import { overlay, pixelRects } from './pixel'
import PixelSprite from './PixelSprite'

// The guide: a small cream bunny in a miner's helmet with a headlamp.
// 24×29 art pixels, front-facing and sitting.
//
// mood: "idle"  - blinks and bobs gently
//       "talk"  - mouth opens and closes
//       "dig"   - shakes fast while dirt flies
//       "cheer" - hops with an open grin
//       "dazed" - wobbles with squinty eyes and stars
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

export default function Bunny({ mood = 'idle', lamp = false, scale = 4, className = '' }) {
  return (
    <span className={`bunny bunny--${mood} ${lamp ? 'bunny--lamp' : ''} ${className}`} aria-hidden="true">
      {lamp && <span className="bunny__beam" />}
      <svg
        className="sprite bunny__sprite"
        viewBox={`0 0 ${W} ${H}`}
        width={W * scale}
        height={H * scale}
        focusable="false"
      >
        <g>{pixelRects(BODY, PALETTE, 'b')}</g>
        <g className="bunny__blink">{pixelRects(BLINK, PALETTE, 'e')}</g>
        <g className="bunny__dazed">{pixelRects(DAZED_EYES, PALETTE, 'z')}</g>
        <g className="bunny__mouth">{pixelRects(MOUTH_OPEN, PALETTE, 'm')}</g>
      </svg>
      {mood === 'dazed' && (
        <span className="bunny__stars">
          <PixelSprite rows={STAR} palette={STAR_PALETTE} scale={Math.max(2, scale - 1)} />
          <PixelSprite rows={STAR} palette={STAR_PALETTE} scale={Math.max(2, scale - 2)} />
        </span>
      )}
      {mood === 'dig' && <Particles className="bunny__dirt" count={10} loop />}
    </span>
  )
}
